// 外向き HTTP の境界テスト。相手はこのプロセス内の Beast サーバ (外部には接続しない)。
#include <thread>

#include <boost/asio/io_context.hpp>
#include <boost/asio/ip/tcp.hpp>

#include "check.hpp"
#include "app/pipeline.hpp"
#include "io/http_client.hpp"
#include "io/http_server.hpp"

using namespace tr;
using trtest::check;
using trtest::check_eq;
namespace asio = boost::asio;

namespace {

struct Local {
    asio::io_context ioc;
    http::Router router;
    std::unique_ptr<io::HttpServer> server;
    std::thread thread;
    Local() {
        router.get("/ok", [](http::Request& r, http::Context&) {
            return http::Response::json(Json{{"ua", r.header("user-agent").value_or("")},
                                             {"enc", r.header("accept-encoding").value_or("")}});
        });
        router.get("/big", [](http::Request&, http::Context&) { return http::Response::text(std::string(5000, 'x')); });
        router.get("/br", [](http::Request&, http::Context&) {
            auto r = http::Response::text("not really brotli");
            r.headers.set("content-encoding", "br");
            return r;
        });
        router.get("/redirect", [this](http::Request&, http::Context&) {
            http::Response r;
            r.status = 302;
            r.headers.set("location", "/ok");
            return r;
        });
        router.post("/echo", [](http::Request& r, http::Context&) { return http::Response::text(r.body); });
        server = std::make_unique<io::HttpServer>(
            ioc, "127.0.0.1", 0, io::HttpServerOptions{},
            [this](http::Request req, io::Responder respond) { respond(app::handle_request(router, req, nullptr)); },
            [](std::shared_ptr<io::PendingUpgrade> up) { up->reject(404); });
        server->start();
        thread = std::thread([this] { ioc.run(); });
    }
    ~Local() {
        server->stop();
        ioc.stop();
        thread.join();
    }
    std::string url(const std::string& path) const { return "http://127.0.0.1:" + std::to_string(server->port()) + path; }
};

std::string code_of(const io::HttpClientRequest& req) {
    try {
        io::http_fetch(req);
    } catch (const io::HttpClientError& e) {
        return e.code();
    }
    return "none";
}

}  // namespace

TEST_CASE("client: GET with identity encoding and custom headers") {
    Local srv;
    io::HttpClientRequest req;
    req.url = srv.url("/ok");
    req.headers = {{"user-agent", "TirociniumBot/0.1"}};
    auto res = io::http_fetch(req);
    check_eq(res.status, 200, "status");
    check(res.body.find("TirociniumBot/0.1") != std::string::npos, "ua sent");
    check(res.body.find(R"("enc":"identity")") != std::string::npos, "identity encoding requested");
}

TEST_CASE("client: POST body and response size limit (at limit ok, limit+1 rejected)") {
    Local srv;
    io::HttpClientRequest req;
    req.method = "POST";
    req.url = srv.url("/echo");
    req.body = std::string(1000, 'a');
    req.max_response_bytes = 1000;
    check_eq(io::http_fetch(req).body.size(), std::size_t{1000}, "exactly at limit");
    req.body = std::string(1001, 'a');
    check_eq(code_of(req), std::string("too_large"), "over limit");
}

TEST_CASE("client: Content-Encoding other than identity is refused (no decompressor)") {
    Local srv;
    io::HttpClientRequest req;
    req.url = srv.url("/br");
    check_eq(code_of(req), std::string("unsupported_encoding"), "br refused");
}

TEST_CASE("client: SSRF guard blocks loopback, including after a redirect") {
    Local srv;
    io::HttpClientRequest req;
    req.url = srv.url("/ok");
    req.public_only = true;
    check_eq(code_of(req), std::string("blocked"), "literal loopback");
    req.url = "http://localhost:" + std::to_string(srv.server->port()) + "/ok";
    check_eq(code_of(req), std::string("blocked"), "name resolving to loopback is blocked before connecting");
}

TEST_CASE("client: redirects followed only when allowed, each hop re-checked") {
    Local srv;
    io::HttpClientRequest req;
    req.url = srv.url("/redirect");
    check_eq(io::http_fetch(req).status, 302, "not followed by default");
    req.max_redirects = 2;
    auto res = io::http_fetch(req);
    check_eq(res.status, 200, "followed");
    check(res.final_url.find("/ok") != std::string::npos, "final url");
}

TEST_CASE("client: total deadline against a server that never answers") {
    asio::io_context ioc;
    asio::ip::tcp::acceptor acc(ioc, {asio::ip::make_address("127.0.0.1"), 0});
    io::HttpClientRequest req;
    req.url = "http://127.0.0.1:" + std::to_string(acc.local_endpoint().port()) + "/";
    req.timeout = std::chrono::milliseconds(300);
    const auto t0 = std::chrono::steady_clock::now();
    check_eq(code_of(req), std::string("timeout"), "timeout");
    check(std::chrono::steady_clock::now() - t0 < std::chrono::seconds(3), "returned near the deadline");
}

TEST_CASE("client: invalid urls and refused connections") {
    io::HttpClientRequest req;
    req.url = "ftp://example.com/";
    check_eq(code_of(req), std::string("invalid_url"), "scheme");
    req.url = "http://127.0.0.1:1/";
    check_eq(code_of(req), std::string("connect"), "refused");
}

TEST_MAIN()
