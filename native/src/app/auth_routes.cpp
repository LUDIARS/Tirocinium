#include "app/auth_routes.hpp"

#include <memory>

#include "app/cernere_exchange.hpp"
#include "app/services.hpp"
#include "core/text.hpp"
#include "core/url.hpp"

namespace tr::app {

namespace {

// パスキーの応答 (WebAuthn assertion) を含めても数 KB。これを超える本文は読まない。
constexpr std::size_t kMaxAuthBodyBytes = 16 * 1024;
constexpr std::size_t kMaxChallengeOwnerBytes = 128;

bool is_loopback_name(const std::string& host) {
    if (host == "localhost" || ends_with(host, ".localhost") || host == "::1") return true;
    return parse_whatwg_ipv4(host).has_value() && starts_with(host, "127.");
}

// Cernere の state の規則: base64url 32〜512 文字。
bool is_state(std::string_view state) {
    if (state.size() < 32 || state.size() > 512) return false;
    for (char c : state) {
        const bool ok = (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-' || c == '_';
        if (!ok) return false;
    }
    return true;
}

http::Response error(const std::string& code, int status) { return http::Response::json(Json{{"error", code}}, status); }

http::Response fail(const std::exception_ptr& ep) {
    try {
        std::rethrow_exception(ep);
    } catch (const CernereNotConfiguredError&) {
        return error("login_not_configured", 503);
    } catch (const CernereSessionError& e) {
        return error(e.what(), e.status());
    } catch (const std::exception& e) {
        // Cernere が返したエラー文 (パスキーの失敗など) はそのまま利用者へ見せる
        const std::string msg = e.what();
        return error(msg.empty() ? std::string("login_failed") : msg, 400);
    } catch (...) {
        return error("login_failed", 400);
    }
}

class AuthRoutes {
public:
    explicit AuthRoutes(const AuthRouteDeps& deps) : d_(deps) {}

    http::Response begin(http::Request& req) const {
        Json body;
        if (auto denied = admit(req, body)) return *denied;
        auto payload = composite_payload(body);
        if (!payload) return error("code_challenge と state が必要です", 400);
        try {
            return http::Response::json(d_.proxy.passkey_login_begin(*payload));
        } catch (...) {
            return fail(std::current_exception());
        }
    }

    http::Response finish(http::Request& req) const {
        Json body;
        if (auto denied = admit(req, body)) return *denied;
        auto payload = composite_payload(body);
        const std::string owner = string_or(body, "challengeOwner");
        const Json* response = member(body, "response");
        if (!payload || owner.empty() || owner.size() > kMaxChallengeOwnerBytes || !response || !response->is_object()) {
            return error("challengeOwner と response と code_challenge と state が必要です", 400);
        }
        (*payload)["challengeOwner"] = owner;
        (*payload)["response"] = *response;
        try {
            return http::Response::json(d_.proxy.passkey_login_finish(*payload));
        } catch (...) {
            return fail(std::current_exception());
        }
    }

    http::Response exchange(http::Request& req) const {
        Json body;
        if (auto denied = admit(req, body)) return *denied;
        // 余分な項目は受けない (旧形式の { authCode } などを黙って通さない)
        for (const auto& item : body.items()) {
            if (item.key() != "code" && item.key() != "code_verifier") {
                return error("code と code_verifier だけを送ってください", 400);
            }
        }
        const std::string code = string_or(body, "code");
        const std::string verifier = string_or(body, "code_verifier");
        if (!is_authorization_code(code) || !is_pkce_verifier(verifier)) return error("code と code_verifier が必要です", 400);
        try {
            const EpochMs now = d_.now();
            const auto user = exchange_service_code(d_.config, d_.fetch, d_.keys, code, verifier, now);
            const auto session = d_.sessions.create(user, now);
            return http::Response::json(Json{{"sessionToken", session.token},
                                             {"expiresAt", session.expires_at},
                                             {"user", {{"id", user.id}, {"displayName", user.display_name}}}});
        } catch (...) {
            return fail(std::current_exception());
        }
    }

    http::Response logout(http::Request& req) const {
        Json body;
        if (auto denied = admit(req, body)) return *denied;
        const auto header = req.header("authorization");
        if (!header || !starts_with(ascii_lower(*header), "bearer ")) return error("unauthorized", 401);
        d_.sessions.revoke(header->substr(7));
        return http::Response::json(Json{{"ok", true}});
    }

private:
    // 公開オリジンの設定とブラウザの Origin を確かめ、本文を JSON object として読む。
    // 本文は read_json_body (Lorica の input_budget で課金) で読む。
    std::optional<http::Response> admit(http::Request& req, Json& body) const {
        if (!is_registrable_public_origin(d_.config.public_origin)) return error("login_not_configured", 503);
        const auto origin = req.header("origin");
        if (!origin || *origin != d_.config.public_origin) return error("invalid_origin", 403);
        if (req.body.size() > kMaxAuthBodyBytes) return error("payload_too_large", 413);
        if (req.body.empty()) {
            body = Json::object();
            return std::nullopt;
        }
        auto parsed = read_json_body(req);
        if (!parsed || !parsed->is_object()) return error("invalid_json", 400);
        body = std::move(*parsed);
        return std::nullopt;
    }

    // ブラウザが送る PKCE の challenge と state に、送り先 (project と公開オリジン) を合わせる。
    // 送り先はブラウザから受け取らない。
    [[nodiscard]] std::optional<Json> composite_payload(const Json& body) const {
        const std::string challenge = string_or(body, "code_challenge");
        const std::string state = string_or(body, "state");
        if (!is_pkce_s256_challenge(challenge) || !is_state(state)) return std::nullopt;
        return Json{{"client_id", d_.config.cernere.project_client_id},
                    {"target", d_.config.public_origin},
                    {"code_challenge", challenge},
                    {"state", state}};
    }

    AuthRouteDeps d_;
};

}  // namespace

bool is_registrable_public_origin(std::string_view origin) {
    auto url = parse_url(origin);
    if (!url || url->scheme != "https" || url->target != "/") return false;
    if (url->origin() != origin) return false;  // path・userinfo・末尾の / や大文字の違いを許さない
    return !is_loopback_name(url->host);
}

void register_auth_routes(http::Router& r, const AuthRouteDeps& deps) {
    auto routes = std::make_shared<AuthRoutes>(deps);
    r.post("/api/auth/cernere/passkey-login-begin",
           [routes](http::Request& req, http::Context&) { return routes->begin(req); });
    r.post("/api/auth/cernere/passkey-login-finish",
           [routes](http::Request& req, http::Context&) { return routes->finish(req); });
    r.post("/api/auth/exchange", [routes](http::Request& req, http::Context&) { return routes->exchange(req); });
    r.post("/api/auth/logout", [routes](http::Request& req, http::Context&) { return routes->logout(req); });
}

}  // namespace tr::app
