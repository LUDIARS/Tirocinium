// routes/auth.test.ts の移植 (/api/auth の composite 代理・authCode 交換・refresh)。
// Cernere には接続しない (偽の fetch と偽の proxy)。URL は .test の架空のもの。
#include "check.hpp"
#include "app/cernere.hpp"
#include "app/pipeline.hpp"

using namespace tr;
using trtest::check;
using trtest::check_eq;

namespace {

struct FakeProxy final : app::CompositeAuthProxy {
    Json login(const std::string& email, const std::string&) override {
        if (email == "mfa@test") return Json{{"mfaRequired", true}, {"mfaToken", "m1"}, {"mfaMethods", Json::array({"totp"})}};
        if (email == "boom@test") throw std::runtime_error("invalid credentials");
        if (email == "off@test") throw app::CernereNotConfiguredError("x");
        return Json{{"authCode", "code-1"}};
    }
    Json register_user(const std::string&, const std::string&, const std::string&) override { return Json{{"authCode", "code-2"}}; }
    Json mfa_verify(const std::string&, const std::string&, const std::string&) override { return Json{{"authCode", "code-3"}}; }
};

struct Call {
    std::string url;
    std::vector<std::pair<std::string, std::string>> headers;
    Json body;
};

struct FakeCernere {
    std::map<std::string, std::pair<int, Json>> responses;  // path → (status, body)
    std::vector<Call> calls;
    app::HttpFetch fetch() {
        return [this](const io::HttpClientRequest& r) {
            auto parsed = parse_json(r.body);
            calls.push_back({r.url, r.headers, parsed ? *parsed : Json(nullptr)});
            const auto path = r.url.substr(r.url.find('/', std::string("https://").size()));
            io::HttpClientResponse res;
            auto it = responses.find(path);
            res.status = it == responses.end() ? 404 : it->second.first;
            res.body = it == responses.end() ? "{}" : js_stringify(it->second.second);
            return res;
        };
    }
};

std::string header(const Call& c, const std::string& name) {
    for (const auto& [k, v] : c.headers) {
        if (k == name) return v;
    }
    return "";
}

struct Harness {
    app::Config config;
    FakeProxy proxy;
    FakeCernere cernere;
    http::Router router;
    Harness() {
        config.cernere.url = "https://cr.example.test";
        config.cernere_audience = "tirocinium";
        app::register_auth_routes(router, config, cernere.fetch(), proxy);
    }
    http::Response post(const std::string& path, const std::string& body) {
        http::Request req;
        req.method = "POST";
        req.target = "/api/auth" + path;
        http::split_target(req.target, req.path, req.raw_query);
        req.headers.set("content-type", "application/json");
        req.body = body;
        return app::handle_request(router, req, nullptr);
    }
    static Json json(const http::Response& r) { return parse_json(r.body).value_or(Json(nullptr)); }
};

TEST_CASE("/api/auth relays composite login, register and MFA and returns the authCode or MFA challenge") {
    Harness h;
    check_eq(js_stringify(Harness::json(h.post("/cernere/login", R"({"email":"a@test","password":"p"})"))),
             std::string(R"({"authCode":"code-1"})"), "login");
    auto mfa = Harness::json(h.post("/cernere/login", R"({"email":"mfa@test","password":"p"})"));
    check(mfa["mfaRequired"] == true && mfa["mfaToken"] == "m1", "mfa challenge");
    check_eq(js_stringify(Harness::json(h.post("/cernere/register", R"({"name":"n","email":"a@test","password":"p"})"))),
             std::string(R"({"authCode":"code-2"})"), "register");
    check_eq(js_stringify(Harness::json(h.post("/cernere/mfa-verify", R"({"mfaToken":"m1","method":"totp","code":"123456"})"))),
             std::string(R"({"authCode":"code-3"})"), "mfa verify");
    check_eq(h.post("/cernere/login", R"({"email":"a@test"})").status, 400, "missing password");
    check_eq(h.post("/cernere/login", R"([1])").status, 400, "array body is {}");
    auto err = h.post("/cernere/login", R"({"email":"boom@test","password":"p"})");
    check(err.status == 400 && Harness::json(err)["error"] == "invalid credentials", "Cernere message shown");
    auto off = h.post("/cernere/login", R"({"email":"off@test","password":"p"})");
    check(off.status == 503 && Harness::json(off)["error"] == "login_not_configured", "not configured");
}

TEST_CASE("/api/auth exchanges an authCode for a user x project token scoped to the configured audience") {
    Harness h;
    h.cernere.responses["/api/auth/exchange"] = {200, Json{{"accessToken", "user-at"}, {"refreshToken", "user-rt"}, {"user", Json{{"id", "u1"}}}}};
    h.cernere.responses["/api/auth/project-token"] = {
        200, Json{{"accessToken", "v4.public.tr"}, {"expiresIn", 900}, {"userId", "u1"}, {"displayName", "佐倉"}}};
    auto res = h.post("/exchange", R"({"authCode":"code-1"})");
    check_eq(res.status, 200, "status");
    check_eq(js_stringify(Harness::json(res)),
             std::string(R"({"token":"v4.public.tr","expiresIn":900,"refreshToken":"user-rt","user":{"id":"u1","displayName":"佐倉"}})"),
             "body");
    check_eq(h.cernere.calls.size(), std::size_t{2}, "two calls");
    check_eq(h.cernere.calls[0].url, std::string("https://cr.example.test/api/auth/exchange"), "exchange url");
    check_eq(js_stringify(h.cernere.calls[0].body), std::string(R"({"code":"code-1"})"), "exchange body");
    check_eq(h.cernere.calls[1].url, std::string("https://cr.example.test/api/auth/project-token"), "project token url");
    check_eq(header(h.cernere.calls[1], "authorization"), std::string("Bearer user-at"), "bearer");
    check(h.cernere.calls[1].body["project_key"] == "tirocinium" && h.cernere.calls[1].body["hub_url"] == "tirocinium",
          "audience-scoped project token");
}

TEST_CASE("/api/auth refreshes through Cernere and keeps the old refresh token when none is rotated") {
    Harness h;
    h.cernere.responses["/api/auth/refresh"] = {200, Json{{"data", Json{{"accessToken", "user-at2"}}}}};
    h.cernere.responses["/api/auth/project-token"] = {200, Json{{"data", Json{{"accessToken", "v4.public.tr2"}, {"expiresIn", 900}, {"userId", "u1"}}}}};
    auto b = Harness::json(h.post("/refresh", R"({"refreshToken":"user-rt"})"));
    check(b["token"] == "v4.public.tr2" && b["refreshToken"] == "user-rt" && b["user"]["id"] == "u1", "refreshed");
}

TEST_CASE("/api/auth maps a rejected authCode to 401 and a missing Cernere URL to 503") {
    Harness h;
    h.cernere.responses["/api/auth/exchange"] = {401, Json{{"error", "invalid code"}}};
    check_eq(h.post("/exchange", R"({"authCode":"bad"})").status, 401, "rejected");
    h.config.cernere.url = "";
    check_eq(h.post("/exchange", R"({"authCode":"x"})").status, 503, "not configured");
    check_eq(h.post("/exchange", "{}").status, 400, "missing authCode");
    check_eq(h.post("/refresh", "{}").status, 400, "missing refreshToken");
}

}  // namespace

TEST_MAIN()
