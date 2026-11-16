#pragma once
// /api/auth: Cernere 埋め込みログイン (パスキー) の中継と、authCode の交換・ログアウト。
// - POST /api/auth/cernere/passkey-login-begin  { code_challenge, state }
// - POST /api/auth/cernere/passkey-login-finish { challengeOwner, response, code_challenge, state }
//   → client_id (project credential) と target (TIROCINIUM_PUBLIC_ORIGIN) を足して project WS へ送る
// - POST /api/auth/exchange { code, code_verifier } → 自前セッション { sessionToken, expiresAt, user }
// - POST /api/auth/logout (Bearer 自前セッション)
// どの口もブラウザの Origin が TIROCINIUM_PUBLIC_ORIGIN と一致するときだけ受ける。

#include <functional>
#include <string_view>

#include "app/auth.hpp"
#include "app/cernere.hpp"
#include "app/service_session.hpp"
#include "http/router.hpp"

namespace tr::app {

// Cernere の composite_origins に登録できる形か (https・ループバック不可・path/userinfo 無しのオリジン)。
bool is_registrable_public_origin(std::string_view origin);

struct AuthRouteDeps {
    const Config& config;
    HttpFetch fetch;
    const CernereKeys& keys;
    CompositeAuthProxy& proxy;
    ServiceSessionStore& sessions;
    std::function<EpochMs()> now;
};

void register_auth_routes(http::Router& router, const AuthRouteDeps& deps);

}  // namespace tr::app
