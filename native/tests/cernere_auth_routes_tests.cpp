// /api/auth (Cernere 埋め込みログイン) のテスト。
// 新しい交換契約 (Cernere spec/plan/2026-10-30-authcode-service-binding.md):
//   パスキー (PKCE の challenge を送り先と一緒に束縛) → authCode → { code, code_verifier } + project credential token で交換
//   → { user, projectToken } → Tirocinium 自前のセッション。Cernere の user token / refresh は扱わない。
// Cernere には接続しない (偽の fetch と偽の proxy)。URL は .test の架空のもの。
#include "check.hpp"
#include "support/paseto_signer.hpp"
#include "app/auth_routes.hpp"
#include "app/pipeline.hpp"

using namespace tr;
using trtest::check;
using trtest::check_eq;

namespace {

const std::string kOrigin = "https://tr.example.test";
const std::string kCode(43, 'c');
const std::string kVerifier(43, 'v');
const std::string kChallenge(43, 'h');
const std::string kState(32, 's');

struct FakeProxy final : app::CompositeAuthProxy {
    std::vector<std::pair<std::string, Json>> calls;
    Json passkey_login_begin(const Json& payload) override {
        calls.emplace_back("begin", payload);
        return Json{{"options", Json{{"challenge", "wa"}}}, {"challengeOwner", "anon:1"}};
    }
    Json passkey_login_finish(const Json& payload) override {
        calls.emplace_back("finish", payload);
        if (string_or(payload, "challengeOwner") == "boom") throw std::runtime_error("Passkey challenge purpose or destination changed");
        return Json{{"authCode", kCode}};
    }
};

struct FakeSessions final : app::ServiceSessionStore {
    std::map<std::string, std::pair<app::ServiceSessionUser, EpochMs>> rows;
    int counter = 0;
    app::IssuedServiceSession create(const app::ServiceSessionUser& user, EpochMs now) override {
        std::string token(43, 'A');
        token.back() = static_cast<char>('a' + counter++);
        rows[token] = {user, now + app::kServiceSessionTtlMs};
        return {token, now + app::kServiceSessionTtlMs};
    }
    std::optional<std::string> resolve(std::string_view token, EpochMs now) override {
        auto it = rows.find(std::string(token));
        if (it == rows.end() || it->second.second <= now) return std::nullopt;
        return it->second.first.id;
    }
    void revoke(std::string_view token) override { rows.erase(std::string(token)); }
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
    trtest::TestSigner signer;
    app::CernereKeys keys;
    FakeProxy proxy;
    FakeSessions sessions;
    FakeCernere cernere;
    EpochMs clock = now_ms();
    http::Router router;
    std::unique_ptr<app::Authenticator> auth;

    Harness() {
        config.cernere.url = "https://cr.example.test";
        config.cernere.project_client_id = "tr-client";
        config.cernere.project_client_secret = "tr-secret";
        config.cernere_audience = kOrigin;
        config.public_origin = kOrigin;
        config.cernere_public_key = "k4.public." + base64url_encode(signer.public_raw());
        keys.set_configured(config.cernere_public_key);
        auth = std::make_unique<app::Authenticator>(config, keys);
        auth->set_session_resolver([this](std::string_view t) { return sessions.resolve(t, now_ms()); });
        app::register_auth_routes(router, app::AuthRouteDeps{config, cernere.fetch(), keys, proxy, sessions,
                                                             [this] { return clock; }});
        router.add_with("GET", "/api/me", auth->middleware(), [](http::Request&, http::Context& ctx) {
            return http::Response::json(Json{{"id", ctx.user_id.value_or("")}});
        });
        cernere.responses["/api/auth/login"] = {200, Json{{"accessToken", "project-credential"}}};
    }

    std::string project_token(const std::string& sub, const std::string& aud) const {
        Json p{{"sub", sub}, {"aud", aud}, {"exp", iso_from_ms(now_ms() + 600000)}};
        return signer.sign(js_stringify(p));
    }

    void cernere_exchange_ok(const std::string& sub = "u1", const std::string& aud = kOrigin) {
        cernere.responses["/api/auth/exchange"] = {
            200, Json{{"user", Json{{"id", "u1"}, {"displayName", "佐倉"}, {"email", "u1@example.test"}}},
                      {"projectToken", project_token(sub, aud)}}};
    }

    http::Response post(const std::string& path, const std::string& body, const std::string& origin = kOrigin,
                        const std::string& bearer = "") {
        http::Request req;
        req.method = "POST";
        req.target = "/api/auth" + path;
        http::split_target(req.target, req.path, req.raw_query);
        req.headers.set("content-type", "application/json");
        if (!origin.empty()) req.headers.set("origin", origin);
        if (!bearer.empty()) req.headers.set("authorization", "Bearer " + bearer);
        req.body = body;
        return app::handle_request(router, req, nullptr);
    }

    http::Response me(const std::string& token) {
        http::Request req;
        req.method = "GET";
        req.target = "/api/me";
        http::split_target(req.target, req.path, req.raw_query);
        req.headers.set("authorization", "Bearer " + token);
        return app::handle_request(router, req, nullptr);
    }

    static Json json(const http::Response& r) { return parse_json(r.body).value_or(Json(nullptr)); }
};

std::string pkce_body() { return js_stringify(Json{{"code_challenge", kChallenge}, {"state", kState}}); }

std::string exchange_body() { return js_stringify(Json{{"code", kCode}, {"code_verifier", kVerifier}}); }

TEST_CASE("passkey begin binds the PKCE challenge to this project and the registered public origin") {
    Harness h;
    auto res = h.post("/cernere/passkey-login-begin", pkce_body());
    check_eq(res.status, 200, "status");
    check(Harness::json(res)["challengeOwner"] == "anon:1", "begin result relayed");
    check_eq(h.proxy.calls.size(), std::size_t{1}, "one relay");
    check_eq(js_stringify(h.proxy.calls[0].second),
             js_stringify(Json{{"client_id", "tr-client"}, {"target", kOrigin}, {"code_challenge", kChallenge}, {"state", kState}}),
             "client_id and target come from the server config, not the browser");
    // ブラウザが target / client_id を送っても使わない
    h.post("/cernere/passkey-login-begin",
           js_stringify(Json{{"code_challenge", kChallenge}, {"state", kState}, {"target", "https://evil.test"}, {"client_id", "x"}}));
    check(h.proxy.calls[1].second["target"] == kOrigin && h.proxy.calls[1].second["client_id"] == "tr-client",
          "browser cannot pick the destination");
}

TEST_CASE("passkey begin requires an S256 challenge and a state") {
    Harness h;
    check_eq(h.post("/cernere/passkey-login-begin", "{}").status, 400, "missing");
    check_eq(h.post("/cernere/passkey-login-begin", js_stringify(Json{{"code_challenge", "short"}, {"state", kState}})).status,
             400, "challenge shape");
    check_eq(h.post("/cernere/passkey-login-begin", js_stringify(Json{{"code_challenge", kChallenge}, {"state", "s"}})).status,
             400, "state shape");
    check(h.proxy.calls.empty(), "nothing relayed");
}

TEST_CASE("passkey finish relays the assertion with the same binding and returns the authCode") {
    Harness h;
    Json body{{"code_challenge", kChallenge}, {"state", kState}, {"challengeOwner", "anon:1"}, {"response", Json{{"id", "cred"}}}};
    auto res = h.post("/cernere/passkey-login-finish", js_stringify(body));
    check_eq(res.status, 200, "status");
    check(Harness::json(res)["authCode"] == kCode, "authCode");
    const Json& sent = h.proxy.calls[0].second;
    check(sent["client_id"] == "tr-client" && sent["target"] == kOrigin && sent["code_challenge"] == kChallenge &&
              sent["state"] == kState && sent["challengeOwner"] == "anon:1" && sent["response"]["id"] == "cred",
          "finish payload");
    body["response"] = "not an object";
    check_eq(h.post("/cernere/passkey-login-finish", js_stringify(body)).status, 400, "response must be an object");
    body["response"] = Json::object();
    body["challengeOwner"] = "boom";
    auto err = h.post("/cernere/passkey-login-finish", js_stringify(body));
    check(err.status == 400 && Harness::json(err)["error"] == "Passkey challenge purpose or destination changed",
          "Cernere message shown");
}

TEST_CASE("exchange sends code + code_verifier with the project credential token and issues a Tirocinium session") {
    Harness h;
    h.cernere_exchange_ok();
    auto res = h.post("/exchange", exchange_body());
    check_eq(res.status, 200, "status");
    const Json b = Harness::json(res);
    const std::string token = b["sessionToken"].get<std::string>();
    check(app::is_service_session_token(token), "opaque session token");
    check(b["expiresAt"] == h.clock + app::kServiceSessionTtlMs, "fixed expiry");
    check(b["user"] == Json{{"id", "u1"}, {"displayName", "佐倉"}}, "user");
    check(!b.contains("refreshToken") && !b.contains("token"), "no Cernere tokens handed to the browser");

    check_eq(h.cernere.calls.size(), std::size_t{2}, "project login + exchange only");
    check_eq(h.cernere.calls[0].url, std::string("https://cr.example.test/api/auth/login"), "project credential login");
    check(h.cernere.calls[0].body["grant_type"] == "project_credentials", "grant type");
    check_eq(h.cernere.calls[1].url, std::string("https://cr.example.test/api/auth/exchange"), "exchange url");
    check_eq(header(h.cernere.calls[1], "authorization"), std::string("Bearer project-credential"), "project bearer");
    check_eq(js_stringify(h.cernere.calls[1].body), exchange_body(), "exchange body");
    for (const auto& c : h.cernere.calls) {
        check(c.url.find("project-token") == std::string::npos && c.url.find("refresh") == std::string::npos,
              "old project-token / refresh calls are gone");
    }

    // 自前セッションで API に入れる
    auto me = h.me(token);
    check(me.status == 200 && Harness::json(me)["id"] == "u1", "session authenticates");
}

TEST_CASE("exchange rejects the old body, extra fields and non-S256 verifiers without calling Cernere") {
    Harness h;
    h.cernere_exchange_ok();
    check_eq(h.post("/exchange", R"({"authCode":"code-1"})").status, 400, "old { authCode } body");
    check_eq(h.post("/exchange", js_stringify(Json{{"code", kCode}})).status, 400, "verifier required");
    check_eq(h.post("/exchange", js_stringify(Json{{"code", kCode}, {"code_verifier", "short"}})).status, 400, "verifier shape");
    check_eq(h.post("/exchange", js_stringify(Json{{"code", kCode}, {"code_verifier", kVerifier}, {"refreshToken", "x"}})).status,
             400, "extra field");
    check(h.cernere.calls.empty(), "Cernere not called");
    check(h.sessions.rows.empty(), "no session");
}

TEST_CASE("exchange maps a rejected code to 401 and a foreign project token to 502, issuing no session") {
    Harness h;
    h.cernere.responses["/api/auth/exchange"] = {401, Json{{"error", "Invalid or expired auth code"}}};
    check_eq(h.post("/exchange", exchange_body()).status, 401, "rejected code");

    h.cernere_exchange_ok("u1", "https://other.example.test");
    check_eq(h.post("/exchange", exchange_body()).status, 502, "audience must be this service");
    h.cernere_exchange_ok("u2", kOrigin);
    check_eq(h.post("/exchange", exchange_body()).status, 502, "subject must be the exchanged user");
    h.cernere.responses["/api/auth/exchange"] = {200, Json{{"user", Json{{"id", "u1"}}}}};
    check_eq(h.post("/exchange", exchange_body()).status, 502, "projectToken required");
    check(h.sessions.rows.empty(), "no session issued");

    h.cernere.responses["/api/auth/login"] = {401, Json{{"error", "bad credential"}}};
    h.cernere_exchange_ok();
    check_eq(h.post("/exchange", exchange_body()).status, 502, "project credential rejected");
    h.config.cernere.project_client_secret = "";
    check_eq(h.post("/exchange", exchange_body()).status, 503, "project credential not configured");
}

TEST_CASE("auth routes only accept the configured https public origin") {
    Harness h;
    h.cernere_exchange_ok();
    check_eq(h.post("/exchange", exchange_body(), "https://evil.test").status, 403, "foreign origin");
    check_eq(h.post("/exchange", exchange_body(), "").status, 403, "no origin");
    check_eq(h.post("/cernere/passkey-login-begin", pkce_body(), "https://evil.test").status, 403, "begin foreign origin");
    h.config.public_origin = "";
    check_eq(h.post("/exchange", exchange_body(), "").status, 503, "not configured");
    h.config.public_origin = "http://localhost:5178";
    check_eq(h.post("/exchange", exchange_body(), "http://localhost:5178").status, 503, "loopback cannot be registered");
    check(h.cernere.calls.empty() && h.proxy.calls.empty(), "nothing relayed");

    check(app::is_registrable_public_origin("https://tr.example.test"), "https origin");
    check(app::is_registrable_public_origin("https://tr.example.test:8443"), "https with port");
    check(!app::is_registrable_public_origin("http://tr.example.test"), "http");
    check(!app::is_registrable_public_origin("https://tr.example.test/"), "trailing slash");
    check(!app::is_registrable_public_origin("https://tr.example.test/app"), "path");
    check(!app::is_registrable_public_origin("https://localhost"), "localhost");
    check(!app::is_registrable_public_origin("https://a.localhost"), "*.localhost");
    check(!app::is_registrable_public_origin("https://127.0.0.2"), "127/8");
    check(!app::is_registrable_public_origin("https://[::1]"), "::1");
    check(!app::is_registrable_public_origin("tauri://localhost"), "tauri webview");
}

TEST_CASE("the old refresh and password routes are gone, and logout revokes the session") {
    Harness h;
    check_eq(h.post("/refresh", R"({"refreshToken":"x"})").status, 404, "no refresh");
    check_eq(h.post("/cernere/login", R"({"email":"a@test","password":"p"})").status, 404, "no password login");
    check_eq(h.post("/cernere/mfa-verify", "{}").status, 404, "no mfa relay");

    h.cernere_exchange_ok();
    const std::string token = Harness::json(h.post("/exchange", exchange_body()))["sessionToken"].get<std::string>();
    check_eq(h.me(token).status, 200, "valid before logout");
    check_eq(h.post("/logout", "", kOrigin).status, 401, "logout needs the session");
    check_eq(h.post("/logout", "", kOrigin, token).status, 200, "logout");
    check_eq(h.me(token).status, 401, "revoked");
    check_eq(h.me(std::string(43, 'Z')).status, 401, "unknown session token");
}

TEST_CASE("an expired session is refused and downstream Cernere tokens still authenticate") {
    Harness h;
    h.sessions.rows[std::string(43, 'E')] = {app::ServiceSessionUser{"u9", ""}, now_ms() - 1};
    check_eq(h.me(std::string(43, 'E')).status, 401, "expired session");
    // GLAB などからの下流呼び出し (aud = CERNERE_AUDIENCE の PASETO) は従来どおり通る
    auto me = h.me(h.project_token("u7", kOrigin));
    check(me.status == 200 && Harness::json(me)["id"] == "u7", "downstream PASETO");
}

}  // namespace

TEST_MAIN()
