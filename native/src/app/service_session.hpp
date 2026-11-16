#pragma once
// Tirocinium 自前のログインセッション。
// Cernere の交換 (PKCE + project credential) で本人を確かめた後、ブラウザにはこのセッションの token だけを渡す。
// Cernere の user token / refresh token は受け取らず、延長もしない (期限が来たらログインし直す)。
// DB には token の SHA-256 だけを置き、token 本体は保存しない。

#include <optional>
#include <string>
#include <string_view>

#include "core/time.hpp"
#include "db/database.hpp"

namespace tr::app {

struct ServiceSessionUser {
    std::string id;
    std::string display_name;
};

struct IssuedServiceSession {
    std::string token;  // 43 文字の base64url (32 バイトの乱数)
    EpochMs expires_at = 0;
};

// セッションの有効期間 (固定、延長しない)。
inline constexpr EpochMs kServiceSessionTtlMs = 12LL * 60 * 60 * 1000;

// token の形 (43 文字の base64url) だけを見る。Cernere の PASETO と区別するのに使う。
bool is_service_session_token(std::string_view token);

class ServiceSessionStore {
public:
    virtual ~ServiceSessionStore() = default;
    virtual IssuedServiceSession create(const ServiceSessionUser& user, EpochMs now) = 0;
    // 有効なら Cernere の user id。期限切れ・未知・形が違えば nullopt。
    virtual std::optional<std::string> resolve(std::string_view token, EpochMs now) = 0;
    virtual void revoke(std::string_view token) = 0;
};

// Postgres (tirocinium_service_sessions) に置く実装。
class PgServiceSessionStore final : public ServiceSessionStore {
public:
    explicit PgServiceSessionStore(db::Database& db) : db_(db) {}
    IssuedServiceSession create(const ServiceSessionUser& user, EpochMs now) override;
    std::optional<std::string> resolve(std::string_view token, EpochMs now) override;
    void revoke(std::string_view token) override;

private:
    db::Database& db_;
};

}  // namespace tr::app
