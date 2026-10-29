#pragma once
// 子プロセスの起動 (引数配列のみ。シェルを経由しない: sh -c / cmd /c を使わない)。
// - 期限 (timeout) を過ぎたら kill。cancel が立ったら kill (barge-in)。
// - stdout は max_stdout まで保持し、超えたら kill して output_overflow を立てる。
// - stderr は読み捨てる (診断に秘密やソースが混ざりうるため保持しない。末尾 max_stderr だけ残す)。
// - 環境変数は env で渡したものだけ (親の環境をそのまま継がない)。

#include <atomic>
#include <chrono>
#include <filesystem>
#include <string>
#include <utility>
#include <vector>

namespace tr::io {

struct ProcessSpec {
    std::string file;  // 実行ファイル (POSIX は PATH を探索)
    std::vector<std::string> args;
    std::filesystem::path cwd;
    std::vector<std::pair<std::string, std::string>> env;
    std::string stdin_data;
    std::chrono::milliseconds timeout{150'000};
    std::size_t max_stdout = 1024 * 1024;
    std::size_t max_stderr = 4096;
};

struct ProcessResult {
    bool spawn_failed = false;
    int exit_code = -1;
    bool timed_out = false;
    bool cancelled = false;
    bool output_overflow = false;
    std::string out;
    std::string err_tail;
};

ProcessResult run_process(const ProcessSpec& spec, const std::atomic<bool>* cancel = nullptr);

// 親プロセスの環境変数の一覧。
std::vector<std::pair<std::string, std::string>> current_environment();

// PATH から実行ファイルを探す (Windows は .exe を補う)。見つからなければ空。
std::filesystem::path find_in_path(const std::string& name, const std::string& path_value);

}  // namespace tr::io
