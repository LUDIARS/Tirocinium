#include "io/ws_client.hpp"

#include <atomic>
#include <deque>

#include <boost/asio/connect.hpp>
#include <boost/asio/dispatch.hpp>
#include <boost/asio/ip/tcp.hpp>
#include <boost/asio/post.hpp>
#include <boost/asio/ssl.hpp>
#include <boost/asio/steady_timer.hpp>
#include <boost/asio/strand.hpp>
#include <boost/beast/core.hpp>
#include <boost/beast/ssl.hpp>
#include <boost/beast/websocket.hpp>
#include <boost/beast/websocket/ssl.hpp>

#include "core/ip_policy.hpp"
#include "core/url.hpp"
#include "io/tls_roots.hpp"

namespace tr::io {

namespace asio = boost::asio;
namespace beast = boost::beast;
namespace websocket = boost::beast::websocket;
namespace ssl = boost::asio::ssl;
using tcp = asio::ip::tcp;

namespace {

ssl::context& client_tls() {
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

template <class Stream>
class Client final : public WsClient, public std::enable_shared_from_this<Client<Stream>> {
public:
    Client(asio::io_context& ioc, Url url, WsClientOptions options, OnOpen on_open, OnMessage on_message, OnClose on_close)
        : strand_(asio::make_strand(ioc)), resolver_(strand_), ws_(make_stream(strand_)), timer_(strand_),
          url_(std::move(url)), options_(std::move(options)), on_open_(std::move(on_open)),
          on_message_(std::move(on_message)), on_close_(std::move(on_close)) {}

    void start() {
        auto self = this->shared_from_this();
        asio::dispatch(strand_, [self] {
            self->timer_.expires_after(self->options_.connect_timeout);
            self->timer_.async_wait([self](beast::error_code ec) {
                if (!ec && !self->opened_) self->fail("connect timeout");
            });
            self->resolver_.async_resolve(self->url_.host, std::to_string(self->url_.port),
                                          [self](beast::error_code e, tcp::resolver::results_type r) { self->on_resolve(e, r); });
        });
    }

    void send(std::string data, bool binary) override {
        asio::post(strand_, [self = this->shared_from_this(), data = std::move(data), binary]() mutable {
            if (!self->opened_ || self->closed_) return;
            self->queue_.emplace_back(std::move(data), binary);
            if (self->queue_.size() == 1) self->do_write();
        });
    }

    void close(std::uint16_t code, std::string reason) override {
        asio::post(strand_, [self = this->shared_from_this(), code, reason = std::move(reason)] {
            if (!self->opened_ || self->closed_ || self->closing_) return;
            self->closing_ = true;
            self->ws_.async_close(websocket::close_reason(static_cast<websocket::close_code>(code), reason),
                                  [self](beast::error_code) { self->finish(static_cast<int>(1000), ""); });
        });
    }

    void terminate() override {
        asio::post(strand_, [self = this->shared_from_this()] {
            beast::error_code ec;
            beast::get_lowest_layer(self->ws_).socket().close(ec);
            self->resolver_.cancel();
            self->timer_.cancel();
            if (!self->opened_) self->fail("terminated");
            else self->finish(1006, "");
        });
    }

    [[nodiscard]] bool is_open() const override { return open_.load(); }

private:
    static websocket::stream<beast::tcp_stream> make(asio::strand<asio::io_context::executor_type>& s,
                                                      std::type_identity<websocket::stream<beast::tcp_stream>>) {
        return websocket::stream<beast::tcp_stream>(s);
    }
    static websocket::stream<beast::ssl_stream<beast::tcp_stream>> make(
        asio::strand<asio::io_context::executor_type>& s,
        std::type_identity<websocket::stream<beast::ssl_stream<beast::tcp_stream>>>) {
        return websocket::stream<beast::ssl_stream<beast::tcp_stream>>(s, client_tls());
    }
    static Stream make_stream(asio::strand<asio::io_context::executor_type>& s) { return make(s, std::type_identity<Stream>{}); }

    void on_resolve(beast::error_code ec, tcp::resolver::results_type results) {
        if (ec) return fail("dns");
        std::vector<tcp::endpoint> eps;
        for (const auto& r : results) {
            if (options_.public_only && is_blocked_ip(r.endpoint().address().to_string())) return fail("blocked");
            eps.push_back(r.endpoint());
        }
        auto self = this->shared_from_this();
        beast::get_lowest_layer(ws_).expires_after(options_.connect_timeout);
        beast::get_lowest_layer(ws_).async_connect(eps, [self](beast::error_code e, const tcp::endpoint&) { self->on_connect(e); });
    }

    void on_connect(beast::error_code ec) {
        if (ec) return fail("connect");
        auto self = this->shared_from_this();
        if constexpr (std::is_same_v<Stream, websocket::stream<beast::ssl_stream<beast::tcp_stream>>>) {
            if (!url_.host_is_ip && !SSL_set_tlsext_host_name(ws_.next_layer().native_handle(), url_.host.c_str())) {
                return fail("sni");
            }
            ws_.next_layer().set_verify_callback(ssl::host_name_verification(url_.host));
            ws_.next_layer().async_handshake(ssl::stream_base::client, [self](beast::error_code e) {
                if (e) return self->fail("tls");
                self->handshake();
            });
        } else {
            handshake();
        }
    }

    void handshake() {
        beast::get_lowest_layer(ws_).expires_never();
        websocket::stream_base::timeout t{};
        t.handshake_timeout = options_.connect_timeout;
        t.idle_timeout = options_.idle_timeout;
        t.keep_alive_pings = true;
        ws_.set_option(t);
        ws_.read_message_max(options_.max_message);
        auto headers = options_.headers;
        ws_.set_option(websocket::stream_base::decorator([headers](websocket::request_type& req) {
            for (const auto& [k, v] : headers) req.set(k, v);
        }));
        auto self = this->shared_from_this();
        ws_.async_handshake(url_.host_header(), url_.target, [self](beast::error_code ec) {
            if (ec) return self->fail("handshake");
            self->timer_.cancel();
            self->opened_ = true;
            self->open_ = true;
            if (self->on_open_) {
                auto cb = std::move(self->on_open_);
                self->on_open_ = nullptr;
                cb(true, "");
            }
            self->do_read();
        });
    }

    void do_read() {
        auto self = this->shared_from_this();
        ws_.async_read(buffer_, [self](beast::error_code ec, std::size_t) {
            if (ec) {
                const auto reason = self->ws_.reason();
                self->finish(ec == websocket::error::closed ? static_cast<int>(reason.code) : 1006,
                             std::string(reason.reason.c_str()));
                return;
            }
            std::string data = beast::buffers_to_string(self->buffer_.data());
            self->buffer_.consume(self->buffer_.size());
            const bool binary = self->ws_.got_binary();
            if (self->on_message_) self->on_message_(std::move(data), binary);
            self->do_read();
        });
    }

    void do_write() {
        auto self = this->shared_from_this();
        ws_.binary(queue_.front().second);
        ws_.async_write(asio::buffer(queue_.front().first), [self](beast::error_code ec, std::size_t) {
            if (ec) return self->finish(1006, "");
            self->queue_.pop_front();
            if (!self->queue_.empty()) self->do_write();
        });
    }

    void fail(const std::string& why) {
        if (opened_ || failed_) return;
        failed_ = true;
        timer_.cancel();
        beast::error_code ec;
        beast::get_lowest_layer(ws_).socket().close(ec);
        if (on_open_) {
            auto cb = std::move(on_open_);
            on_open_ = nullptr;
            cb(false, why);
        }
    }

    void finish(int code, const std::string& reason) {
        if (closed_) return;
        closed_ = true;
        open_ = false;
        queue_.clear();
        if (on_close_) {
            auto cb = std::move(on_close_);
            on_close_ = nullptr;
            cb(code, reason);
        }
        on_message_ = nullptr;
    }

    asio::strand<asio::io_context::executor_type> strand_;
    tcp::resolver resolver_;
    Stream ws_;
    asio::steady_timer timer_;
    beast::flat_buffer buffer_;
    Url url_;
    WsClientOptions options_;
    OnOpen on_open_;
    OnMessage on_message_;
    OnClose on_close_;
    std::deque<std::pair<std::string, bool>> queue_;
    bool opened_ = false;
    bool failed_ = false;
    bool closing_ = false;
    bool closed_ = false;
    std::atomic<bool> open_{false};
};

}  // namespace

std::shared_ptr<WsClient> ws_connect(asio::io_context& ioc, const std::string& url, WsClientOptions options,
                                     WsClient::OnOpen on_open, WsClient::OnMessage on_message, WsClient::OnClose on_close) {
    auto parsed = parse_url(url);
    if (!parsed || (parsed->scheme != "ws" && parsed->scheme != "wss")) {
        if (on_open) on_open(false, "invalid_url");
        return nullptr;
    }
    if (parsed->tls()) {
        auto c = std::make_shared<Client<websocket::stream<beast::ssl_stream<beast::tcp_stream>>>>(
            ioc, *parsed, std::move(options), std::move(on_open), std::move(on_message), std::move(on_close));
        c->start();
        return c;
    }
    auto c = std::make_shared<Client<websocket::stream<beast::tcp_stream>>>(ioc, *parsed, std::move(options), std::move(on_open),
                                                                            std::move(on_message), std::move(on_close));
    c->start();
    return c;
}

}  // namespace tr::io
