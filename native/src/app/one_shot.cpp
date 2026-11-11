#include "app/one_shot.hpp"

#include <algorithm>
#include <filesystem>
#include <map>

#include "core/text.hpp"
#include "io/process.hpp"

namespace tr::app {

namespace {

std::optional<std::string> env_get(const EnvList& env, const std::string& key) {
    for (const auto& [k, v] : env) {
#ifdef _WIN32
        if (ascii_lower(k) == ascii_lower(key)) return v;
#else
        if (k == key) return v;
#endif
    }
    return std::nullopt;
}

bool blocked_env_key(const std::string& key) {
    // /^(ANTHROPIC_API_KEY|ANTHROPIC_AUTH_TOKEN|ANTHROPIC_BASE_URL|OPENAI_API_KEY|OPENAI_BASE_URL|CODEX_API_KEY|
    //   CLAUDE_CODE_USE_BEDROCK|CLAUDE_CODE_USE_VERTEX|CLAUDE_CODE_USE_FOUNDRY|CLAUDE_CODE_USE_ANTHROPIC_AWS|
    //   CLAUDECODE|CONCORDIA_HOOK|LICTOR_.*)$/i
    static const std::vector<std::string> exact = {
        "anthropic_api_key",       "anthropic_auth_token",   "anthropic_base_url",     "openai_api_key",
        "openai_base_url",         "codex_api_key",          "claude_code_use_bedrock", "claude_code_use_vertex",
        "claude_code_use_foundry", "claude_code_use_anthropic_aws", "claudecode",         "concordia_hook"};
    const std::string k = ascii_lower(key);
    if (std::find(exact.begin(), exact.end(), k) != exact.end()) return true;
    return starts_with(k, "lictor_");
}

bool valid_model_id(const std::string& m) {
    if (m.empty()) return false;
    const auto ok_first = [](char c) { return std::isalnum(static_cast<unsigned char>(c)) != 0; };
    if (!ok_first(m[0])) return false;
    return std::all_of(m.begin() + 1, m.end(), [](char c) {
        return std::isalnum(static_cast<unsigned char>(c)) || c == '.' || c == '_' || c == ':' || c == '/' || c == '-';
    });
}

}  // namespace

EnvList subscription_environment(const EnvList& source) {
    EnvList out;
    for (const auto& kv : source) {
        if (!blocked_env_key(kv.first)) out.push_back(kv);
    }
    return out;
}

std::string resolve_model(const std::optional<std::string>& role_or_id, const std::string& provider, const EnvList& env) {
    static const std::map<std::string, std::string> defaults = {
        {"opus", "claude-opus-5-5"},  {"sonnet", "claude-sonnet-5"}, {"haiku", "claude-haiku-4-5-20251001"},
        {"fable", "claude-fable-5-1"}, {"astra", "gpt-6-astra"},     {"sol", "gpt-6-sol"},
        {"luna", "gpt-6-luna"}};
    const std::string requested =
        role_or_id && !role_or_id->empty() ? *role_or_id : (provider == "claude" ? "sonnet" : "sol");
    std::string model = requested;
    if (auto it = defaults.find(requested); it != defaults.end()) {
        std::string upper = requested;
        for (auto& c : upper) c = static_cast<char>(std::toupper(static_cast<unsigned char>(c)));
        auto o = env_get(env, "LUDIARS_ONESHOT_MODEL_" + upper);
        model = o && !o->empty() ? *o : it->second;
    }
    if (!valid_model_id(model)) throw std::runtime_error("Invalid one-shot model");
    if (provider == "claude" && !starts_with(model, "claude-")) throw std::runtime_error("Claude requires a Claude model");
    if (provider == "codex" && !starts_with(model, "gpt-")) throw std::runtime_error("Codex requires a GPT model");
    return model;
}

std::vector<std::string> resolve_model_args(std::vector<std::string> args, const std::string& provider, const EnvList& env) {
    auto index = std::find_if(args.begin(), args.end(), [](const std::string& a) { return a == "--model" || a == "-m"; });
    auto inline_it = std::find_if(args.begin(), args.end(), [](const std::string& a) { return starts_with(a, "--model="); });
    if (index != args.end()) {
        if (index + 1 == args.end() || (index + 1)->empty()) throw std::runtime_error("Missing model argument");
        *(index + 1) = resolve_model(*(index + 1), provider, env);
    } else if (inline_it != args.end()) {
        *inline_it = "--model=" + resolve_model(inline_it->substr(8), provider, env);
    } else {
        std::size_t position = 0;
        if (provider == "codex") {
            auto e = std::find(args.begin(), args.end(), "exec");
            // indexOf('exec') + 1 (exec が無ければ -1 + 1 = 0)
            position = e == args.end() ? 0 : static_cast<std::size_t>(e - args.begin()) + 1;
        }
        args.insert(args.begin() + static_cast<std::ptrdiff_t>(position), {"--model", resolve_model(std::nullopt, provider, env)});
    }
    return args;
}

OneShotLaunch prepare_one_shot(std::string file, std::vector<std::string> args, const EnvList& base_env) {
    // 既存の cmd.exe 包みを本物の CLI に読み替える (シェル文字列は実行しない)。
    const std::string base = ascii_lower(std::filesystem::path(file).filename().string());
    if (base == "cmd" || base == "cmd.exe") {
        auto marker = std::find_if(args.begin(), args.end(), [](const std::string& a) { return ascii_lower(a) == "/c"; });
        if (marker == args.end() || marker + 1 == args.end() || (marker + 1)->empty() ||
            (marker + 1)->find_first_of(" \t\r\n") != std::string::npos) {
            throw std::runtime_error("Unsupported CLI shell wrapper");
        }
        file = *(marker + 1);
        args = std::vector<std::string>(marker + 2, args.end());
    }
    std::string provider;
    if (std::find(args.begin(), args.end(), "exec") != args.end()) provider = "codex";
    else if (std::find(args.begin(), args.end(), "-p") != args.end() ||
             std::find(args.begin(), args.end(), "--print") != args.end())
        provider = "claude";
    else throw std::runtime_error("One-shot launch requires claude print mode or codex exec");
    OneShotLaunch launch;
    launch.env = subscription_environment(base_env);
#ifdef _WIN32
    if (provider == "claude" && !env_get(launch.env, "CLAUDE_CODE_GIT_BASH_PATH")) {
        for (const char* bash : {"C:/Program Files/Git/bin/bash.exe", "C:/Program Files (x86)/Git/bin/bash.exe"}) {
            std::error_code ec;
            if (std::filesystem::exists(bash, ec)) {
                launch.env.emplace_back("CLAUDE_CODE_GIT_BASH_PATH", bash);
                break;
            }
        }
    }
    // resolveExecutable: ネイティブ exe か、npm 同梱の exe / JS 入口 (node で起動) を探す。.cmd は起動しない。
    const std::string path_value = env_get(launch.env, "PATH").value_or("");
    std::string name = std::filesystem::path(file).filename().string();
    if (ends_with(ascii_lower(name), ".exe") || ends_with(ascii_lower(name), ".cmd")) name = name.substr(0, name.size() - 4);
    std::vector<std::filesystem::path> dirs;
    if (file.find_first_of("/\\") != std::string::npos) dirs.push_back(std::filesystem::path(file).parent_path());
    else
        for (const auto& d : split(path_value, ';'))
            if (!d.empty()) dirs.emplace_back(d);
    std::vector<std::string> prefix;
    std::string resolved;
    for (const auto& dir : dirs) {
        std::error_code ec;
        auto native = dir / (name + ".exe");
        if (std::filesystem::exists(native, ec)) {
            resolved = native.string();
            break;
        }
        if (name == "claude") {
            auto bin = dir / "node_modules" / "@anthropic-ai" / "claude-code" / "bin" / "claude.exe";
            if (std::filesystem::exists(bin, ec)) {
                resolved = bin.string();
                break;
            }
        }
        if (name == "codex") {
            for (const char* pkg : {"codex", "codex-win32-x64"}) {
                auto bin = dir / "node_modules" / "@openai" / pkg / "vendor" / "x86_64-pc-windows-msvc" / "codex" / "codex.exe";
                if (std::filesystem::exists(bin, ec)) {
                    resolved = bin.string();
                    break;
                }
            }
            if (!resolved.empty()) break;
        }
        std::filesystem::path entry;
        if (name == "codex") entry = dir / "node_modules" / "@openai" / "codex" / "bin" / "codex.js";
        if (name == "claude") entry = dir / "node_modules" / "@anthropic-ai" / "claude-code" / "cli.js";
        if (!entry.empty() && std::filesystem::exists(entry, ec)) {
            auto node = io::find_in_path("node", path_value);
            if (!node.empty()) {
                resolved = node.string();
                prefix.push_back(entry.string());
                break;
            }
        }
    }
    const std::string lower_file = ascii_lower(file);
    if (resolved.empty() && (ends_with(lower_file, ".cmd") || ends_with(lower_file, ".bat"))) {
        throw std::runtime_error("One-shot launch requires a native executable or a known npm CLI entry point");
    }
    launch.file = resolved.empty() ? file : resolved;
    launch.args = prefix;
#else
    launch.file = file;
#endif
    auto model_args = resolve_model_args(args, provider, launch.env);
    launch.args.insert(launch.args.end(), model_args.begin(), model_args.end());
    return launch;
}

}  // namespace tr::app
