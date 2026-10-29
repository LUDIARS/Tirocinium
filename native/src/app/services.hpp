#pragma once
// 経路 (routes) と use case が使う依存の束。経路は transport (Request/Response) だけを扱い、
// DB・外部 I/O はここ経由の port で触る。

#include <atomic>
#include <filesystem>
#include <functional>
#include <memory>
#include <optional>
#include <string>

#include <boost/asio/thread_pool.hpp>

#include "app/auth.hpp"
#include "app/config.hpp"
#include "app/llm.hpp"
#include "app/secrets.hpp"
#include "app/session_state.hpp"
#include "core/rate_limit.hpp"
#include "db/database.hpp"
#include "http/router.hpp"

namespace tr::app {

// 送りっぱなしの処理 (Node の `void promise`) を限られた数だけ走らせる。満杯なら受け付けずに false
// (待たせない・溜めない。呼び出し側がログに残す)。
class BackgroundTasks {
public:
    explicit BackgroundTasks(std::size_t threads = 4, std::size_t max_pending = 256)
        : pool_(threads), max_pending_(max_pending) {}
    ~BackgroundTasks() { pool_.join(); }
    bool submit(std::function<void()> fn);
    void join() { pool_.join(); }

private:
    boost::asio::thread_pool pool_;
    std::atomic<std::size_t> pending_{0};
    std::size_t max_pending_;
};

struct Services {
    Config& config;
    db::Database& db;
    const Authenticator& auth;
    std::filesystem::path root;  // リポ直下 (data/ と *-viewer/ の基点)
    HttpFetch fetch;
    std::function<EpochMs()> now;
    LogFn log;
    CallTickets& call_tickets;
    MaterialStore& materials;
    FixedWindowLimiter& session_limiter;
    BackgroundTasks& background;
    LlmGateway* llm = nullptr;
    EnvList env;                  // 子プロセスへ渡す環境の元 / env 参照
    int slot_duration_env = 30;   // slot.ts が env から読む SLOT_DURATION_MIN
};

// ---- 要求の読み方 (hono の c.req.json().catch(() => null) と同じ) ----
std::optional<Json> read_json_body(const http::Request& req);
// 認証済みの利用者 (middleware が埋める)。
const std::string& user_id(const http::Context& ctx);
// Number.parseInt(v, 10) (NaN は nullopt)。
std::optional<long long> query_int(const http::Request& req, const std::string& key);

// 認証 middleware を掛けた handler。
http::Handler authed(const Services& s, http::Handler h);
// sessionCreateLimiter と同じ: 利用者ごとの固定窓。超えたら 429 + Retry-After。
std::optional<http::Response> check_session_rate(Services& s, const http::Context& ctx);

// Nuntius への通知 (notifications/nuntius.ts)。URL が無ければ {ok:false, reason:'nuntius_url_unset'}。
struct PushResult {
    bool ok = false;
    std::string reason;
};
PushResult push_notification(const Services& s, const std::string& user_id, const std::string& title,
                             const std::string& body, const Json& data);
// 送りっぱなし版 (キューが満杯ならログに残して捨てる)。
void push_notification_async(Services& s, std::string user_id, std::string title, std::string body, Json data);

// users 行を遅延作成する (Cernere user_id の mirror)。
void ensure_user(db::Database& db, const std::string& user_id);

}  // namespace tr::app
