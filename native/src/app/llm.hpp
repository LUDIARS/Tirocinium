#pragma once
// LLM 呼び出しの唯一の出口 (packages/llm の cli.ts / interviewer-cli.ts / anthropic.ts / openai.ts / brain.ts)。
// - C++ 版は Anthropic の API キーを使わない。judge・評価・サマリ・推薦・要点・資料読解は claude -p を
//   one-shot の規則で起動する。機能の有効/無効は Node 版と同じく ANTHROPIC_API_KEY の有無で決める
//   (キーは子に渡さない。subscription_environment が外す)。
// - 面接官の発話は Node 版と同じく codex exec (sol) / claude -p (opus) をツール無しで起動する。
// - refine は OpenAI の chat.completions を HTTPS で 1 回呼ぶ (キーは既存の秘密の経路)。
// - 同時に起動する CLI の数に上限を置き、空きを 30 秒待っても無ければ llm_busy で拒否する。

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <filesystem>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <vector>

#include "app/config.hpp"
#include "app/one_shot.hpp"
#include "app/secrets.hpp"
#include "core/llm/output.hpp"
#include "core/llm/prompts.hpp"
#include "io/process.hpp"

namespace tr::app {

class LlmError : public std::runtime_error {
public:
    using std::runtime_error::runtime_error;
};

// resolveModels: TIROCINIUM_MODEL_<ROLE> > TIROCINIUM_MODEL_PROFILE > 既定。
std::map<std::string, std::string> resolve_models(const EnvList& env);

struct CliRunOptions {
    std::optional<std::string> model;  // 役割名 (sonnet 等) か明示 ID
    std::filesystem::path cwd;
    std::vector<std::string> extra_args;
    std::chrono::milliseconds timeout{180'000};
    std::size_t max_output = 1024 * 1024;
    const std::atomic<bool>* cancel = nullptr;
};

// 子プロセスの起動を差し替えるための関数 (テストでは偽の CLI を使う)。
using ProcessRunner = std::function<io::ProcessResult(const io::ProcessSpec&, const std::atomic<bool>*)>;

class LlmGateway {
public:
    LlmGateway(const Config& config, EnvList base_env, HttpFetch fetch, ProcessRunner runner = nullptr,
               std::size_t max_concurrent = 4);

    // runClaudeCliWith: 標準入力にプロンプト、成功 (exit 0) なら stdout を trim して返す。失敗は LlmError。
    std::string run_claude(const std::string& prompt, const CliRunOptions& options);
    // composeInterviewerCli: 'sol' (codex) / 'opus' (claude)。出力は parse_interviewer_output で検証。
    std::string compose_interviewer(const std::string& model, const std::string& system_prompt,
                                    const std::vector<llm::Turn>& turns, const std::atomic<bool>* cancel);
    // refine (OpenAI chat.completions)。キーが無ければ LlmError。
    std::string openai_refine(const std::vector<llm::Turn>& turns);

    [[nodiscard]] bool anthropic_enabled() const { return !config_.anthropic_api_key.empty(); }
    [[nodiscard]] bool openai_enabled() const { return !config_.openai_api_key.empty(); }
    [[nodiscard]] const std::map<std::string, std::string>& models() const { return models_; }
    [[nodiscard]] const Config& config() const { return config_; }
    [[nodiscard]] const EnvList& env() const { return base_env_; }

private:
    io::ProcessResult launch(const std::string& file, std::vector<std::string> args, const std::string& stdin_data,
                             const std::filesystem::path& cwd, std::chrono::milliseconds timeout, std::size_t max_out,
                             const std::atomic<bool>* cancel);

    const Config& config_;
    EnvList base_env_;
    HttpFetch fetch_;
    ProcessRunner runner_;
    std::map<std::string, std::string> models_;
    std::mutex mu_;
    std::condition_variable cv_;
    std::size_t running_ = 0;
    std::size_t max_concurrent_;
};

// ---- InterviewerBrain (brain.ts) ----

struct EvaluationResult {
    Json turn_range;  // [a, b]
    Json axes;
    std::string comment;
    std::vector<std::string> hints;
    std::string model;
    [[nodiscard]] Json to_json() const;
};

class InterviewerBrain {
public:
    virtual ~InterviewerBrain() = default;
    [[nodiscard]] virtual std::string kind() const = 0;  // llm | stub
    // スロット込みの system prompt で 1 発話を作る (cancel で中断)。
    virtual std::string compose_utterance(const std::string& system_prompt, const std::vector<llm::Turn>& turns,
                                          const std::optional<Json>& slot, const std::atomic<bool>* cancel) = 0;
    virtual llm::AnswerSignals assess_answer(const std::string& question, const std::string& answer,
                                             const std::vector<llm::Turn>& recent) = 0;
    virtual std::optional<std::string> refine_focus(const std::vector<llm::Turn>& turns) = 0;
    virtual EvaluationResult evaluate(const std::optional<llm::SpecialistProfile>& specialist,
                                      const std::vector<llm::Turn>& turns, int from, int to) = 0;
    virtual std::optional<llm::FocusPoints> list_focus_points(const llm::SpecialistProfile& profile,
                                                              const std::optional<llm::NewgradFocus>& newgrad,
                                                              const std::string& materials) = 0;
    [[nodiscard]] virtual bool can_compose() const = 0;
    [[nodiscard]] virtual bool can_assess() const = 0;
    [[nodiscard]] virtual bool can_refine() const = 0;
    [[nodiscard]] virtual bool can_evaluate() const = 0;
};

// TIROCINIUM_BRAIN=llm|stub (既定 llm)。不正値は例外 (無言の縮退をしない)。
std::unique_ptr<InterviewerBrain> create_brain(LlmGateway& gateway, const EnvList& env);

// summarizer.ts / evaluator.ts の 1 回呼び出し (CLI)。
Json summarize_with_cli(LlmGateway& gateway, const std::optional<llm::SpecialistProfile>& specialist,
                        const std::vector<llm::Turn>& turns, const std::vector<Json>& evaluations);

}  // namespace tr::app
