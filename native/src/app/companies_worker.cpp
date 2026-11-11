#include "app/companies_worker.hpp"

#include "core/text.hpp"

namespace tr::app {

CompaniesWorker::CompaniesWorker(Options options, LogFn log) : options_(std::move(options)), log_(std::move(log)) {}

CompaniesWorker::~CompaniesWorker() { stop(); }

CompaniesWorker::Options CompaniesWorker::default_options(const std::filesystem::path& root, const EnvList& env,
                                                          const std::string& database_url) {
    Options o;
    o.spec.file = "node";
    o.spec.args = {"--import", "tsx", "src/companies-worker/index.ts"};
    o.spec.cwd = root / "apps" / "server";
    for (const auto& [k, v] : env) {
        if (k != "DATABASE_URL") o.spec.env.emplace_back(k, v);
    }
    // worker は C++ サーバと同じ Postgres を使う (秘密は環境変数でだけ渡し、引数やログに出さない)。
    if (!database_url.empty()) o.spec.env.emplace_back("DATABASE_URL", database_url);
    return o;
}

void CompaniesWorker::start() {
    std::lock_guard lock(mu_);
    if (supervisor_.joinable()) return;
    stopping_ = false;
    supervisor_ = std::thread([this] { supervise(); });
}

void CompaniesWorker::stop() {
    {
        std::lock_guard lock(mu_);
        if (!supervisor_.joinable()) return;
        stopping_ = true;
    }
    cv_.notify_all();
    supervisor_.join();
    fail_all("worker_unavailable", "companies worker stopped");
}

bool CompaniesWorker::available() const {
    std::lock_guard lock(mu_);
    return up_ && !stopping_;
}

void CompaniesWorker::supervise() {
    auto backoff = options_.restart_min;
    for (;;) {
        {
            std::lock_guard lock(mu_);
            if (stopping_) break;
            exited_ = false;
        }
        auto proc = std::make_shared<io::ResidentProcess>(
            options_.spec, [this](const std::string& line) { on_line(line); },
            [this](const std::string& line) {
                if (log_) log_("[companies-worker] " + utf16_slice(line, 0, 2000));
            },
            [this](int code) { on_exit(code); }, options_.max_line);
        const auto started_at = std::chrono::steady_clock::now();
        const bool ok = proc->start();
        if (ok) {
            {
                std::lock_guard lock(mu_);
                up_ = true;
                proc_ = proc;
            }
            if (log_) log_("[companies-worker] started");
            std::unique_lock lock(mu_);
            cv_.wait(lock, [this] { return stopping_ || exited_; });
            up_ = false;
            proc_.reset();
        } else if (log_) {
            log_("[companies-worker] failed to start (node / tsx が見つからない?)");
        }
        // 止める (標準入力を閉じ、終わらなければ子孫ごと)。mu_ を持たずに呼ぶ (on_exit が mu_ を取るため)。
        proc->stop();
        proc.reset();
        fail_all("worker_exited", "companies worker exited");
        std::unique_lock lock(mu_);
        if (stopping_) break;
        if (std::chrono::steady_clock::now() - started_at > std::chrono::minutes(1)) backoff = options_.restart_min;
        if (log_) log_("[companies-worker] restarting in " + std::to_string(backoff.count() / 1000) + "s");
        cv_.wait_for(lock, backoff, [this] { return stopping_; });
        if (stopping_) break;
        backoff = std::min(backoff * 2, options_.restart_max);
    }
    std::lock_guard lock(mu_);
    up_ = false;
}

void CompaniesWorker::on_exit(int code) {
    {
        std::lock_guard lock(mu_);
        exited_ = true;
    }
    if (log_) log_("[companies-worker] exited code=" + std::to_string(code));
    cv_.notify_all();
}

void CompaniesWorker::on_line(const std::string& line) {
    const std::string prefix = kWorkerReplyPrefix;
    if (line.rfind(prefix, 0) != 0) return;  // ライブラリのログ等は読み捨てる
    JsonLimits limits;
    limits.max_bytes = options_.max_line;
    limits.max_elements = 2'000'000;
    const std::optional<Json> msg = parse_json(std::string_view(line).substr(prefix.size()), limits);
    if (!msg || !msg->is_object()) return;
    const Json* id = member(*msg, "id");
    if (!id || !id->is_number_integer()) return;
    std::lock_guard lock(mu_);
    auto it = pending_.find(id->get<std::int64_t>());
    if (it == pending_.end()) return;
    auto& p = *it->second;
    p.done = true;
    p.ok = msg->value("ok", false);
    if (p.ok) {
        p.result = msg->contains("result") ? (*msg)["result"] : Json(nullptr);
    } else {
        p.error_code = "op_failed";
        p.error = string_or(*msg, "error");
        if (p.error.empty()) p.error = "worker error";
    }
    pending_.erase(it);
    cv_.notify_all();
}

void CompaniesWorker::fail_all(const std::string& code, const std::string& detail) {
    std::lock_guard lock(mu_);
    for (auto& [id, p] : pending_) {
        p->done = true;
        p->ok = false;
        p->error_code = code;
        p->error = detail;
    }
    pending_.clear();
    cv_.notify_all();
}

Json CompaniesWorker::call(const std::string& op, const Json& args, std::chrono::milliseconds timeout) {
    std::shared_ptr<Pending> p;
    std::shared_ptr<io::ResidentProcess> proc;
    std::int64_t id = 0;
    {
        std::lock_guard lock(mu_);
        if (!up_ || stopping_ || !proc_) throw WorkerError("worker_unavailable", "companies worker unavailable");
        if (inflight_ >= options_.max_inflight) throw WorkerError("worker_busy", "companies worker busy");
        ++inflight_;
        id = next_id_++;
        p = std::make_shared<Pending>();
        pending_[id] = p;
        proc = proc_;
    }
    struct Release {
        CompaniesWorker* w;
        std::int64_t id;
        ~Release() {
            std::lock_guard lock(w->mu_);
            --w->inflight_;
            w->pending_.erase(id);
        }
    } release{this, id};
    const std::string line = js_stringify(Json{{"id", id}, {"op", op}, {"args", args.is_object() ? args : Json::object()}});
    const bool written = proc->write_line(line);
    proc.reset();  // 最後の所有者になっても mu_ を持たずに手放す
    if (!written) throw WorkerError("worker_unavailable", "companies worker unavailable");
    std::unique_lock lock(mu_);
    if (!cv_.wait_for(lock, timeout, [&] { return p->done; })) throw WorkerError("worker_timeout", "companies worker timeout");
    if (!p->ok) throw WorkerError(p->error_code, p->error);
    return std::move(p->result);
}

}  // namespace tr::app
