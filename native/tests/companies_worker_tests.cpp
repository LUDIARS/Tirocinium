// 常駐子プロセス (ResidentProcess) と企業 worker の取り次ぎ (CompaniesWorker) のテスト。
// 本物の企業 worker は起動しない。標準入出力の約束だけを真似る偽の worker (node の小さなスクリプト) を使う。
// node が無い環境では 77 (skip)。
#include <atomic>
#include <filesystem>
#include <fstream>
#include <mutex>
#include <random>
#include <thread>

#include "check.hpp"
#include "app/companies_worker.hpp"
#include "io/resident_process.hpp"

using namespace tr;
using trtest::check;
using trtest::check_eq;

namespace {

std::filesystem::path temp_dir() {
    static const auto d = [] {
        auto p = std::filesystem::temp_directory_path() / ("tr-worker-" + std::to_string(std::random_device{}()));
        std::filesystem::create_directories(p);
        return p;
    }();
    return d;
}

std::string path_env() {
    for (const auto& [k, v] : io::current_environment()) {
        if (k == "PATH") return v;
    }
    return "";
}

// 偽の worker: 約束どおりの応答行の前後にライブラリのログ風の行を混ぜる。
const char* kFakeWorker = R"JS(
import { createInterface } from 'node:readline';
process.stdout.write('library noise on stdout\n');
process.stderr.write('hello from stderr\n');
const reply = (m) => process.stdout.write('@@tr-worker@@ ' + JSON.stringify(m) + '\n');
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
  const req = JSON.parse(line);
  const a = req.args || {};
  switch (req.op) {
    case 'echo': reply({ id: req.id, ok: true, result: a }); break;
    case 'fail': reply({ id: req.id, ok: false, error: 'company not found' }); break;
    case 'slow': setTimeout(() => reply({ id: req.id, ok: true, result: 'late' }), a.ms); break;
    case 'crash': process.exit(3); break;
    case 'big': process.stdout.write('@@tr-worker@@ {"id":' + req.id + ',"ok":true,"result":"' + 'x'.repeat(a.n) + '"}\n'); break;
    case 'noise':
      process.stdout.write('{"id":' + req.id + ',"ok":true,"result":"spoof"}\n');
      reply({ id: req.id, ok: true, result: 'real' });
      break;
    case 'env': reply({ id: req.id, ok: true, result: process.env.DATABASE_URL ?? null }); break;
    default: reply({ id: req.id, ok: false, error: 'unknown_op' });
  }
});
rl.on('close', () => process.exit(0));
)JS";

std::filesystem::path script() {
    static const auto p = [] {
        auto f = temp_dir() / "fake-worker.mjs";
        std::ofstream(f) << kFakeWorker;
        return f;
    }();
    return p;
}

struct Logs {
    std::mutex mu;
    std::vector<std::string> lines;
    app::LogFn fn() {
        return [this](const std::string& l) {
            std::lock_guard lock(mu);
            lines.push_back(l);
        };
    }
    bool contains(const std::string& s) {
        std::lock_guard lock(mu);
        for (const auto& l : lines) {
            if (l.find(s) != std::string::npos) return true;
        }
        return false;
    }
};

app::CompaniesWorker::Options options() {
    app::CompaniesWorker::Options o;
    o.spec.file = "node";
    o.spec.args = {script().string()};
    o.spec.cwd = temp_dir();
    o.spec.env = {{"PATH", path_env()}, {"DATABASE_URL", "postgres://synthetic@127.0.0.1:1/none"}};
    o.restart_min = std::chrono::milliseconds(200);
    o.restart_max = std::chrono::milliseconds(400);
    return o;
}

bool wait_until(const std::function<bool()>& pred, int ms = 5000) {
    for (int i = 0; i < ms / 20; ++i) {
        if (pred()) return true;
        std::this_thread::sleep_for(std::chrono::milliseconds(20));
    }
    return pred();
}

std::string error_code_of(const std::function<void()>& f) {
    try {
        f();
    } catch (const app::WorkerError& e) {
        return e.code();
    }
    return "";
}

TEST_CASE("resident process: lines in both directions, oversized lines dropped, stop closes stdin") {
    std::mutex mu;
    std::vector<std::string> out;
    std::atomic<int> exit_code{-100};
    io::ProcessSpec spec;
    spec.file = "node";
    spec.args = {"-e",
                 "process.stdin.on('data', d => process.stdout.write(String(d)));"
                 "process.stdout.write('a'.repeat(64) + '\\nshort\\n');"};
    spec.env = {{"PATH", path_env()}};
    io::ResidentProcess p(
        spec,
        [&](const std::string& l) {
            std::lock_guard lock(mu);
            out.push_back(l);
        },
        nullptr, [&](int c) { exit_code = c; }, 16);
    check(p.start(), "start");
    check(p.write_line("ping"), "write");
    check(wait_until([&] {
              std::lock_guard lock(mu);
              return out.size() >= 2;
          }),
          "lines arrive");
    {
        std::lock_guard lock(mu);
        check_eq(out[0], std::string("short"), "64-byte line dropped (limit 16)");
        check_eq(out[1], std::string("ping"), "stdin echoed");
    }
    p.stop();
    check(!p.running(), "stopped");
    check_eq(exit_code.load(), 0, "exits on stdin close");
}

TEST_CASE("resident process: missing executable fails to start without a shell") {
    io::ProcessSpec spec;
    spec.file = "tr-definitely-not-a-binary";
    spec.env = {{"PATH", path_env()}};
    io::ResidentProcess p(spec, nullptr, nullptr, nullptr);
    check(!p.start(), "no start");
}

TEST_CASE("companies worker: call/reply, worker errors, logs, secrets only via env") {
    Logs logs;
    app::CompaniesWorker w(options(), logs.fn());
    w.start();
    check(wait_until([&] { return w.available(); }), "worker up");
    const Json r = w.call("echo", Json{{"a", 1}, {"s", "日本語"}}, std::chrono::seconds(5));
    check_eq(js_stringify(r), std::string(R"({"a":1,"s":"日本語"})"), "echo");
    try {
        w.call("fail", Json::object(), std::chrono::seconds(5));
        check(false, "should throw");
    } catch (const app::WorkerError& e) {
        check_eq(e.code(), std::string("op_failed"), "code");
        check_eq(std::string(e.what()), std::string("company not found"), "message passed through");
    }
    check_eq(error_code_of([&] { w.call("nope", Json::object(), std::chrono::seconds(5)); }), std::string("op_failed"), "unknown op");
    check_eq(w.call("noise", Json::object(), std::chrono::seconds(5)).get<std::string>(), std::string("real"),
             "only prefixed lines are replies");
    check_eq(w.call("env", Json::object(), std::chrono::seconds(5)).get<std::string>(),
             std::string("postgres://synthetic@127.0.0.1:1/none"), "DATABASE_URL via env");
    check(wait_until([&] { return logs.contains("[companies-worker] hello from stderr"); }), "stderr logged with prefix");
    w.stop();
    check(!w.available(), "stopped");
    check_eq(error_code_of([&] { w.call("echo", Json::object(), std::chrono::seconds(1)); }), std::string("worker_unavailable"),
             "after stop");
}

TEST_CASE("companies worker: timeout, busy, oversized reply") {
    auto o = options();
    o.max_inflight = 1;
    o.max_line = 1024;
    app::CompaniesWorker w(o, nullptr);
    w.start();
    check(wait_until([&] { return w.available(); }), "worker up");
    check_eq(error_code_of([&] { w.call("slow", Json{{"ms", 1500}}, std::chrono::milliseconds(100)); }),
             std::string("worker_timeout"), "timeout");
    std::thread slow([&] {
        try {
            w.call("slow", Json{{"ms", 600}}, std::chrono::seconds(5));
        } catch (...) {
        }
    });
    std::this_thread::sleep_for(std::chrono::milliseconds(150));
    check_eq(error_code_of([&] { w.call("echo", Json::object(), std::chrono::seconds(1)); }), std::string("worker_busy"),
             "inflight limit rejects instead of queueing");
    slow.join();
    check_eq(error_code_of([&] { w.call("big", Json{{"n", 4096}}, std::chrono::milliseconds(500)); }), std::string("worker_timeout"),
             "a reply larger than the line limit is dropped");
    check_eq(js_stringify(w.call("echo", Json{{"after", true}}, std::chrono::seconds(5))), std::string(R"({"after":true})"),
             "next line still parsed");
    w.stop();
}

TEST_CASE("companies worker: crash fails pending calls and restarts") {
    Logs logs;
    app::CompaniesWorker w(options(), logs.fn());
    w.start();
    check(wait_until([&] { return w.available(); }), "worker up");
    check_eq(error_code_of([&] { w.call("crash", Json::object(), std::chrono::seconds(5)); }), std::string("worker_exited"),
             "pending call fails when the worker exits");
    check(wait_until([&] { return logs.contains("exited code=3"); }), "exit logged");
    check(wait_until([&] { return w.available(); }), "restarted");
    check_eq(js_stringify(w.call("echo", Json{{"x", 1}}, std::chrono::seconds(5))), std::string(R"({"x":1})"), "works after restart");
    w.stop();
}

TEST_CASE("companies worker: missing node keeps the server up (unavailable)") {
    auto o = options();
    o.spec.file = "tr-definitely-not-node";
    Logs logs;
    app::CompaniesWorker w(o, logs.fn());
    w.start();
    check(wait_until([&] { return logs.contains("failed to start"); }), "failure logged");
    check(!w.available(), "unavailable");
    check_eq(error_code_of([&] { w.call("echo", Json::object(), std::chrono::seconds(1)); }), std::string("worker_unavailable"),
             "call rejected");
    w.stop();
}

TEST_CASE("companies worker: default command is argv-only node + tsx with DATABASE_URL in env") {
    app::EnvList env{{"PATH", "/usr/bin"}, {"DATABASE_URL", "postgres://old"}};
    const auto o = app::CompaniesWorker::default_options("/repo", env, "postgres://synthetic");
    check_eq(o.spec.file, std::string("node"), "file");
    check_eq(o.spec.args.size(), std::size_t{3}, "args");
    check_eq(o.spec.args[2], std::string("src/companies-worker/index.ts"), "entry");
    check_eq(o.spec.cwd, std::filesystem::path("/repo/apps/server"), "cwd");
    int db = 0;
    for (const auto& [k, v] : o.spec.env) {
        if (k == "DATABASE_URL") {
            ++db;
            check_eq(v, std::string("postgres://synthetic"), "configured DB wins");
        }
    }
    check_eq(db, 1, "one DATABASE_URL");
    for (const auto& a : o.spec.args) check(a.find("postgres") == std::string::npos, "secret not in argv");
}

}  // namespace

int main() {
    if (io::find_in_path("node", path_env()).empty()) {
        std::cerr << "node not found; skipping\n";
        return 77;
    }
    return trtest::run_all();
}
