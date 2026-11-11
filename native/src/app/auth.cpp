#include "app/auth.hpp"

#include <stdexcept>

#include "core/encoding.hpp"
#include "core/paseto.hpp"
#include "core/text.hpp"
#include "http/message.hpp"

namespace tr::app {

void CernereKeys::set_configured(const std::string& key_text) {
    std::lock_guard lock(mu_);
    configured_ = !key_text.empty();
    configured_key_ = configured_ ? crypto::Ed25519PublicKey::from_config_string(key_text) : std::nullopt;
}

void CernereKeys::set_fetched(std::vector<crypto::Ed25519PublicKey> keys) {
    std::lock_guard lock(mu_);
    fetched_ = std::move(keys);
}

std::vector<std::optional<crypto::Ed25519PublicKey>> CernereKeys::verification_keys() const {
    std::lock_guard lock(mu_);
    std::vector<std::optional<crypto::Ed25519PublicKey>> out;
    if (configured_) {
        out.push_back(configured_key_);
        return out;
    }
    for (const auto& k : fetched_) out.emplace_back(k);
    return out;
}

std::size_t CernereKeys::fetched_count() const {
    std::lock_guard lock(mu_);
    return fetched_.size();
}

std::vector<crypto::Ed25519PublicKey> parse_public_key_set(const Json& body) {
    std::vector<crypto::Ed25519PublicKey> out;
    const Json* keys = member(body, "keys");
    if (!keys || !keys->is_array()) return out;
    for (const auto& k : *keys) {
        const Json* pk = member(k, "public_key");
        if (!pk || !pk->is_string()) continue;
        const Json* alg = member(k, "alg");
        // !k.alg || k.alg === 'EdDSA' (alg が空文字・null・false も「無い」扱い)
        const bool alg_absent = !alg || alg->is_null() || (alg->is_string() && alg->get<std::string>().empty()) ||
                                (alg->is_boolean() && !alg->get<bool>()) ||
                                (alg->is_number() && alg->get<double>() == 0);
        if (!alg_absent && !(alg->is_string() && alg->get<std::string>() == "EdDSA")) continue;
        const std::string raw = base64_decode_lenient(pk->get<std::string>());
        auto key = crypto::Ed25519PublicKey::from_raw(raw);
        if (!key) throw std::runtime_error("Ed25519 public key must be 32 bytes (got " + std::to_string(raw.size()) + ")");
        out.push_back(*key);
    }
    return out;
}

std::optional<Json> verify_v4_public(const std::string& token, const crypto::Ed25519PublicKey& key,
                                     const std::string& audience, EpochMs now) {
    auto parts = paseto::split_v4_public(token);
    if (!parts) return std::nullopt;
    if (!key.verify(paseto::signing_input(*parts), parts->signature)) return std::nullopt;
    auto payload = paseto::parse_payload(parts->message);
    if (!payload) return std::nullopt;
    if (paseto::assert_payload(*payload, audience, now)) return std::nullopt;
    return payload;
}

void Authenticator::assert_safe_config() const {
    if (config_.dev_auth && !is_loopback_host(config_.host)) {
        throw std::runtime_error("TIROCINIUM_DEV_AUTH=1 is only allowed on loopback hosts");
    }
}

std::optional<std::string> Authenticator::dev_auth_user_id() const {
    if (!config_.dev_auth) return std::nullopt;
    assert_safe_config();
    return config_.dev_user_id;
}

std::optional<http::Response> Authenticator::require(http::Request& req, http::Context& ctx) const {
    // dev プロファイル: Cernere を持たない 1 台環境用に固定 dev ユーザで素通し (loopback bind のときのみ)。
    if (auto dev = dev_auth_user_id()) {
        ctx.user_id = *dev;
        return std::nullopt;
    }
    const auto header = req.header("authorization");
    if (!header || !starts_with(ascii_lower(*header), "bearer ")) {
        return http::Response::json(Json{{"error", "unauthorized"}}, 401);
    }
    const std::string token = header->substr(7);
    const auto keys = keys_.verification_keys();
    if (keys.empty()) {
        // 鍵未設定なら 503 にして「沈黙の素通し」を防ぐ
        return http::Response::json(Json{{"error", "auth_not_configured"}}, 503);
    }
    const EpochMs now = now_ms();
    std::optional<Json> payload;
    for (const auto& key : keys) {
        if (!key) continue;
        payload = verify_v4_public(token, *key, config_.cernere_audience, now);
        if (payload) break;
    }
    if (!payload) return http::Response::json(Json{{"error", "invalid_token"}}, 401);
    if (const Json* exp = member(*payload, "exp"); exp && exp->is_string() && !exp->get<std::string>().empty()) {
        auto t = parse_iso_ms(exp->get<std::string>());
        if (t && *t < now_ms()) return http::Response::json(Json{{"error", "expired"}}, 401);
    }
    // Node 版は sub が無いトークンでも user.id = undefined で通していた (後段の SQL で失敗する)。
    // C++ 版は sub が文字列で空でないことを要求し、無ければ invalid_token にする (締める方向の差)。
    const Json* sub = member(*payload, "sub");
    if (!sub || !sub->is_string() || sub->get<std::string>().empty()) {
        return http::Response::json(Json{{"error", "invalid_token"}}, 401);
    }
    ctx.user_id = sub->get<std::string>();
    return std::nullopt;
}

http::Middleware Authenticator::middleware() const {
    return [this](http::Request& req, http::Context& ctx) { return require(req, ctx); };
}

std::optional<std::string> Authenticator::authenticate_ws(const http::Request& req) const {
    if (auto dev = dev_auth_user_id()) return dev;
    std::optional<std::string> token;
    if (auto auth = req.header("authorization"); auth && starts_with(ascii_lower(*auth), "bearer ")) {
        token = auth->substr(7);
    } else {
        // url.match(/[?&]token=([^&]+)/) → decodeURIComponent (不正な列は例外 = 500)
        const std::string& url = req.target;
        for (std::size_t pos = url.find("token="); pos != std::string::npos; pos = url.find("token=", pos + 1)) {
            if (pos == 0 || (url[pos - 1] != '?' && url[pos - 1] != '&')) continue;
            const std::size_t start = pos + 6;
            const std::size_t end = url.find('&', start);
            const std::string raw = url.substr(start, end == std::string::npos ? std::string::npos : end - start);
            if (raw.empty()) continue;
            const std::string decoded = http::decode_uri_component(raw);
            if (decoded == raw && raw.find('%') != std::string::npos) throw std::runtime_error("URIError");
            token = decoded;
            break;
        }
    }
    if (!token || token->empty() || config_.cernere_public_key.empty()) return std::nullopt;
    auto key = crypto::Ed25519PublicKey::from_config_string(config_.cernere_public_key);
    if (!key) return std::nullopt;
    auto payload = verify_v4_public(*token, *key, config_.cernere_audience, now_ms());
    if (!payload) return std::nullopt;
    if (const Json* exp = member(*payload, "exp"); exp && exp->is_string() && !exp->get<std::string>().empty()) {
        auto t = parse_iso_ms(exp->get<std::string>());
        if (t && *t < now_ms()) return std::nullopt;
    }
    const Json* sub = member(*payload, "sub");
    if (!sub || !sub->is_string() || sub->get<std::string>().empty()) return std::nullopt;
    return sub->get<std::string>();
}

}  // namespace tr::app
