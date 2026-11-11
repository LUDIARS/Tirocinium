// 子プロセスの起動 (引数配列・期限・出力上限・取消し) と one-shot の起動規則、LLM 出口のテスト。
// 本物の claude / codex は起動しない (偽の CLI を一時フォルダに置く)。
#include <filesystem>
#include <fstream>
#include <random>

#include "check.hpp"
#include "app/llm.hpp"
#include "app/one_shot.hpp"
#include "io/process.hpp"

using namespace tr;
using trtest::check;
using trtest::check_eq;

namespace {

std::filesystem::path temp_dir(const std::string& name) {
    static const auto tag = std::to_string(std::random_device{}());
    auto d = std::filesystem::temp_directory_path() / ("tr-proc-" + tag + "-" + name);
    std::filesystem::create_directories(d);
    return d;
}

app::EnvList base_env_with_path(const std::filesystem::path& extra) {
    app::EnvList env;
    std::string path = extra.string();
    for (const auto& [k, v] : io::current_environment()) {
        if (k == "PATH") path += ":" + v;
    }
    env.emplace_back("PATH", path);
    env.emplace_back("ANTHROPIC_API_KEY", "must-not-leak");
    env.emplace_back("LICTOR_TOKEN", "must-not-leak");
    env.emplace_back("KEEP_ME", "yes");
    return env;
}

void write_script(const std::filesystem::path& p, const std::string& body) {
    std::ofstream out(p);
    out << "#!/bin/sh\n" << body << "\n";
    out.close();
    std::filesystem::permissions(p, std::filesystem::perms::owner_all);
}

}  // namespace

#ifndef _WIN32
TEST_CASE("process: stdin is delivered, stdout captured, exit code reported") {
    io::ProcessSpec s;
    s.file = "cat";
    s.env = {{"PATH", "/usr/bin:/bin"}};
    s.stdin_data = "面接 hello";
    auto r = io::run_process(s);
    check(!r.spawn_failed && r.exit_code == 0, "ran");
    check_eq(r.out, std::string("面接 hello"), "echo");
}

TEST_CASE("process: arguments are passed as an array (no shell interpretation)") {
    io::ProcessSpec s;
    s.file = "printf";
    s.args = {"%s|", "a b", "$(echo injected)", ";ls"};
    s.env = {{"PATH", "/usr/bin:/bin"}};
    auto r = io::run_process(s);
    check_eq(r.out, std::string("a b|$(echo injected)|;ls|"), "literal arguments");
}

TEST_CASE("process: deadline kills, output cap kills, cancel kills, missing binary fails to spawn") {
    io::ProcessSpec slow;
    slow.file = "sleep";
    slow.args = {"10"};
    slow.env = {{"PATH", "/usr/bin:/bin"}};
    slow.timeout = std::chrono::milliseconds(200);
    const auto t0 = std::chrono::steady_clock::now();
    auto r = io::run_process(slow);
    check(r.timed_out, "timed out");
    check(std::chrono::steady_clock::now() - t0 < std::chrono::seconds(3), "killed promptly");
    io::ProcessSpec loud;
    loud.file = "yes";
    loud.env = {{"PATH", "/usr/bin:/bin"}};
    loud.max_stdout = 1000;
    auto o = io::run_process(loud);
    check(o.output_overflow && o.out.size() <= 1000, "overflow stops at the cap");
    std::atomic<bool> cancel{true};
    auto c = io::run_process(slow, &cancel);
    check(c.cancelled, "cancelled");
    io::ProcessSpec missing;
    missing.file = "definitely-not-a-binary-tr";
    missing.env = {{"PATH", "/usr/bin:/bin"}};
    check(io::run_process(missing).spawn_failed, "spawn failed");
}

TEST_CASE("process: the child sees only the given environment") {
    io::ProcessSpec s;
    s.file = "env";
    s.env = {{"PATH", "/usr/bin:/bin"}, {"ONLY_THIS", "1"}};
    auto r = io::run_process(s);
    check(r.out.find("ONLY_THIS=1") != std::string::npos, "given var");
    check(r.out.find("HOME=") == std::string::npos, "parent env not inherited");
}
#endif

TEST_CASE("one-shot: provider detection, model roles, env stripping, cmd wrapper") {
    app::EnvList env = {{"PATH", "/usr/bin"}, {"ANTHROPIC_API_KEY", "x"}, {"OpenAI_Api_Key", "y"}, {"LICTOR_X", "z"},
                        {"CLAUDECODE", "1"}, {"HOME", "/h"}, {"LUDIARS_ONESHOT_MODEL_SONNET", "claude-sonnet-custom"}};
    auto l = app::prepare_one_shot("claude", {"-p", "--model", "opus", "--tools", ""}, env);
    check_eq(l.args[2], std::string("claude-opus-5-5"), "opus role");
    bool leaked = false;
    for (const auto& [k, v] : l.env) leaked = leaked || k == "ANTHROPIC_API_KEY" || k == "OpenAI_Api_Key" || k == "LICTOR_X" || k == "CLAUDECODE";
    check(!leaked, "API keys and parent session binding removed (case-insensitive)");
    auto def = app::prepare_one_shot("claude", {"-p"}, env);
    check(def.args.size() == 3 && def.args[0] == "--model" && def.args[1] == "claude-sonnet-custom", "default role with override");
    auto codex = app::prepare_one_shot("codex", {"exec", "--json", "-"}, env);
    check(codex.args[1] == "--model" && codex.args[2] == "gpt-6-sol", "codex default inserted after exec");
    auto wrapped = app::prepare_one_shot("cmd.exe", {"/c", "claude", "-p"}, env);
    check_eq(wrapped.file, std::string("claude"), "cmd wrapper unwrapped");
    trtest::check_throws([&] { app::prepare_one_shot("cmd", {"/c", "claude && evil", "-p"}, env); }, "shell text rejected");
    trtest::check_throws([&] { app::prepare_one_shot("claude", {"--version"}, env); }, "not print mode");
    trtest::check_throws([&] { app::prepare_one_shot("claude", {"-p", "--model", "gpt-6-sol"}, env); }, "claude needs claude model");
    trtest::check_throws([&] { app::prepare_one_shot("codex", {"exec", "--model", "claude-x"}, env); }, "codex needs gpt");
    trtest::check_throws([&] { app::prepare_one_shot("claude", {"-p", "--model", "bad model"}, env); }, "invalid id");
}

#ifndef _WIN32
TEST_CASE("gateway: interviewer CLI output is parsed fail-closed; failures map to error codes") {
    const auto dir = temp_dir("bin");
    write_script(dir / "claude",
                 "cat > /dev/null\n"
                 "if [ -n \"$ANTHROPIC_API_KEY\" ]; then echo leak; exit 3; fi\n"
                 "echo '[{\"type\":\"result\",\"subtype\":\"success\",\"is_error\":false,\"result\":\"  志望動機は?  \"}]'");
    write_script(dir / "codex", "cat > /dev/null\nexit 2");
    app::Config cfg;
    cfg.interviewer_model = "opus";
    app::LlmGateway gw(cfg, base_env_with_path(dir), nullptr);
    check_eq(gw.compose_interviewer("opus", "SYS", {{1, "user", "こんにちは"}}, nullptr), std::string("志望動機は?"),
             "parsed result; API key was not visible to the child");
    try {
        gw.compose_interviewer("sol", "SYS", {}, nullptr);
        check(false, "should fail");
    } catch (const app::LlmError& e) {
        check_eq(std::string(e.what()), std::string("interviewer_cli_failed:exit"), "exit code");
    }
    std::atomic<bool> cancel{true};
    trtest::check_throws([&] { gw.compose_interviewer("opus", "SYS", {}, &cancel); }, "cancelled before start");
}

TEST_CASE("gateway: run_claude returns trimmed stdout and hides stderr details on failure") {
    const auto dir = temp_dir("bin2");
    write_script(dir / "claude", "read x\necho \"  got: $x  \"\necho secret-detail >&2");
    app::Config cfg;
    app::LlmGateway gw(cfg, base_env_with_path(dir), nullptr);
    app::CliRunOptions o;
    o.model = "sonnet";
    check_eq(gw.run_claude("prompt\n", o), std::string("got: prompt"), "stdout");
    write_script(dir / "claude", "echo secret-detail >&2\nexit 9");
    try {
        gw.run_claude("p", o);
        check(false, "should fail");
    } catch (const app::LlmError& e) {
        check(std::string(e.what()).find("secret-detail") == std::string::npos, "stderr not in the error");
    }
}
#endif

TEST_CASE("brain: TIROCINIUM_BRAIN selects llm or stub; invalid value is rejected") {
    app::Config cfg;
    app::LlmGateway gw(cfg, {}, nullptr);
    auto stub = app::create_brain(gw, {{"TIROCINIUM_BRAIN", "STUB"}});
    check_eq(stub->kind(), std::string("stub"), "stub");
    auto s1 = stub->assess_answer("q", "a", {});
    auto s2 = stub->assess_answer("q", "a", {});
    auto s3 = stub->assess_answer("q", "a", {});
    check(!s1.synthesis_reached && !s2.synthesis_reached && s3.synthesis_reached, "every third answer reaches synthesis");
    check_eq(stub->compose_utterance("", {}, Json{{"question", "スロットの質問"}}, nullptr), std::string("スロットの質問"), "slot question");
    auto llm_brain = app::create_brain(gw, {});
    check(!llm_brain->can_assess() && !llm_brain->can_evaluate() && !llm_brain->can_refine(), "no keys → disabled roles");
    trtest::check_throws([&] { app::create_brain(gw, {{"TIROCINIUM_BRAIN", "gpt"}}); }, "invalid brain");
}

TEST_CASE("resolveModels: env role > profile > default") {
    auto m = app::resolve_models({{"TIROCINIUM_MODEL_PROFILE", "Economy"}, {"TIROCINIUM_MODEL_JUDGE", "claude-x"}});
    check_eq(m["EVALUATOR"], std::string("claude-sonnet-4-6"), "profile");
    check_eq(m["JUDGE"], std::string("claude-x"), "env role");
    check_eq(m["RESPONSE"], std::string("claude-sonnet-4-6"), "default");
}

TEST_MAIN()
