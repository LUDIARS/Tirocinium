#pragma once
// Cernere との連携 (auth/cernere-session.ts, cernere-project-client.ts, cernere-public-keys.ts, routes/auth.ts)。
// トークン・パスワードはログに出さない。返すだけで保存しない。

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
#include "http/router.hpp"
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

// authCode → ユーザー token → Tirocinium 向け user×project token。返り値 {token, expiresIn, refreshToken, user}。
Json exchange_auth_code(const Config& config, const HttpFetch& fetch, const std::string& auth_code);
Json refresh_session(const Config& config, const HttpFetch& fetch, const std::string& refresh_token);

// CERNERE_PUBLIC_KEY が無く CERNERE_URL があれば well-known から鍵を取得する (失敗しても起動は続ける)。
void load_cernere_public_keys(const Config& config, const HttpFetch& fetch, CernereKeys& keys, const LogFn& log);

// 埋め込みログイン (composite) の代理。応答は {authCode} か MFA の続き。
class CompositeAuthProxy {
public:
    virtual ~CompositeAuthProxy() = default;
    virtual Json login(const std::string& email, const std::string& password) = 0;
    virtual Json register_user(const std::string& name, const std::string& email, const std::string& password) = 0;
    virtual Json mfa_verify(const std::string& mfa_token, const std::string& method, const std::string& code) = 0;
};

// Cernere の project WS (/ws/project) に module_request を送る代理。接続は 1 本を使い回し、切れたら次の要求で張り直す。
// 期限: 接続 10 秒、要求 10 秒 (cernere-project-client.ts と同じ)。
class CernereProjectProxy final : public CompositeAuthProxy {
public:
    CernereProjectProxy(const Config& config, HttpFetch fetch, boost::asio::io_context& ioc);
    Json login(const std::string& email, const std::string& password) override;
    Json register_user(const std::string& name, const std::string& email, const std::string& password) override;
    Json mfa_verify(const std::string& mfa_token, const std::string& method, const std::string& code) override;

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

void register_auth_routes(http::Router& router, const Config& config, HttpFetch fetch, CompositeAuthProxy& proxy);

}  // namespace tr::app
