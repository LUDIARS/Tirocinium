#pragma once
// Node の企業 worker (apps/server/src/companies-worker/index.ts) を子プロセスとして常駐させ、
// 標準入出力の 1 行 JSON で処理を頼む。worker は外からの接続を受けない (HTTP/WS は C++ だけ)。
// - 起動は引数配列のみ (シェルなし)。落ちたら待ってから起こし直す (5 秒から倍々、上限 2 分)。
// - 同時に頼める数に上限を置き、超えたら待たずに断る (worker_busy)。
// - 応答は 1 行 16 MiB まで、Lorica の予算で JSON を読む。決まった印 (@@tr-worker@@) の行だけを応答とみなす。
// - 待ち時間は処理ごとに決め、過ぎたら worker_timeout (worker 側の処理は止めない)。

#include <chrono>
#include <condition_variable>
#include <map>
#include <memory>
#include <mutex>
#include <stdexcept>
#include <string>
#include <thread>

#include "app/one_shot.hpp"
#include "app/secrets.hpp"
#include "core/json.hpp"
#include "io/process.hpp"
#include "io/resident_process.hpp"

namespace tr::app {

class WorkerError : public std::runtime_error {
public:
    WorkerError(std::string code, const std::string& detail) : std::runtime_error(detail), code_(std::move(code)) {}
    // worker_unavailable | worker_busy | worker_timeout | worker_exited | op_failed
    [[nodiscard]] const std::string& code() const { return code_; }

private:
    std::string code_;
};

inline constexpr const char* kWorkerReplyPrefix = "@@tr-worker@@ ";

class CompaniesWorker {
public:
    struct Options {
        io::ProcessSpec spec;
        std::size_t max_inflight = 4;
        std::chrono::milliseconds restart_min{5'000};
        std::chrono::milliseconds restart_max{120'000};
        std::size_t max_line = 16 * 1024 * 1024;
    };
    CompaniesWorker(Options options, LogFn log);
    ~CompaniesWorker();
    CompaniesWorker(const CompaniesWorker&) = delete;
    CompaniesWorker& operator=(const CompaniesWorker&) = delete;

    void start();
    void stop();
    [[nodiscard]] bool available() const;
    // 結果 (worker の result) を返す。失敗は WorkerError。
    Json call(const std::string& op, const Json& args, std::chrono::milliseconds timeout);

    // 企業 worker の既定の起動方法 (node --import tsx src/companies-worker/index.ts、cwd = apps/server)。
    static Options default_options(const std::filesystem::path& root, const EnvList& env, const std::string& database_url);

private:
    struct Pending {
        bool done = false;
        bool ok = false;
        Json result;
        std::string error;
        std::string error_code;
    };
    void supervise();
    void on_line(const std::string& line);
    void on_exit(int code);
    void fail_all(const std::string& code, const std::string& detail);

    Options options_;
    LogFn log_;
    mutable std::mutex mu_;
    std::condition_variable cv_;
    std::shared_ptr<io::ResidentProcess> proc_;
    bool stopping_ = false;
    bool exited_ = false;
    bool up_ = false;
    std::int64_t next_id_ = 1;
    std::size_t inflight_ = 0;
    std::map<std::int64_t, std::shared_ptr<Pending>> pending_;
    std::thread supervisor_;
};

}  // namespace tr::app
