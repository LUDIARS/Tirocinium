#include "check.hpp"
#include "app/pipeline.hpp"
#include "http/cors.hpp"
#include "http/router.hpp"

using namespace tr;
using trtest::check;
using trtest::check_eq;

namespace {

http::Request make(std::string method, std::string target, std::string body = {}) {
    http::Request r;
    r.method = std::move(method);
    r.target = std::move(target);
    http::split_target(r.target, r.path, r.raw_query);
    r.body = std::move(body);
    return r;
}

}  // namespace

TEST_CASE("router: pattern match with params and wildcard prefix") {
    std::map<std::string, std::string> p;
    check(http::Router::match("/api/v1/sessions/:id/summary", "/api/v1/sessions/abc/summary", p), "params");
    check_eq(p["id"], std::string("abc"), "param value");
    check(http::Router::match("/api/v1/sessions/*", "/api/v1/sessions", p), "wildcard matches base");
    check(http::Router::match("/api/v1/sessions/*", "/api/v1/sessions/x/y", p), "wildcard matches deeper");
    check(!http::Router::match("/api/v1/sessions/*", "/api/v1/sessionsX", p), "wildcard needs a separator");
    check(!http::Router::match("/api/health", "/api/health/", p), "strict trailing slash (hono strict)");
    check(!http::Router::match("/a/:id", "/a/", p), "empty param");
    check(http::Router::match("/a/:id", "/a/%E9%9D%A2", p) && p["id"] == "面", "param decodeURIComponent");
}

TEST_CASE("router: registration order, middleware short-circuit, 404 for unknown") {
    http::Router r;
    r.get("/api/v1/x/client.js", [](http::Request&, http::Context&) { return http::Response::text("js"); });
    r.use("/api/v1/x/*", [](http::Request& req, http::Context&) -> std::optional<http::Response> {
        if (!req.header("authorization")) return http::Response::json(Json{{"error", "unauthorized"}}, 401);
        return std::nullopt;
    });
    r.get("/api/v1/x/:id", [](http::Request& req, http::Context&) { return http::Response::json(Json{{"id", req.param("id")}}); });
    http::Context ctx;
    auto a = make("GET", "/api/v1/x/client.js");
    check_eq(r.dispatch(a, ctx).status, 200, "route registered before the middleware is public");
    auto b = make("GET", "/api/v1/x/42");
    check_eq(r.dispatch(b, ctx).status, 401, "middleware applies");
    auto c = make("GET", "/api/v1/x/unknown/deeper");
    check_eq(r.dispatch(c, ctx).status, 401, "middleware applies before notFound (hono order)");
    auto d = make("GET", "/nope");
    auto res = r.dispatch(d, ctx);
    check_eq(res.status, 404, "unknown path");
    check_eq(res.body, std::string(R"({"error":"not_found"})"), "notFound body");
    auto e = make("HEAD", "/api/v1/x/client.js");
    auto head = r.dispatch(e, ctx);
    check(head.status == 200 && head.body.empty(), "HEAD uses GET handler without body");
}

TEST_CASE("query: first value, '+' to space, percent decoding") {
    auto r = make("GET", "/x?q=a+b&q=second&z=%E9%9D%A2&bad=%E9%9D&flag");
    check_eq(*r.query("q"), std::string("a b"), "first value with + as space");
    check_eq(*r.query("z"), std::string("面"), "decoded");
    check_eq(*r.query("bad"), std::string("%E9%9D"), "invalid escape kept as-is (tryDecode)");
    check_eq(*r.query("flag"), std::string(""), "flag without value");
    check(!r.query("missing").has_value(), "missing");
}

TEST_CASE("cors: OPTIONS preflight is 204 with reflected headers; others carry ACAO *") {
    auto pre = make("OPTIONS", "/api/v1/anything");
    pre.headers.set("access-control-request-headers", "Authorization , Content-Type");
    auto res = http::with_cors(pre, [] { return http::Response::text("unreached"); });
    check_eq(res.status, 204, "preflight");
    check_eq(*res.headers.get("access-control-allow-methods"), std::string("GET,HEAD,PUT,POST,DELETE,PATCH"), "methods");
    check_eq(*res.headers.get("access-control-allow-headers"), std::string("Authorization,Content-Type"), "reflected");
    check_eq(*res.headers.get("vary"), std::string("Access-Control-Request-Headers"), "vary");
    auto get = make("GET", "/x");
    auto ok = http::with_cors(get, [] { return http::Response::json(Json{{"ok", true}}); });
    check_eq(*ok.headers.get("access-control-allow-origin"), std::string("*"), "acao on normal responses");
}

TEST_CASE("pipeline: handler exceptions become 500 internal without detail") {
    http::Router r;
    r.get("/boom", [](http::Request&, http::Context&) -> http::Response { throw std::runtime_error("secret detail"); });
    auto req = make("GET", "/boom");
    std::string logged;
    auto res = app::handle_request(r, req, [&](const std::string& s) { logged = s; });
    check_eq(res.status, 500, "status");
    check_eq(res.body, std::string(R"({"error":"internal"})"), "body hides detail");
    check(logged.find("secret detail") != std::string::npos, "detail goes to the server log only");
}

TEST_CASE("pipeline: body over the route limit is 413 (materials route decides itself)") {
    http::Router r;
    r.post("/api/v1/feedback", [](http::Request&, http::Context&) { return http::Response::json(Json{{"ok", true}}); });
    auto req = make("POST", "/api/v1/feedback");
    req.body_too_large = true;
    auto res = app::handle_request(r, req, nullptr);
    check_eq(res.status, 413, "generic limit");
    auto m = make("POST", "/api/v1/sessions/abc/materials");
    check_eq(app::body_limit_for(m), std::size_t{7 * 1024 * 1024}, "materials 7 MiB like Node bodyLimit");
    check_eq(app::body_limit_for(req), std::size_t{2 * 1024 * 1024}, "default 2 MiB");
}

TEST_MAIN()
