#include "app/service_session.hpp"

#include "core/encoding.hpp"
#include "crypto/crypto.hpp"

namespace tr::app {

namespace {

constexpr std::size_t kTokenBytes = 32;
constexpr std::size_t kTokenChars = 43;  // base64url(32 バイト)、パディングなし

std::string token_hash(std::string_view token) { return crypto::sha256_hex(token); }

bool is_base64url_char(char c) {
    return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-' || c == '_';
}

}  // namespace

bool is_service_session_token(std::string_view token) {
    if (token.size() != kTokenChars) return false;
    for (char c : token) {
        if (!is_base64url_char(c)) return false;
    }
    return true;
}

IssuedServiceSession PgServiceSessionStore::create(const ServiceSessionUser& user, EpochMs now) {
    IssuedServiceSession issued;
    issued.token = base64url_encode(crypto::random_bytes(kTokenBytes));
    issued.expires_at = now + kServiceSessionTtlMs;
    // 期限切れの行は発行のついでに消す (別の掃除処理を持たない)。
    db_.query("DELETE FROM tirocinium_service_sessions WHERE expires_at_ms <= $1", {static_cast<std::int64_t>(now)});
    db_.query(
        "INSERT INTO tirocinium_service_sessions (token_hash, user_id, display_name, created_at_ms, expires_at_ms) "
        "VALUES ($1, $2, $3, $4, $5)",
        {token_hash(issued.token), user.id, user.display_name, static_cast<std::int64_t>(now),
         static_cast<std::int64_t>(issued.expires_at)});
    return issued;
}

std::optional<std::string> PgServiceSessionStore::resolve(std::string_view token, EpochMs now) {
    if (!is_service_session_token(token)) return std::nullopt;
    const auto rows = db_.query(
        "SELECT user_id FROM tirocinium_service_sessions WHERE token_hash = $1 AND expires_at_ms > $2",
        {token_hash(token), static_cast<std::int64_t>(now)});
    const Json* row = db::first(rows);
    if (!row) return std::nullopt;
    const std::string uid = string_or(*row, "user_id");
    if (uid.empty()) return std::nullopt;
    return uid;
}

void PgServiceSessionStore::revoke(std::string_view token) {
    if (!is_service_session_token(token)) return;
    db_.query("DELETE FROM tirocinium_service_sessions WHERE token_hash = $1", {token_hash(token)});
}

}  // namespace tr::app
