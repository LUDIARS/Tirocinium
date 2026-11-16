#include "app/cernere_exchange.hpp"

namespace tr::app {

namespace {

constexpr std::size_t kMaxExchangeResponseBytes = 64 * 1024;
constexpr std::size_t kMaxDisplayNameBytes = 256;

bool all_of(std::string_view text, bool (*allowed)(char)) {
    for (char c : text) {
        if (!allowed(c)) return false;
    }
    return true;
}

bool base64url_char(char c) {
    return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-' || c == '_';
}

bool verifier_char(char c) { return base64url_char(c) || c == '.' || c == '~'; }

const Json& unwrap_data(const Json& body) {
    // Cernere の応答は { data: {...} } で包まれる経路があるので両方を受ける
    if (const Json* d = member(body, "data"); d && d->is_object()) return *d;
    return body;
}

Json post_exchange(const Config& config, const HttpFetch& fetch, const std::string& project_token, const std::string& code,
                   const std::string& verifier) {
    io::HttpClientRequest req;
    req.method = "POST";
    req.url = config.cernere.url + "/api/auth/exchange";
    req.headers = {{"content-type", "application/json"}, {"authorization", "Bearer " + project_token}};
    req.body = js_stringify(Json{{"code", code}, {"code_verifier", verifier}});
    req.timeout = std::chrono::milliseconds(15'000);
    req.max_response_bytes = kMaxExchangeResponseBytes;
    const auto res = fetch(req);
    if (res.status == 400 || res.status == 401 || res.status == 403) {
        throw CernereSessionError("Cernere rejected the authorization code", 401);
    }
    if (!res.ok()) throw CernereSessionError("Cernere /api/auth/exchange failed: HTTP " + std::to_string(res.status), 502);
    // 応答は外部入力。大きさ・要素数・深さを予算で縛って読む。
    auto body = parse_json(res.body, JsonLimits{kMaxExchangeResponseBytes, 256, 8});
    if (!body || !body->is_object()) throw CernereSessionError("Cernere exchange response is not JSON", 502);
    return unwrap_data(*body);
}

}  // namespace

bool is_authorization_code(std::string_view code) { return code.size() == 43 && all_of(code, base64url_char); }

bool is_pkce_verifier(std::string_view verifier) {
    return verifier.size() >= 43 && verifier.size() <= 128 && all_of(verifier, verifier_char);
}

bool is_pkce_s256_challenge(std::string_view challenge) {
    return challenge.size() == 43 && all_of(challenge, base64url_char);
}

ServiceSessionUser exchange_service_code(const Config& config, const HttpFetch& fetch, const CernereKeys& keys,
                                         const std::string& code, const std::string& code_verifier, EpochMs now) {
    if (!is_authorization_code(code) || !is_pkce_verifier(code_verifier)) {
        throw CernereSessionError("code and S256 code_verifier are required", 400);
    }
    if (keys.verification_keys().empty()) throw CernereNotConfiguredError("Cernere public key is not configured");
    const std::string credential = fetch_project_credential_token(config, fetch);
    const Json result = post_exchange(config, fetch, credential, code, code_verifier);

    const Json* user = member(result, "user");
    const std::string user_id = user ? string_or(*user, "id") : "";
    const std::string project_token = string_or(result, "projectToken");
    if (user_id.empty() || project_token.empty()) throw CernereSessionError("Cernere exchange response is incomplete", 502);
    // 表示名は外部の値。上限を超えたら保存しない (応答全体は parse_json の予算で縛ってある)。
    std::string display_name = user ? string_or(*user, "displayName") : "";
    if (display_name.size() > kMaxDisplayNameBytes) display_name.clear();

    // projectToken は Tirocinium (aud = 登録した hub_url) 宛てで、交換した本人のものでなければならない。
    const auto subject = verify_cernere_subject(keys, project_token, config.cernere_audience, now);
    if (!subject || *subject != user_id) {
        throw CernereSessionError("Cernere project token is not for this service or user (check CERNERE_AUDIENCE)", 502);
    }
    return ServiceSessionUser{user_id, display_name};
}

}  // namespace tr::app
