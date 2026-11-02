#pragma once
// 常駐する子プロセス (標準入出力を行単位でやり取りする)。Node の企業 worker に使う。
// 起動は run_process と同じく引数配列のみ (シェルなし)。子孫ごと止められる (プロセスグループ / Job)。
// 1 行の上限を超えた出力は読み捨てる (メモリを使わせない)。

#include <atomic>
#include <functional>
#include <memory>
#include <mutex>
#include <string>
#include <thread>

#include "io/process.hpp"

namespace tr::io {

class ResidentProcess {
public:
    using LineFn = std::function<void(const std::string& line)>;
    using ExitFn = std::function<void(int code)>;

    ResidentProcess(ProcessSpec spec, LineFn on_stdout, LineFn on_stderr, ExitFn on_exit, std::size_t max_line = 16 * 1024 * 1024);
    ~ResidentProcess();
    ResidentProcess(const ResidentProcess&) = delete;
    ResidentProcess& operator=(const ResidentProcess&) = delete;

    bool start();                       // 起動できなければ false
    bool write_line(const std::string& line);
    void stop();                        // 子孫ごと止めて待つ
    [[nodiscard]] bool running() const { return running_.load(); }

private:
    struct Impl;
    std::unique_ptr<Impl> impl_;
    ProcessSpec spec_;
    LineFn on_stdout_;
    LineFn on_stderr_;
    ExitFn on_exit_;
    std::size_t max_line_;
    std::atomic<bool> running_{false};
    std::mutex write_mu_;
};

}  // namespace tr::io
