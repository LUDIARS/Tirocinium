#include "io/resident_process.hpp"

#include <csignal>
#include <vector>

#ifdef _WIN32
#include <windows.h>
#else
#include <cerrno>
#include <fcntl.h>
#include <sys/syscall.h>
#include <sys/wait.h>
#include <unistd.h>
#endif

namespace tr::io {

namespace {

// 受け取ったバイト列を行に分けて渡す。上限を超えた行は捨てる (次の改行まで)。
class LineSplitter {
public:
    LineSplitter(std::size_t max, ResidentProcess::LineFn fn) : max_(max), fn_(std::move(fn)) {}
    void feed(const char* data, std::size_t n) {
        for (std::size_t i = 0; i < n; ++i) {
            const char c = data[i];
            if (c == '\n') {
                if (!overflow_ && fn_) {
                    if (!buf_.empty() && buf_.back() == '\r') buf_.pop_back();
                    fn_(buf_);
                }
                buf_.clear();
                overflow_ = false;
                continue;
            }
            if (overflow_) continue;
            if (buf_.size() >= max_) {
                overflow_ = true;
                buf_.clear();
                continue;
            }
            buf_.push_back(c);
        }
    }

private:
    std::size_t max_;
    ResidentProcess::LineFn fn_;
    std::string buf_;
    bool overflow_ = false;
};

}  // namespace

#ifndef _WIN32

struct ResidentProcess::Impl {
    pid_t pid = -1;
    int in_w = -1;
    std::thread out_thread, err_thread, wait_thread;
};

ResidentProcess::ResidentProcess(ProcessSpec spec, LineFn on_stdout, LineFn on_stderr, ExitFn on_exit, std::size_t max_line)
    : impl_(std::make_unique<Impl>()), spec_(std::move(spec)), on_stdout_(std::move(on_stdout)), on_stderr_(std::move(on_stderr)),
      on_exit_(std::move(on_exit)), max_line_(max_line) {}

ResidentProcess::~ResidentProcess() { stop(); }

bool ResidentProcess::start() {
    static const bool sigpipe_ignored = [] {
        std::signal(SIGPIPE, SIG_IGN);
        return true;
    }();
    (void)sigpipe_ignored;
    std::string path_value;
    for (const auto& [k, v] : spec_.env) {
        if (k == "PATH") path_value = v;
    }
    const auto exe = find_in_path(spec_.file, path_value);
    if (exe.empty()) return false;
    std::vector<std::string> argv_s{spec_.file};
    for (const auto& a : spec_.args) argv_s.push_back(a);
    std::vector<char*> argv;
    for (auto& a : argv_s) argv.push_back(a.data());
    argv.push_back(nullptr);
    std::vector<std::string> env_s;
    for (const auto& [k, v] : spec_.env) env_s.push_back(k + "=" + v);
    std::vector<char*> envp;
    for (auto& e : env_s) envp.push_back(e.data());
    envp.push_back(nullptr);
    const std::string exe_s = exe.string();
    const std::string cwd_s = spec_.cwd.string();
    int in_p[2], out_p[2], err_p[2], rep_p[2];
    if (::pipe2(in_p, O_CLOEXEC) || ::pipe2(out_p, O_CLOEXEC) || ::pipe2(err_p, O_CLOEXEC) || ::pipe2(rep_p, O_CLOEXEC)) return false;
    const pid_t pid = ::fork();
    if (pid < 0) return false;
    if (pid == 0) {
        ::setpgid(0, 0);
        ::dup2(in_p[0], 0);
        ::dup2(out_p[1], 1);
        ::dup2(err_p[1], 2);
#ifdef SYS_close_range
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
    ::close(in_p[0]);
    ::close(out_p[1]);
    ::close(err_p[1]);
    ::close(rep_p[1]);
    int child_errno = 0;
    const ssize_t rn = ::read(rep_p[0], &child_errno, sizeof child_errno);
    ::close(rep_p[0]);
    if (rn > 0) {
        ::waitpid(pid, nullptr, 0);
        ::close(in_p[1]);
        ::close(out_p[0]);
        ::close(err_p[0]);
        return false;
    }
    impl_->pid = pid;
    impl_->in_w = in_p[1];
    running_ = true;
    const int out_r = out_p[0];
    const int err_r = err_p[0];
    impl_->out_thread = std::thread([this, out_r] {
        LineSplitter split(max_line_, on_stdout_);
        char buf[16384];
        for (;;) {
            const ssize_t n = ::read(out_r, buf, sizeof buf);
            if (n > 0) split.feed(buf, static_cast<std::size_t>(n));
            else if (n == 0 || errno != EINTR) break;
        }
        ::close(out_r);
    });
    impl_->err_thread = std::thread([this, err_r] {
        LineSplitter split(64 * 1024, on_stderr_);
        char buf[8192];
        for (;;) {
            const ssize_t n = ::read(err_r, buf, sizeof buf);
            if (n > 0) split.feed(buf, static_cast<std::size_t>(n));
            else if (n == 0 || errno != EINTR) break;
        }
        ::close(err_r);
    });
    impl_->wait_thread = std::thread([this, pid] {
        int status = 0;
        ::waitpid(pid, &status, 0);
        running_ = false;
        if (on_exit_) on_exit_(WIFEXITED(status) ? WEXITSTATUS(status) : -1);
    });
    return true;
}

bool ResidentProcess::write_line(const std::string& line) {
    std::lock_guard lock(write_mu_);
    if (!running_ || impl_->in_w < 0) return false;
    std::string data = line + "\n";
    std::size_t off = 0;
    while (off < data.size()) {
        const ssize_t w = ::write(impl_->in_w, data.data() + off, data.size() - off);
        if (w < 0) {
            if (errno == EINTR) continue;
            return false;
        }
        off += static_cast<std::size_t>(w);
    }
    return true;
}

void ResidentProcess::stop() {
    if (!impl_) return;
    {
        std::lock_guard lock(write_mu_);
        if (impl_->in_w >= 0) {
            ::close(impl_->in_w);  // 子は標準入力の終わりで止まる (worker の rl.on('close'))
            impl_->in_w = -1;
        }
    }
    if (impl_->pid > 0 && running_) {
        // 3 秒待って終わらなければ子孫ごと止める
        for (int i = 0; i < 30 && running_; ++i) std::this_thread::sleep_for(std::chrono::milliseconds(100));
        if (running_) {
            ::kill(-impl_->pid, SIGKILL);
            ::kill(impl_->pid, SIGKILL);
        }
    }
    if (impl_->wait_thread.joinable()) impl_->wait_thread.join();
    if (impl_->pid > 0) ::kill(-impl_->pid, SIGKILL);  // 孫が出力を握っていても読み取りを終わらせる
    if (impl_->out_thread.joinable()) impl_->out_thread.join();
    if (impl_->err_thread.joinable()) impl_->err_thread.join();
    impl_->pid = -1;
}

#else  // _WIN32

struct ResidentProcess::Impl {
    HANDLE process = nullptr;
    HANDLE job = nullptr;
    HANDLE in_w = nullptr;
    std::thread out_thread, err_thread, wait_thread;
};

namespace {

std::wstring widen(const std::string& s) {
    if (s.empty()) return {};
    const int n = MultiByteToWideChar(CP_UTF8, 0, s.data(), static_cast<int>(s.size()), nullptr, 0);
    std::wstring out(static_cast<std::size_t>(n), L'\0');
    MultiByteToWideChar(CP_UTF8, 0, s.data(), static_cast<int>(s.size()), out.data(), n);
    return out;
}

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

ResidentProcess::ResidentProcess(ProcessSpec spec, LineFn on_stdout, LineFn on_stderr, ExitFn on_exit, std::size_t max_line)
    : impl_(std::make_unique<Impl>()), spec_(std::move(spec)), on_stdout_(std::move(on_stdout)), on_stderr_(std::move(on_stderr)),
      on_exit_(std::move(on_exit)), max_line_(max_line) {}

ResidentProcess::~ResidentProcess() { stop(); }

bool ResidentProcess::start() {
    std::string path_value;
    for (const auto& [k, v] : spec_.env) {
        if (_stricmp(k.c_str(), "PATH") == 0) path_value = v;
    }
    const auto exe = find_in_path(spec_.file, path_value);
    const std::wstring ext = exe.extension().wstring();
    if (exe.empty() || _wcsicmp(ext.c_str(), L".cmd") == 0 || _wcsicmp(ext.c_str(), L".bat") == 0) return false;
    std::wstring cmd;
    append_quoted(cmd, exe.wstring());
    for (const auto& a : spec_.args) {
        cmd.push_back(L' ');
        append_quoted(cmd, widen(a));
    }
    std::wstring env_block;
    for (const auto& [k, v] : spec_.env) {
        env_block += widen(k) + L"=" + widen(v);
        env_block.push_back(L'\0');
    }
    env_block.push_back(L'\0');
    SECURITY_ATTRIBUTES sa{sizeof(SECURITY_ATTRIBUTES), nullptr, TRUE};
    HANDLE in_r = nullptr, in_w = nullptr, out_r = nullptr, out_w = nullptr, err_r = nullptr, err_w = nullptr;
    if (!CreatePipe(&in_r, &in_w, &sa, 0) || !CreatePipe(&out_r, &out_w, &sa, 0) || !CreatePipe(&err_r, &err_w, &sa, 0)) return false;
    SetHandleInformation(in_w, HANDLE_FLAG_INHERIT, 0);
    SetHandleInformation(out_r, HANDLE_FLAG_INHERIT, 0);
    SetHandleInformation(err_r, HANDLE_FLAG_INHERIT, 0);
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
    impl_->job = CreateJobObjectW(nullptr, nullptr);
    if (impl_->job) {
        JOBOBJECT_EXTENDED_LIMIT_INFORMATION info{};
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        SetInformationJobObject(impl_->job, JobObjectExtendedLimitInformation, &info, sizeof info);
    }
    const std::wstring cwd = spec_.cwd.wstring();
    const BOOL ok = CreateProcessW(exe.wstring().c_str(), cmd.data(), nullptr, nullptr, TRUE,
                                   CREATE_UNICODE_ENVIRONMENT | CREATE_NO_WINDOW | EXTENDED_STARTUPINFO_PRESENT | CREATE_SUSPENDED,
                                   env_block.data(), cwd.empty() ? nullptr : cwd.c_str(), &si.StartupInfo, &pi);
    DeleteProcThreadAttributeList(attrs);
    CloseHandle(in_r);
    CloseHandle(out_w);
    CloseHandle(err_w);
    if (!ok) {
        CloseHandle(in_w);
        CloseHandle(out_r);
        CloseHandle(err_r);
        return false;
    }
    if (impl_->job) AssignProcessToJobObject(impl_->job, pi.hProcess);
    ResumeThread(pi.hThread);
    CloseHandle(pi.hThread);
    impl_->process = pi.hProcess;
    impl_->in_w = in_w;
    running_ = true;
    impl_->out_thread = std::thread([this, out_r] {
        LineSplitter split(max_line_, on_stdout_);
        char buf[16384];
        DWORD n = 0;
        while (ReadFile(out_r, buf, sizeof buf, &n, nullptr) && n > 0) split.feed(buf, n);
        CloseHandle(out_r);
    });
    impl_->err_thread = std::thread([this, err_r] {
        LineSplitter split(64 * 1024, on_stderr_);
        char buf[8192];
        DWORD n = 0;
        while (ReadFile(err_r, buf, sizeof buf, &n, nullptr) && n > 0) split.feed(buf, n);
        CloseHandle(err_r);
    });
    impl_->wait_thread = std::thread([this] {
        WaitForSingleObject(impl_->process, INFINITE);
        DWORD code = 1;
        GetExitCodeProcess(impl_->process, &code);
        running_ = false;
        if (on_exit_) on_exit_(static_cast<int>(code));
    });
    return true;
}

bool ResidentProcess::write_line(const std::string& line) {
    std::lock_guard lock(write_mu_);
    if (!running_ || !impl_->in_w) return false;
    const std::string data = line + "\n";
    DWORD written = 0;
    std::size_t off = 0;
    while (off < data.size()) {
        if (!WriteFile(impl_->in_w, data.data() + off, static_cast<DWORD>(data.size() - off), &written, nullptr)) return false;
        off += written;
    }
    return true;
}

void ResidentProcess::stop() {
    if (!impl_) return;
    {
        std::lock_guard lock(write_mu_);
        if (impl_->in_w) {
            CloseHandle(impl_->in_w);
            impl_->in_w = nullptr;
        }
    }
    if (impl_->process && running_) {
        if (WaitForSingleObject(impl_->process, 3000) != WAIT_OBJECT_0) {
            if (impl_->job) TerminateJobObject(impl_->job, 1);
            TerminateProcess(impl_->process, 1);
        }
    }
    if (impl_->wait_thread.joinable()) impl_->wait_thread.join();
    if (impl_->job) {
        TerminateJobObject(impl_->job, 1);
        CloseHandle(impl_->job);
        impl_->job = nullptr;
    }
    if (impl_->out_thread.joinable()) impl_->out_thread.join();
    if (impl_->err_thread.joinable()) impl_->err_thread.join();
    if (impl_->process) {
        CloseHandle(impl_->process);
        impl_->process = nullptr;
    }
}

#endif

}  // namespace tr::io
