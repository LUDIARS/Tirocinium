#include "io/process.hpp"

#include <algorithm>
#include <cstring>
#include <thread>

#include <lorica/checked_size.hpp>

#include "core/text.hpp"

#ifdef _WIN32
#include <windows.h>
#else
#include <cerrno>
#include <csignal>
#include <fcntl.h>
#include <poll.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>
extern char** environ;
#endif

namespace tr::io {

namespace {

bool is_executable_file(const std::filesystem::path& p) {
    std::error_code ec;
    if (!std::filesystem::is_regular_file(p, ec)) return false;
#ifdef _WIN32
    return true;
#else
    return ::access(p.c_str(), X_OK) == 0;
#endif
}

}  // namespace

std::filesystem::path find_in_path(const std::string& name, const std::string& path_value) {
    if (name.find('/') != std::string::npos || name.find('\\') != std::string::npos) {
        std::filesystem::path p(name);
        return is_executable_file(p) ? p : std::filesystem::path();
    }
#ifdef _WIN32
    const char sep = ';';
#else
    const char sep = ':';
#endif
    for (const auto& dir : split(path_value, sep)) {
        if (dir.empty()) continue;
        std::filesystem::path base(dir);
#ifdef _WIN32
        for (const char* ext : {".exe", ""}) {
            auto p = base / (name + ext);
            if (is_executable_file(p)) return p;
        }
#else
        auto p = base / name;
        if (is_executable_file(p)) return p;
#endif
    }
    return {};
}

#ifndef _WIN32

std::vector<std::pair<std::string, std::string>> current_environment() {
    std::vector<std::pair<std::string, std::string>> out;
    for (char** e = environ; e && *e; ++e) {
        std::string kv(*e);
        const auto eq = kv.find('=');
        if (eq == std::string::npos || eq == 0) continue;
        out.emplace_back(kv.substr(0, eq), kv.substr(eq + 1));
    }
    return out;
}

namespace {

void set_nonblocking(int fd) { ::fcntl(fd, F_SETFL, ::fcntl(fd, F_GETFL) | O_NONBLOCK); }

void close_fd(int& fd) {
    if (fd >= 0) {
        ::close(fd);
        fd = -1;
    }
}

}  // namespace

ProcessResult run_process(const ProcessSpec& spec, const std::atomic<bool>* cancel) {
    // 子が先に終わった stdin への書き込みで SIGPIPE を受けて落ちないように (Node の EPIPE 無視と同じ)。
    static const bool sigpipe_ignored = [] {
        std::signal(SIGPIPE, SIG_IGN);
        return true;
    }();
    (void)sigpipe_ignored;
    ProcessResult result;
    std::string path_value;
    for (const auto& [k, v] : spec.env) {
        if (k == "PATH") path_value = v;
    }
    const auto exe = find_in_path(spec.file, path_value);
    if (exe.empty()) {
        result.spawn_failed = true;
        return result;
    }
    // fork の前に確保を済ませる (子では async-signal-safe な呼び出しだけを使う)。
    std::vector<std::string> argv_s;
    argv_s.push_back(spec.file);
    for (const auto& a : spec.args) argv_s.push_back(a);
    std::vector<char*> argv;
    for (auto& a : argv_s) argv.push_back(a.data());
    argv.push_back(nullptr);
    std::vector<std::string> env_s;
    for (const auto& [k, v] : spec.env) env_s.push_back(k + "=" + v);
    std::vector<char*> envp;
    for (auto& e : env_s) envp.push_back(e.data());
    envp.push_back(nullptr);
    const std::string exe_s = exe.string();
    const std::string cwd_s = spec.cwd.string();

    int in_p[2], out_p[2], err_p[2], rep_p[2];
    if (::pipe2(in_p, O_CLOEXEC) != 0) {
        result.spawn_failed = true;
        return result;
    }
    if (::pipe2(out_p, O_CLOEXEC) != 0 || ::pipe2(err_p, O_CLOEXEC) != 0 || ::pipe2(rep_p, O_CLOEXEC) != 0) {
        result.spawn_failed = true;
        return result;
    }
    const pid_t pid = ::fork();
    if (pid < 0) {
        result.spawn_failed = true;
        for (int fd : {in_p[0], in_p[1], out_p[0], out_p[1], err_p[0], err_p[1], rep_p[0], rep_p[1]}) ::close(fd);
        return result;
    }
    if (pid == 0) {
        ::setpgid(0, 0);  // 子孫ごと kill できるように独自のプロセスグループにする
        ::dup2(in_p[0], 0);
        ::dup2(out_p[1], 1);
        ::dup2(err_p[1], 2);
#ifdef SYS_close_range
        // 他スレッドが CLOEXEC なしで開いた fd (ソケット等) を子に渡さない。報告用の fd だけ残す
        // (O_CLOEXEC なので exec の成功で閉じる)。
        {
            const unsigned rep = static_cast<unsigned>(rep_p[1]);
            if (rep > 3) ::syscall(SYS_close_range, 3u, rep - 1, 0u);
            ::syscall(SYS_close_range, rep + 1, ~0u, 0u);
        }
#endif
        if (!cwd_s.empty() && ::chdir(cwd_s.c_str()) != 0) {
            const int e = errno;
            (void)!::write(rep_p[1], &e, sizeof e);
            ::_exit(127);
        }
        ::execve(exe_s.c_str(), argv.data(), envp.data());
        const int e = errno;
        (void)!::write(rep_p[1], &e, sizeof e);
        ::_exit(127);
    }
    ::setpgid(pid, pid);
    int in_w = in_p[1], out_r = out_p[0], err_r = err_p[0], rep_r = rep_p[0];
    ::close(in_p[0]);
    ::close(out_p[1]);
    ::close(err_p[1]);
    ::close(rep_p[1]);
    int child_errno = 0;
    const ssize_t rn = ::read(rep_r, &child_errno, sizeof child_errno);
    ::close(rep_r);
    if (rn > 0) {
        ::waitpid(pid, nullptr, 0);
        close_fd(in_w);
        close_fd(out_r);
        close_fd(err_r);
        result.spawn_failed = true;
        return result;
    }
    set_nonblocking(in_w);
    set_nonblocking(out_r);
    set_nonblocking(err_r);
    std::size_t written = 0;
    if (spec.stdin_data.empty()) close_fd(in_w);
    const auto deadline = std::chrono::steady_clock::now() + spec.timeout;
    bool killed = false;
    auto kill_tree = [&] {
        if (!killed) {
            ::kill(-pid, SIGKILL);
            ::kill(pid, SIGKILL);
            killed = true;
        }
    };
    char buf[16384];
    int status = 0;
    bool exited = false;
    while (out_r >= 0 || err_r >= 0 || !exited) {
        if (cancel && cancel->load()) {
            result.cancelled = true;
            kill_tree();
        }
        if (std::chrono::steady_clock::now() >= deadline) {
            result.timed_out = true;
            kill_tree();
        }
        pollfd fds[3];
        nfds_t n = 0;
        int idx_out = -1, idx_err = -1, idx_in = -1;
        if (out_r >= 0) {
            idx_out = static_cast<int>(n);
            fds[n++] = {out_r, POLLIN, 0};
        }
        if (err_r >= 0) {
            idx_err = static_cast<int>(n);
            fds[n++] = {err_r, POLLIN, 0};
        }
        if (in_w >= 0) {
            idx_in = static_cast<int>(n);
            fds[n++] = {in_w, POLLOUT, 0};
        }
        if (n > 0) {
            ::poll(fds, n, 100);
        } else {
            std::this_thread::sleep_for(std::chrono::milliseconds(20));
        }
        if (idx_out >= 0 && (fds[idx_out].revents & (POLLIN | POLLHUP | POLLERR))) {
            const ssize_t r = ::read(out_r, buf, sizeof buf);
            if (r > 0) {
                // 長さの加算は checked_add (桁あふれは上限超過と同じに扱う)。
                const auto total = lorica::checked_add(result.out.size(), static_cast<std::size_t>(r));
                if (!total || *total > spec.max_stdout) {
                    result.output_overflow = true;
                    kill_tree();
                    close_fd(out_r);
                } else {
                    result.out.append(buf, static_cast<std::size_t>(r));
                }
            } else if (r == 0 || (errno != EAGAIN && errno != EINTR)) {
                close_fd(out_r);
            }
        }
        if (idx_err >= 0 && (fds[idx_err].revents & (POLLIN | POLLHUP | POLLERR))) {
            const ssize_t r = ::read(err_r, buf, sizeof buf);
            if (r > 0) {
                result.err_tail.append(buf, static_cast<std::size_t>(r));
                if (result.err_tail.size() > spec.max_stderr) {
                    result.err_tail.erase(0, result.err_tail.size() - spec.max_stderr);
                }
            } else if (r == 0 || (errno != EAGAIN && errno != EINTR)) {
                close_fd(err_r);
            }
        }
        if (idx_in >= 0 && (fds[idx_in].revents & (POLLOUT | POLLERR | POLLHUP))) {
            const ssize_t w = ::write(in_w, spec.stdin_data.data() + written, spec.stdin_data.size() - written);
            if (w > 0) {
                written += static_cast<std::size_t>(w);
                if (written >= spec.stdin_data.size()) close_fd(in_w);
            } else if (w < 0 && errno != EAGAIN && errno != EINTR) {
                close_fd(in_w);  // EPIPE: 子が入力を読まずに終わった
            }
        }
        if (!exited) {
            const pid_t w = ::waitpid(pid, &status, WNOHANG);
            if (w == pid) {
                exited = true;
                close_fd(in_w);
            }
        }
        if (exited && killed) {
            // kill 後は残りの出力を待たない (孫が出力を握っていても抜ける)。
            break;
        }
    }
    close_fd(in_w);
    close_fd(out_r);
    close_fd(err_r);
    if (!exited) ::waitpid(pid, &status, 0);
    if (WIFEXITED(status)) result.exit_code = WEXITSTATUS(status);
    else result.exit_code = -1;
    return result;
}

#else  // _WIN32

namespace {

std::wstring widen(const std::string& s) {
    if (s.empty()) return {};
    const int n = MultiByteToWideChar(CP_UTF8, 0, s.data(), static_cast<int>(s.size()), nullptr, 0);
    std::wstring out(static_cast<std::size_t>(n), L'\0');
    MultiByteToWideChar(CP_UTF8, 0, s.data(), static_cast<int>(s.size()), out.data(), n);
    return out;
}

std::string narrow(const std::wstring& s) {
    if (s.empty()) return {};
    const int n = WideCharToMultiByte(CP_UTF8, 0, s.data(), static_cast<int>(s.size()), nullptr, 0, nullptr, nullptr);
    std::string out(static_cast<std::size_t>(n), '\0');
    WideCharToMultiByte(CP_UTF8, 0, s.data(), static_cast<int>(s.size()), out.data(), n, nullptr, nullptr);
    return out;
}

// CommandLineToArgvW / MSVCRT と同じ規則で 1 引数を引用する (シェルは介さない)。
void append_quoted(std::wstring& cmd, const std::wstring& arg) {
    if (!arg.empty() && arg.find_first_of(L" \t\n\v\"") == std::wstring::npos) {
        cmd += arg;
        return;
    }
    cmd.push_back(L'"');
    for (auto it = arg.begin();; ++it) {
        std::size_t backslashes = 0;
        while (it != arg.end() && *it == L'\\') {
            ++it;
            ++backslashes;
        }
        if (it == arg.end()) {
            cmd.append(backslashes * 2, L'\\');
            break;
        }
        if (*it == L'"') {
            cmd.append(backslashes * 2 + 1, L'\\');
            cmd.push_back(*it);
        } else {
            cmd.append(backslashes, L'\\');
            cmd.push_back(*it);
        }
    }
    cmd.push_back(L'"');
}

}  // namespace

std::vector<std::pair<std::string, std::string>> current_environment() {
    std::vector<std::pair<std::string, std::string>> out;
    LPWCH block = GetEnvironmentStringsW();
    if (!block) return out;
    for (LPWCH p = block; *p; p += wcslen(p) + 1) {
        std::wstring kv(p);
        const auto eq = kv.find(L'=', 1);  // "=C:=C:\\" のような隠し変数を飛ばす
        if (eq == std::wstring::npos || kv[0] == L'=') continue;
        out.emplace_back(narrow(kv.substr(0, eq)), narrow(kv.substr(eq + 1)));
    }
    FreeEnvironmentStringsW(block);
    return out;
}

ProcessResult run_process(const ProcessSpec& spec, const std::atomic<bool>* cancel) {
    ProcessResult result;
    std::string path_value;
    for (const auto& [k, v] : spec.env) {
        if (_stricmp(k.c_str(), "PATH") == 0) path_value = v;
    }
    const auto exe = find_in_path(spec.file, path_value);
    const std::wstring ext = exe.extension().wstring();
    // .cmd / .bat は cmd.exe を経由してしまうので起動しない (シェル禁止)。
    if (exe.empty() || _wcsicmp(ext.c_str(), L".cmd") == 0 || _wcsicmp(ext.c_str(), L".bat") == 0) {
        result.spawn_failed = true;
        return result;
    }
    std::wstring cmd;
    append_quoted(cmd, exe.wstring());
    for (const auto& a : spec.args) {
        cmd.push_back(L' ');
        append_quoted(cmd, widen(a));
    }
    auto env_sorted = spec.env;
    std::sort(env_sorted.begin(), env_sorted.end(),
              [](const auto& a, const auto& b) { return _stricmp(a.first.c_str(), b.first.c_str()) < 0; });
    std::wstring env_block;
    for (const auto& [k, v] : env_sorted) {
        env_block += widen(k) + L"=" + widen(v);
        env_block.push_back(L'\0');
    }
    env_block.push_back(L'\0');

    SECURITY_ATTRIBUTES sa{sizeof(SECURITY_ATTRIBUTES), nullptr, TRUE};
    HANDLE in_r = nullptr, in_w = nullptr, out_r = nullptr, out_w = nullptr, err_r = nullptr, err_w = nullptr;
    if (!CreatePipe(&in_r, &in_w, &sa, 0) || !CreatePipe(&out_r, &out_w, &sa, 0) || !CreatePipe(&err_r, &err_w, &sa, 0)) {
        result.spawn_failed = true;
        return result;
    }
    SetHandleInformation(in_w, HANDLE_FLAG_INHERIT, 0);
    SetHandleInformation(out_r, HANDLE_FLAG_INHERIT, 0);
    SetHandleInformation(err_r, HANDLE_FLAG_INHERIT, 0);

    // 継承するハンドルを 3 本に限る (他スレッドが開いたハンドルを子に漏らさない)。
    SIZE_T attr_size = 0;
    InitializeProcThreadAttributeList(nullptr, 1, 0, &attr_size);
    std::vector<unsigned char> attr_buf(attr_size);
    auto* attrs = reinterpret_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(attr_buf.data());
    HANDLE inherit[3] = {in_r, out_w, err_w};
    InitializeProcThreadAttributeList(attrs, 1, 0, &attr_size);
    UpdateProcThreadAttribute(attrs, 0, PROC_THREAD_ATTRIBUTE_HANDLE_LIST, inherit, sizeof inherit, nullptr, nullptr);

    STARTUPINFOEXW si{};
    si.StartupInfo.cb = sizeof si;
    si.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
    si.StartupInfo.hStdInput = in_r;
    si.StartupInfo.hStdOutput = out_w;
    si.StartupInfo.hStdError = err_w;
    si.lpAttributeList = attrs;
    PROCESS_INFORMATION pi{};
    HANDLE job = CreateJobObjectW(nullptr, nullptr);
    if (job) {
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION info{};
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        SetInformationJobObject(job, JobObjectExtendedLimitInformation, &info, sizeof info);
    }
    const std::wstring cwd = spec.cwd.wstring();
    const BOOL ok = CreateProcessW(exe.wstring().c_str(), cmd.data(), nullptr, nullptr, TRUE,
                                   CREATE_UNICODE_ENVIRONMENT | CREATE_NO_WINDOW | EXTENDED_STARTUPINFO_PRESENT |
                                       CREATE_SUSPENDED,
                                   env_block.data(), cwd.empty() ? nullptr : cwd.c_str(), &si.StartupInfo, &pi);
    DeleteProcThreadAttributeList(attrs);
    CloseHandle(in_r);
    CloseHandle(out_w);
    CloseHandle(err_w);
    if (!ok) {
        CloseHandle(in_w);
        CloseHandle(out_r);
        CloseHandle(err_r);
        if (job) CloseHandle(job);
        result.spawn_failed = true;
        return result;
    }
    if (job) AssignProcessToJobObject(job, pi.hProcess);
    ResumeThread(pi.hThread);
    CloseHandle(pi.hThread);

    std::atomic<bool> overflow{false};
    std::string out;
    std::string err;
    std::thread reader_out([&] {
        char buf[16384];
        DWORD n = 0;
        while (ReadFile(out_r, buf, sizeof buf, &n, nullptr) && n > 0) {
            const auto total = lorica::checked_add(out.size(), static_cast<std::size_t>(n));
            if (!total || *total > spec.max_stdout) {
                overflow = true;
                break;
            }
            out.append(buf, n);
        }
    });
    std::thread reader_err([&] {
        char buf[4096];
        DWORD n = 0;
        while (ReadFile(err_r, buf, sizeof buf, &n, nullptr) && n > 0) {
            err.append(buf, n);
            if (err.size() > spec.max_stderr) err.erase(0, err.size() - spec.max_stderr);
        }
    });
    std::thread writer([&] {
        std::size_t written = 0;
        while (written < spec.stdin_data.size()) {
            DWORD w = 0;
            const DWORD chunk = static_cast<DWORD>(std::min<std::size_t>(spec.stdin_data.size() - written, 65536));
            if (!WriteFile(in_w, spec.stdin_data.data() + written, chunk, &w, nullptr)) break;  // 子が読まずに終わった
            written += w;
        }
        CloseHandle(in_w);
    });
    const auto deadline = std::chrono::steady_clock::now() + spec.timeout;
    bool killed = false;
    for (;;) {
        if (WaitForSingleObject(pi.hProcess, 100) == WAIT_OBJECT_0) break;
        if (cancel && cancel->load()) result.cancelled = true;
        if (std::chrono::steady_clock::now() >= deadline) result.timed_out = true;
        if (overflow) result.output_overflow = true;
        if (result.cancelled || result.timed_out || result.output_overflow) {
            if (job) TerminateJobObject(job, 1);
            TerminateProcess(pi.hProcess, 1);
            killed = true;
            WaitForSingleObject(pi.hProcess, 5000);
            break;
        }
    }
    if (overflow) result.output_overflow = true;
    if (job) {
        TerminateJobObject(job, 1);  // 孫が出力パイプを握っていても読み取りスレッドが抜けられるように
        CloseHandle(job);
    }
    writer.join();
    reader_out.join();
    reader_err.join();
    CloseHandle(out_r);
    CloseHandle(err_r);
    DWORD code = 1;
    GetExitCodeProcess(pi.hProcess, &code);
    CloseHandle(pi.hProcess);
    result.exit_code = killed ? -1 : static_cast<int>(code);
    result.out = std::move(out);
    result.err_tail = std::move(err);
    return result;
}

#endif

}  // namespace tr::io
