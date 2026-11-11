// Beast の受け口をソケット越しに確かめる (境界: ヘッダ上限・本文上限・未知の upgrade)。
#include <thread>

#include <boost/asio/connect.hpp>
#include <boost/asio/io_context.hpp>
#include <boost/asio/ip/tcp.hpp>
#include <boost/asio/read.hpp>
#include <boost/asio/write.hpp>

#include "check.hpp"
#include "app/pipeline.hpp"
#include "app/routes/health.hpp"
#include "io/http_server.hpp"

using namespace tr;
using trtest::check;
using trtest::check_eq;
namespace asio = boost::asio;

namespace {

struct Fixture {
    asio::io_context ioc;
    http::Router router;
    std::unique_ptr<io::HttpServer> server;
    std::thread thread;

    Fixture() {
        app::register_health_routes(router, "test", [] { return true; });
        router.post("/echo", [](http::Request& req, http::Context&) { return http::Response::text(req.body); });
        io::HttpServerOptions o;
        o.body_limit_for = app::body_limit_for;
        server = std::make_unique<io::HttpServer>(
            ioc, "127.0.0.1", 0, o,
            [this](http::Request req, io::Responder respond) { respond(app::handle_request(router, req, nullptr)); },
            [](std::shared_ptr<io::PendingUpgrade> up) { up->reject(404); });
        server->start();
        thread = std::thread([this] { ioc.run(); });
    }
    ~Fixture() {
        server->stop();
        ioc.stop();
        thread.join();
    }

    std::string roundtrip(const std::string& raw) {
        asio::io_context c;
        asio::ip::tcp::socket s(c);
        s.connect({asio::ip::make_address("127.0.0.1"), server->port()});
        boost::system::error_code ec;
        // 相手が本文を読まずに切ることがある (上限超過) ので、書き込みの失敗は無視して応答を読む。
        asio::write(s, asio::buffer(raw), ec);
        std::string out;
        char buf[4096];
        for (;;) {
            const auto n = s.read_some(asio::buffer(buf), ec);
            if (n) out.append(buf, n);
            if (ec) break;
        }
        return out;
    }
};

}  // namespace

TEST_CASE("server: GET /api/health over a socket") {
    Fixture f;
    const auto out = f.roundtrip("GET /api/health HTTP/1.1\r\nHost: x\r\nConnection: close\r\n\r\n");
    check(out.rfind("HTTP/1.1 200", 0) == 0, "status line: " + out.substr(0, 40));
    check(out.find(R"({"ok":true,"service":"tirocinium","version":"test"})") != std::string::npos, "body");
    check(out.find("access-control-allow-origin: *") != std::string::npos, "cors header");
}

TEST_CASE("server: header over 16 KiB is 431") {
    Fixture f;
    const std::string big(17 * 1024, 'a');
    const auto out = f.roundtrip("GET /api/health HTTP/1.1\r\nHost: x\r\nX-Big: " + big + "\r\n\r\n");
    check(out.rfind("HTTP/1.1 431", 0) == 0, "431: " + out.substr(0, 40));
}

TEST_CASE("server: header field count at the request budget (1,024) passes, 1,025 is 431 (under 16 KiB)") {
    // 要求ごとの Lorica 予算 (http/request_budget.hpp の kMaxHeaderFields)。Host と Connection を含めて数える。
    Fixture f;
    auto request_with_fields = [](std::size_t total) {
        std::string raw = "GET /api/health HTTP/1.1\r\nHost: x\r\nConnection: close\r\n";
        for (std::size_t i = 2; i < total; ++i) raw += "a: 1\r\n";
        return raw + "\r\n";
    };
    const auto at = f.roundtrip(request_with_fields(1024));
    check(at.rfind("HTTP/1.1 200", 0) == 0, "1024 fields: " + at.substr(0, 40));
    const auto over = f.roundtrip(request_with_fields(1025));
    check(over.rfind("HTTP/1.1 431", 0) == 0, "1025 fields: " + over.substr(0, 40));
}

TEST_CASE("server: body exactly at the limit is accepted, limit+1 is 413") {
    Fixture f;
    const std::size_t limit = 2 * 1024 * 1024;
    const std::string at(limit, 'x');
    auto ok = f.roundtrip("POST /echo HTTP/1.1\r\nHost: x\r\nConnection: close\r\nContent-Length: " +
                          std::to_string(at.size()) + "\r\n\r\n" + at);
    check(ok.rfind("HTTP/1.1 200", 0) == 0, "at limit accepted");
    const std::string over(limit + 1, 'x');
    auto big = f.roundtrip("POST /echo HTTP/1.1\r\nHost: x\r\nContent-Length: " + std::to_string(over.size()) +
                           "\r\n\r\n" + over);
    check(big.rfind("HTTP/1.1 413", 0) == 0, "over limit rejected: " + big.substr(0, 40));
}

TEST_CASE("server: websocket upgrade to an unknown path is rejected") {
    Fixture f;
    const auto out = f.roundtrip(
        "GET /nope HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
        "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n");
    check(out.rfind("HTTP/1.1 404", 0) == 0, "404: " + out.substr(0, 40));
}

TEST_CASE("server: malformed request line closes the connection without a crash") {
    Fixture f;
    const auto out = f.roundtrip("\x01\x02 garbage\r\n\r\n");
    check(out.empty() || out.rfind("HTTP/1.1 4", 0) == 0, "closed");
}

TEST_MAIN()
