#pragma once
// Cernere のサービス向け authCode を交換する (Cernere spec/plan/2026-10-30-authcode-service-binding.md)。
// - POST {CERNERE_URL}/api/auth/exchange { code, code_verifier }、Authorization: Bearer <project credential token>
// - 応答 { user, projectToken }。Cernere の user token / refresh token は返らない。
// - projectToken は Cernere の鍵で検証し (aud = CERNERE_AUDIENCE = 登録した hub_url)、sub が user.id と一致することを確かめる。
// 交換に成功したら、呼び出し側が自前セッション (service_session) を発行する。

#include <string>

#include "app/auth.hpp"
#include "app/cernere.hpp"
#include "app/service_session.hpp"

namespace tr::app {

// PKCE の値の形 (RFC 7636)。Cernere / Corpus と同じ規則。
bool is_authorization_code(std::string_view code);       // base64url 43 文字
bool is_pkce_verifier(std::string_view verifier);        // [A-Za-z0-9._~-] 43〜128 文字
bool is_pkce_s256_challenge(std::string_view challenge); // base64url 43 文字

// 拒否 (code・verifier・project の不一致、期限切れ、2 回目) は CernereSessionError(401)。
// どれが崩れたかは Cernere も返さないので、こちらも区別しない。
ServiceSessionUser exchange_service_code(const Config& config, const HttpFetch& fetch, const CernereKeys& keys,
                                         const std::string& code, const std::string& code_verifier, EpochMs now);

}  // namespace tr::app
