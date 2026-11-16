#pragma once
// Cernere との連携: 公開鍵の取得、project credential token の取得、project WS (/ws/project) の代理。
// ログイン口 (/api/auth) は auth_routes、authCode の交換は cernere_exchange が持つ。
// トークンはログに出さない。

#include <chrono>
#include <condition_variable>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <stdexcept>
#include <string>

#include <boost/asio/io_context.hpp>

#include "app/auth.hpp"
#include "app/secrets.hpp"
#include "io/ws_client.hpp"

namespace tr::app {

class CernereSessionError : public std::runtime_error {
public:
    CernereSessionError(const std::string& message, int status) : std::runtime_error(message), status_(status) {}
    [[nodiscard]] int status() const { return status_; }

private:
    int status_;
};
class CernereNotConfiguredError : public std::runtime_error {
public:
    using std::runtime_error::runtime_error;
};

// project credential (CERNERE_PROJECT_CLIENT_ID / SECRET) で Cernere にログインし、project token を得る。
// 未設定なら CernereNotConfiguredError、Cernere が拒めば CernereSessionError。
std::string fetch_project_credential_token(const Config& config, const HttpFetch& fetch);

// CERNERE_PUBLIC_KEY が無く CERNERE_URL があれば well-known から鍵を取得する (失敗しても起動は続ける)。
void load_cernere_public_keys(const Config& config, const HttpFetch& fetch, CernereKeys& keys, const LogFn& log);

// 埋め込みログイン (composite) の代理。ログインはパスキーのみ (Cernere がパスワードを廃止した)。
// payload は Cernere の project WS の auth.passkey-login-begin / finish にそのまま渡す。
class CompositeAuthProxy {
public:
    virtual ~CompositeAuthProxy() = default;
    virtual Json passkey_login_begin(const Json& payload) = 0;
    virtual Json passkey_login_finish(const Json& payload) = 0;
};

// Cernere の project WS (/ws/project) に module_request を送る代理。接続は 1 本を使い回し、切れたら次の要求で張り直す。
// 期限: 接続 10 秒、要求 10 秒 (cernere-project-client.ts と同じ)。
class CernereProjectProxy final : public CompositeAuthProxy {
public:
    CernereProjectProxy(const Config& config, HttpFetch fetch, boost::asio::io_context& ioc);
    Json passkey_login_begin(const Json& payload) override;
    Json passkey_login_finish(const Json& payload) override;

private:
    Json request(const std::string& module, const std::string& action, const Json& payload);
    void ensure_connected();
    void on_message(const std::string& raw);

    struct Pending {
        bool done = false;
        bool ok = false;
        Json payload;
        std::string error;
    };
    const Config& config_;
    HttpFetch fetch_;
    boost::asio::io_context& ioc_;
    std::mutex mu_;
    std::condition_variable cv_;
    std::shared_ptr<io::WsClient> ws_;
    std::map<std::string, std::shared_ptr<Pending>> pending_;
};

}  // namespace tr::app
