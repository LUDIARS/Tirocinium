#include "io/pg_pool.hpp"

#include <libpq-fe.h>

#include "core/text.hpp"
#include "db/pg_decode.hpp"

namespace tr::io {

struct PgPool::Conn {
    PGconn* pg = nullptr;
    ~Conn() {
        if (pg) PQfinish(pg);
    }
};

namespace {

std::string error_text(PGconn* pg) {
    std::string msg = pg ? PQerrorMessage(pg) : "connection failed";
    while (!msg.empty() && (msg.back() == '\n' || msg.back() == ' ')) msg.pop_back();
    return msg;
}

[[noreturn]] void throw_result_error(PGresult* res, PGconn* pg) {
    std::string state;
    std::string primary;
    if (res) {
        if (const char* s = PQresultErrorField(res, PG_DIAG_SQLSTATE)) state = s;
        if (const char* m = PQresultErrorField(res, PG_DIAG_MESSAGE_PRIMARY)) primary = m;
    }
    if (primary.empty()) primary = error_text(pg);
    if (res) PQclear(res);
    throw db::DbError(primary, state);
}

db::Rows read_rows(PGresult* res, const PgPoolOptions& options) {
    db::Rows rows;
    const int nrows = PQntuples(res);
    const int ncols = PQnfields(res);
    lorica::input_budget budget({options.max_result_bytes * 2, options.max_result_values,
                                 options.max_result_values * 2, 64});
    rows.reserve(static_cast<std::size_t>(nrows));
    for (int r = 0; r < nrows; ++r) {
        Json row = Json::object();
        for (int c = 0; c < ncols; ++c) {
            const char* name = PQfname(res, c);
            if (PQgetisnull(res, r, c)) {
                row[name] = nullptr;
                continue;
            }
            const char* value = PQgetvalue(res, r, c);
            const int len = PQgetlength(res, r, c);
            row[name] = db::decode_value(std::string_view(value, static_cast<std::size_t>(len)),
                                         static_cast<unsigned>(PQftype(res, c)), budget);
        }
        rows.push_back(std::move(row));
    }
    return rows;
}

db::Rows run(PGconn* pg, std::string_view sql, const db::Params& params, const PgPoolOptions& options) {
    std::vector<db::EncodedParam> enc;
    enc.reserve(params.size());
    for (const auto& p : params) enc.push_back(db::encode_param(p));
    std::vector<const char*> values;
    std::vector<Oid> types;
    std::vector<int> lengths;
    std::vector<int> formats;
    for (const auto& e : enc) {
        values.push_back(e.is_null ? nullptr : e.text.c_str());
        types.push_back(static_cast<Oid>(e.type_oid));
        lengths.push_back(static_cast<int>(e.text.size()));
        formats.push_back(0);
    }
    const std::string text(sql);
    PGresult* res = PQexecParams(pg, text.c_str(), static_cast<int>(enc.size()), types.data(), values.data(),
                                 lengths.data(), formats.data(), 0);
    if (!res) throw_result_error(nullptr, pg);
    const auto status = PQresultStatus(res);
    if (status != PGRES_TUPLES_OK && status != PGRES_COMMAND_OK) throw_result_error(res, pg);
    db::Rows rows = status == PGRES_TUPLES_OK ? read_rows(res, options) : db::Rows{};
    PQclear(res);
    return rows;
}

void run_script(PGconn* pg, std::string_view sql) {
    const std::string text(sql);
    PGresult* res = PQexec(pg, text.c_str());
    if (!res) throw_result_error(nullptr, pg);
    const auto status = PQresultStatus(res);
    if (status != PGRES_TUPLES_OK && status != PGRES_COMMAND_OK && status != PGRES_EMPTY_QUERY) {
        throw_result_error(res, pg);
    }
    PQclear(res);
}

// 接続 1 本を Database として見せる (transaction 内で使う)。
class TxView final : public db::Database {
public:
    TxView(PGconn* pg, const PgPoolOptions& options) : pg_(pg), options_(options) {}
    db::Rows query(std::string_view sql, const db::Params& params) override { return run(pg_, sql, params, options_); }
    void transaction(const std::function<void(db::Database&)>& fn) override { fn(*this); }  // 入れ子は同じ取引
    void exec_script(std::string_view sql) override { run_script(pg_, sql); }

private:
    PGconn* pg_;
    const PgPoolOptions& options_;
};

}  // namespace

bool is_sqlite_url(const std::string& url) {
    return url.empty() || starts_with(url, "sqlite:") || starts_with(url, "file:") || ends_with(url, ".sqlite") ||
           ends_with(url, ".db");
}

PgPool::PgPool(std::string conninfo, PgPoolOptions options) : conninfo_(std::move(conninfo)), options_(options) {}

PgPool::~PgPool() = default;

std::unique_ptr<PgPool::Conn> PgPool::acquire() {
    std::unique_lock lock(mu_);
    const auto deadline = std::chrono::steady_clock::now() + options_.acquire_timeout;
    while (idle_.empty() && open_ >= options_.max_connections) {
        if (cv_.wait_until(lock, deadline) == std::cv_status::timeout && idle_.empty() &&
            open_ >= options_.max_connections) {
            throw db::DbError("database pool exhausted", "53300");
        }
    }
    if (!idle_.empty()) {
        auto c = std::move(idle_.back());
        idle_.pop_back();
        lock.unlock();
        if (PQstatus(c->pg) != CONNECTION_OK) PQreset(c->pg);
        if (PQstatus(c->pg) == CONNECTION_OK) return c;
        lock.lock();
        --open_;
        lock.unlock();
        cv_.notify_one();
        return acquire();
    }
    ++open_;
    lock.unlock();
    auto c = std::make_unique<Conn>();
    // keyword/value の接続指定に connect_timeout を足す (URL 形式でも libpq は expand_dbname で解釈する)。
    // TCP keepalive で、応答の途中で相手が消えた接続も検出する (読み取りの期限の代わり)。
    const char* keys[] = {"dbname", "connect_timeout", "client_encoding", "keepalives", "keepalives_idle",
                          "keepalives_interval", "keepalives_count", nullptr};
    const std::string timeout = std::to_string(options_.connect_timeout_sec);
    const char* vals[] = {conninfo_.c_str(), timeout.c_str(), "UTF8", "1", "30", "10", "3", nullptr};
    c->pg = PQconnectdbParams(keys, vals, 1);
    if (!c->pg || PQstatus(c->pg) != CONNECTION_OK) {
        const std::string msg = error_text(c->pg);
        {
            std::lock_guard g(mu_);
            --open_;
        }
        cv_.notify_one();
        throw db::DbError("database connection failed: " + msg, "08001");
    }
    // NOTICE を標準エラーへ流さない (値を含みうる。運用ログを汚さない)。
    PQsetNoticeProcessor(c->pg, [](void*, const char*) {}, nullptr);
    run_script(c->pg, "SET TIME ZONE 'UTC'; SET statement_timeout = " + std::to_string(options_.statement_timeout_ms));
    return c;
}

void PgPool::release(std::unique_ptr<Conn> conn) {
    {
        std::lock_guard lock(mu_);
        if (conn && PQstatus(conn->pg) == CONNECTION_OK && PQtransactionStatus(conn->pg) == PQTRANS_IDLE) {
            idle_.push_back(std::move(conn));
        } else {
            --open_;
        }
    }
    cv_.notify_one();
}

db::Rows PgPool::query(std::string_view sql, const db::Params& params) {
    auto c = acquire();
    try {
        auto rows = run(c->pg, sql, params, options_);
        release(std::move(c));
        return rows;
    } catch (...) {
        release(std::move(c));
        throw;
    }
}

void PgPool::exec_script(std::string_view sql) {
    auto c = acquire();
    try {
        run_script(c->pg, sql);
        release(std::move(c));
    } catch (...) {
        release(std::move(c));
        throw;
    }
}

void PgPool::transaction(const std::function<void(db::Database&)>& fn) {
    auto c = acquire();
    try {
        run_script(c->pg, "BEGIN");
        TxView tx(c->pg, options_);
        fn(tx);
        run_script(c->pg, "COMMIT");
        release(std::move(c));
    } catch (...) {
        if (PQtransactionStatus(c->pg) != PQTRANS_IDLE) {
            PGresult* r = PQexec(c->pg, "ROLLBACK");
            if (r) PQclear(r);
        }
        release(std::move(c));
        throw;
    }
}

bool PgPool::ping() {
    try {
        auto rows = query("SELECT 1 AS ok");
        return !rows.empty() && rows[0]["ok"] == 1;
    } catch (...) {
        return false;
    }
}

}  // namespace tr::io
