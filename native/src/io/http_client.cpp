#include "io/http_client.hpp"

#include <mutex>
#include <optional>

#include <boost/asio/co_spawn.hpp>
#include <boost/asio/connect.hpp>
#include <boost/asio/detached.hpp>
#include <boost/asio/io_context.hpp>
#include <boost/asio/ip/tcp.hpp>
#include <boost/asio/ssl.hpp>
#include <boost/asio/redirect_error.hpp>
#include <boost/asio/use_awaitable.hpp>
#include <boost/beast/core.hpp>
#include <boost/beast/http.hpp>
#include <boost/beast/ssl.hpp>

#include "core/ip_policy.hpp"
#include "core/text.hpp"
#include "core/url.hpp"
#include "io/tls_roots.hpp"

namespace tr::io {

namespace asio = boost::asio;
namespace beast = boost::beast;
namespace bhttp = boost::beast::http;
namespace ssl = boost::asio::ssl;
using tcp = asio::ip::tcp;

namespace {

std::mutex g_ctx_mu;

ssl::context& tls_context() {
    static ssl::context ctx = [] {
        ssl::context c(ssl::context::tls_client);
        c.set_options(ssl::context::default_workarounds | ssl::context::no_sslv2 | ssl::context::no_sslv3 |
                      ssl::context::no_tlsv1 | ssl::context::no_tlsv1_1);
        load_system_roots(c);
        c.set_verify_mode(ssl::verify_peer);
        return c;
    }();
    return ctx;
}

struct Hop {
    int status = 0;
    http::Headers headers;
    std::string body;
};

using Deadline = std::chrono::steady_clock::time_point;

asio::awaitable<std::vector<tcp::endpoint>> resolve(const Url& url, bool public_only) {
    auto ex = co_await asio::this_coro::executor;
    tcp::resolver resolver(ex);
    boost::system::error_code ec;
    auto results = co_await resolver.async_resolve(url.host, std::to_string(url.port),
                                                   asio::redirect_error(asio::use_awaitable, ec));
    if (ec) throw HttpClientError("dns", url.host);
    std::vector<tcp::endpoint> eps;
    std::vector<std::string> addresses;
    for (const auto& r : results) {
        eps.push_back(r.endpoint());
        addresses.push_back(r.endpoint().address().to_string());
    }
    if (eps.empty()) throw HttpClientError("dns", "empty: " + url.host);
    // ssrf-guard.ts と同じく、1 つでも内部 IP に解決されたら拒否する。検査した eps にそのまま接続する (再解決しない)。
    if (!vet_resolved_addresses(addresses, public_only)) throw HttpClientError("blocked", url.host);
    co_return eps;
}

template <class Stream>
asio::awaitable<Hop> exchange(Stream& stream, const Url& url, const HttpClientRequest& req, Deadline deadline) {
    bhttp::request<bhttp::string_body> msg;
    msg.method_string(req.method);
    msg.target(url.target);
    msg.version(11);
    msg.set(bhttp::field::host, url.host_header());
    msg.set(bhttp::field::accept_encoding, "identity");
    msg.set(bhttp::field::connection, "close");
    for (const auto& [k, v] : req.headers) msg.insert(k, v);
    if (!req.body.empty() || req.method == "POST" || req.method == "PUT" || req.method == "PATCH") {
        msg.body() = req.body;
        msg.prepare_payload();
    }
    beast::get_lowest_layer(stream).expires_at(deadline);
    boost::system::error_code ec;
    co_await bhttp::async_write(stream, msg, asio::redirect_error(asio::use_awaitable, ec));
    if (ec) throw HttpClientError(ec == beast::error::timeout ? "timeout" : "protocol", ec.message());
    beast::flat_buffer buffer;
    bhttp::response_parser<bhttp::string_body> parser;
    parser.header_limit(64 * 1024);
    parser.body_limit(req.max_response_bytes);
    if (req.method == "HEAD") parser.skip(true);
    co_await bhttp::async_read(stream, buffer, parser, asio::redirect_error(asio::use_awaitable, ec));
    if (ec == bhttp::error::body_limit) throw HttpClientError("too_large", url.host);
    if (ec == beast::error::timeout) throw HttpClientError("timeout", url.host);
    if (ec) throw HttpClientError("protocol", ec.message());
    auto res = parser.release();
    Hop hop;
    hop.status = static_cast<int>(res.result_int());
    for (const auto& f : res) hop.headers.append(std::string(f.name_string()), std::string(f.value()));
    if (auto enc = hop.headers.get("content-encoding"); enc && ascii_lower(js_trim(*enc)) != "identity") {
        throw HttpClientError("unsupported_encoding", *enc);
    }
    hop.body = std::move(res.body());
    co_return hop;
}

asio::awaitable<Hop> one_hop(const Url& url, const HttpClientRequest& req, Deadline deadline) {
    auto ex = co_await asio::this_coro::executor;
    const auto eps = co_await resolve(url, req.public_only);
    boost::system::error_code ec;
    if (url.tls()) {
        beast::ssl_stream<beast::tcp_stream> stream(ex, tls_context());
        if (!url.host_is_ip && !SSL_set_tlsext_host_name(stream.native_handle(), url.host.c_str())) {
            throw HttpClientError("tls", "sni");
        }
        stream.set_verify_callback(ssl::host_name_verification(url.host));
        beast::get_lowest_layer(stream).expires_at(deadline);
        co_await beast::get_lowest_layer(stream).async_connect(eps, asio::redirect_error(asio::use_awaitable, ec));
        if (ec) throw HttpClientError(ec == beast::error::timeout ? "timeout" : "connect", url.host);
        co_await stream.async_handshake(ssl::stream_base::client, asio::redirect_error(asio::use_awaitable, ec));
        if (ec) throw HttpClientError(ec == beast::error::timeout ? "timeout" : "tls", ec.message());
        Hop hop = co_await exchange(stream, url, req, deadline);
        beast::get_lowest_layer(stream).expires_after(std::chrono::seconds(2));
        co_await stream.async_shutdown(asio::redirect_error(asio::use_awaitable, ec));
        co_return hop;
    }
    beast::tcp_stream stream(ex);
    stream.expires_at(deadline);
    co_await stream.async_connect(eps, asio::redirect_error(asio::use_awaitable, ec));
    if (ec) throw HttpClientError(ec == beast::error::timeout ? "timeout" : "connect", url.host);
    Hop hop = co_await exchange(stream, url, req, deadline);
    stream.socket().shutdown(tcp::socket::shutdown_both, ec);
    co_return hop;
}

asio::awaitable<HttpClientResponse> run(const HttpClientRequest& req, Deadline deadline) {
    auto url = parse_url(req.url);
    if (!url || (url->scheme != "http" && url->scheme != "https")) throw HttpClientError("invalid_url", "");
    for (int i = 0;; ++i) {
        if (req.public_only && url->host_is_ip && is_blocked_ip(url->host)) throw HttpClientError("blocked", url->host);
        Hop hop = co_await one_hop(*url, req, deadline);
        auto location = hop.headers.get("location");
        if (hop.status >= 300 && hop.status < 400 && location && i < req.max_redirects) {
            auto next = resolve_url(*url, *location);
            if (!next || (next->scheme != "http" && next->scheme != "https")) {
                throw HttpClientError("invalid_url", "redirect");
            }
            url = next;
            continue;
        }
        if (hop.status >= 300 && hop.status < 400 && location && req.max_redirects > 0 && i >= req.max_redirects) {
            throw HttpClientError("too_many_redirects", "");
        }
        HttpClientResponse out;
        out.status = hop.status;
        out.headers = std::move(hop.headers);
        out.body = std::move(hop.body);
        out.final_url = url->to_string();
        co_return out;
    }
}

}  // namespace

HttpClientResponse http_fetch(const HttpClientRequest& request) {
    // result / error は io_context より先に作る (io_context の破棄時に残った処理が触らないように)。
    std::optional<HttpClientResponse> result;
    std::exception_ptr error;
    asio::io_context ioc;
    const auto deadline = std::chrono::steady_clock::now() + request.timeout;
    {
        std::lock_guard lock(g_ctx_mu);
        (void)tls_context();  // 初期化は 1 回 (スレッド安全に)
    }
    asio::co_spawn(ioc, run(request, deadline), [&](std::exception_ptr e, HttpClientResponse r) {
        if (e) error = e;
        else result = std::move(r);
    });
    ioc.run_until(deadline + std::chrono::milliseconds(50));
    if (error) std::rethrow_exception(error);
    if (!result) throw HttpClientError("timeout", "deadline");
    return std::move(*result);
}

void http_client_add_trusted_ca(const std::string& pem) {
    std::lock_guard lock(g_ctx_mu);
    tls_context().add_certificate_authority(asio::buffer(pem));
}

}  // namespace tr::io
