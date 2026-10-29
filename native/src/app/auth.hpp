#pragma once
// auth/cernere.ts + auth/cernere-public-keys.ts の移植。
// - Bearer の PASETO v4.public を「現行鍵 + 旧鍵」のどれかで検証し、aud/iat/nbf/exp を検査する。
// - 鍵が 1 本も無ければ 503 auth_not_configured (黙って素通しにしない)。
// - dev 認証 (TIROCINIUM_DEV_AUTH=1) は loopback bind の時だけ。それ以外では起動を拒否する。

#include <mutex>
#include <optional>
#include <string>
#include <vector>

#include "app/config.hpp"
#include "core/json.hpp"
#include "core/time.hpp"
#include "crypto/crypto.hpp"
#include "http/router.hpp"

namespace tr::app {

// 検証に使う鍵の集合。CERNERE_PUBLIC_KEY があればそれ (読めない値でも「1 本ある」扱い = 401 になる、
// Node 版と同じ)、無ければ起動時に well-known から取得した鍵。
class CernereKeys {
public:
    void set_configured(const std::string& key_text);
    void set_fetched(std::vector<crypto::Ed25519PublicKey> keys);
    // 鍵の本数と、使える鍵 (読めない設定値は nullopt)。
    [[nodiscard]] std::vector<std::optional<crypto::Ed25519PublicKey>> verification_keys() const;
    [[nodiscard]] std::size_t fetched_count() const;

private:
    mutable std::mutex mu_;
    bool configured_ = false;
    std::optional<crypto::Ed25519PublicKey> configured_key_;
    std::vector<crypto::Ed25519PublicKey> fetched_;
};

// /.well-known/cernere-public-key の応答 {keys:[{public_key, alg?}]} を読む。
// alg が無いか EdDSA の鍵だけ。raw 32 バイトでない鍵が 1 つでもあれば例外 (Node 版と同じく全体を捨てる)。
std::vector<crypto::Ed25519PublicKey> parse_public_key_set(const Json& body);

// トークンを鍵で検証し payload を返す (失敗なら nullopt)。
std::optional<Json> verify_v4_public(const std::string& token, const crypto::Ed25519PublicKey& key,
                                     const std::string& audience, EpochMs now);

class Authenticator {
public:
    Authenticator(const Config& config, const CernereKeys& keys) : config_(config), keys_(keys) {}

    // assertSafeAuthConfig: dev 認証が loopback 以外なら例外。
    void assert_safe_config() const;
    [[nodiscard]] std::optional<std::string> dev_auth_user_id() const;

    // cernereAuth middleware。成功なら ctx.user_id を埋めて nullopt、失敗なら応答。
    [[nodiscard]] std::optional<http::Response> require(http::Request& req, http::Context& ctx) const;
    [[nodiscard]] http::Middleware middleware() const;

    // ws/handler.ts の authenticate: Bearer か ?token=。鍵は CERNERE_PUBLIC_KEY だけを使う (Node 版と同じ)。
    // 戻り値: user id / nullopt (401) / 例外 (URI の復号失敗 = 500)。
    [[nodiscard]] std::optional<std::string> authenticate_ws(const http::Request& req) const;

private:
    const Config& config_;
    const CernereKeys& keys_;
};

}  // namespace tr::app
