#pragma once
// libpq の接続プール (postgres.js の max:10 / idle_timeout:30 と同じ規模)。
// 期限: 接続 10 秒、文 30 秒 (statement_timeout)、プールの空き待ち 10 秒 (超えたら DbError = 待機して拒否)。
// セッションの TimeZone は UTC に固定する (timestamptz の出力を一意に読むため)。

#include <chrono>
#include <condition_variable>
#include <memory>
#include <mutex>
#include <string>
#include <vector>

#include "db/database.hpp"

namespace tr::io {

struct PgPoolOptions {
    std::size_t max_connections = 10;
    std::chrono::seconds acquire_timeout{10};
    int connect_timeout_sec = 10;
    int statement_timeout_ms = 30'000;
    // 1 クエリの結果全体の上限 (Lorica の予算)。
    std::size_t max_result_bytes = 64 * 1024 * 1024;
    std::size_t max_result_values = 2'000'000;
};

class PgPool final : public db::Database {
public:
    PgPool(std::string conninfo, PgPoolOptions options = {});
    ~PgPool() override;
    PgPool(const PgPool&) = delete;
    PgPool& operator=(const PgPool&) = delete;

    db::Rows query(std::string_view sql, const db::Params& params = {}) override;
    void transaction(const std::function<void(db::Database& tx)>& fn) override;
    void exec_script(std::string_view sql) override;
    // readiness 用: SELECT 1 AS ok が 1 を返すか。
    bool ping();

    struct Conn;

private:
    std::unique_ptr<Conn> acquire();
    void release(std::unique_ptr<Conn> conn);

    std::string conninfo_;
    PgPoolOptions options_;
    std::mutex mu_;
    std::condition_variable cv_;
    std::vector<std::unique_ptr<Conn>> idle_;
    std::size_t open_ = 0;
};

// postgres:// 以外 (sqlite: / file: / *.sqlite / *.db / 空) なら true (Node 版の isSqlite 判定と同じ)。
bool is_sqlite_url(const std::string& url);

}  // namespace tr::io
