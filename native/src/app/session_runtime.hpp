#pragma once
// 面接セッションのランタイム (ws/session-runtime.ts の移植。1 接続 = 1 セッション)。
// 進行 (フェーズ機・質問プラン・turn 予算) は決定的コア、発話・判定・評価は InterviewerBrain 越し。
// on_message は複数スレッドから同時に呼ばれてよい (Node の `void runtime.onMessage(...)` と同じく、
// 生成中でも barge_in を受ける)。状態は mutex で守り、DB・LLM・TTS の間は持たない。

#include <atomic>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <vector>

#include "app/brief.hpp"
#include "app/llm.hpp"
#include "app/services.hpp"
#include "app/voice.hpp"
#include "core/llm/engine.hpp"
#include "core/llm/output.hpp"
#include "core/llm/prompts.hpp"

namespace tr::app {

// サーバ → クライアントのフレームの送り先 (WS か、Discord の擬似ソケット)。
class FrameSink {
public:
    virtual ~FrameSink() = default;
    virtual void send(const std::string& json) = 0;
    virtual void close() = 0;
    [[nodiscard]] virtual bool is_open() const = 0;
};

struct PhaseProgress {
    llm::Phase phase;
    int phase_turn_no;
    int turn_budget;
    std::map<std::string, int> plan_cursor;
};
// metadata.phase_progress を型検証しつつ読む。壊れていれば nullopt (縮退)。
std::optional<PhaseProgress> as_phase_progress(const Json* v);
struct SeedResolution {
    std::uint32_t seed;
    bool is_new;
};
// metadata.session_seed: null/undefined と数値化できない値だけを欠損とする (0 は有効)。
SeedResolution resolve_session_seed(const Json* raw);

struct RuntimeDeps {
    Services* services = nullptr;
    std::shared_ptr<InterviewerBrain> brain;
    bool tts_over_ws = true;
    const VoiceConfig* voice = nullptr;
    AiResearchFn research;
};

class SessionRuntime : public std::enable_shared_from_this<SessionRuntime> {
public:
    SessionRuntime(std::shared_ptr<FrameSink> sink, std::string session_id, std::string user_id, RuntimeDeps deps);
    // DB から状態を読み、session_ready を送る (失敗は例外)。
    void init();
    // 1 フレームを処理する (生成・評価は呼び出し元のスレッドか背景で動く)。
    void on_message(const std::string& raw);
    void close();
    [[nodiscard]] bool closed() const { return closed_.load(); }

private:
    struct Generated {
        int turn_no;
        std::string text;
    };
    void send(const Json& frame);
    void handle_user_turn(const std::string& text);
    void handle_start_interview();
    std::optional<Generated> generate_interviewer_turn();
    void advance_interviewer_phase(int interviewer_turn_no);
    void persist_phase_progress();
    void run_refine_background();
    void insert_deviation_slot(const std::string& focus);
    void run_evaluation_background(int up_to);
    void run_tts_background(int turn_no, std::string text);
    void handle_end();
    void persist_turn(int turn_no, const std::string& role, const std::string& text);
    void compile_plan(const Json& metadata, const std::optional<std::string>& company, const std::optional<std::string>& role);
    void prepare_specialist_focus(std::optional<std::string> target_company, std::string materials);

    std::shared_ptr<FrameSink> sink_;
    std::string session_id_;
    std::string user_id_;
    RuntimeDeps deps_;
    Services& s_;

    std::mutex mu_;
    std::vector<llm::Turn> turns_;
    int current_turn_no_ = 0;
    std::shared_ptr<std::atomic<bool>> current_abort_;
    std::shared_ptr<std::atomic<bool>> tts_abort_;
    std::optional<llm::InterviewerPersona> interviewer_;
    std::optional<llm::SpecialistProfile> specialist_;
    std::vector<std::string> weak_top3_;
    std::string rag_block_;
    std::string material_block_;
    std::optional<std::string> tts_voice_;
    std::string refine_block_;
    std::optional<llm::PhaseState> phase_state_;
    llm::PhaseSignals latest_signals_;
    std::atomic<bool> closed_{false};
    bool plan_enabled_ = true;
    std::optional<std::vector<Json>> plan_;
    std::map<std::string, int> plan_cursor_;
    std::string brief_md_;
    std::string focus_block_;
};

}  // namespace tr::app
