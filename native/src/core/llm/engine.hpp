#pragma once
// packages/llm の決定的コア (rng.ts / phase.ts / question-plan.ts / technical-topics.ts / role-aliases.ts)。
// 純関数のみ。LLM・DB・環境変数に触れない。乱択は注入した mulberry32 だけ (同じ seed → 同じプラン)。
// 質問候補・スロットは Json で持つ (brief の source_meta へそのまま保存・復元するため)。

#include <cstdint>
#include <functional>
#include <map>
#include <optional>
#include <string>
#include <vector>

#include "core/json.hpp"

namespace tr::llm {

// ---- rng.ts ----
class Mulberry32 {
public:
    explicit Mulberry32(std::uint32_t seed) : a_(seed) {}
    double next();  // [0,1)
    double operator()() { return next(); }

private:
    std::uint32_t a_;
};
using Rng = std::function<double()>;
Rng mulberry32(std::uint32_t seed);
std::uint32_t new_session_seed();
// Fisher-Yates (rng 注入)。入力は壊さない。
std::vector<Json> shuffled(const std::vector<Json>& items, const Rng& rng);

// JS の Math.round (0.5 は +∞ 方向)。
double js_round(double x);

// ---- phase.ts ----
enum class Phase { Opening, Probe, Pressure, Closing, Ended };
std::string phase_name(Phase p);
std::optional<Phase> phase_from_name(const std::string& s);

struct PhaseSpec {
    const char* intent;
    int min_turns;
    int max_turns;
};
const PhaseSpec& phase_spec(Phase p);  // Ended 以外

struct PhaseState {
    Phase phase = Phase::Opening;
    int phase_turn_no = 0;
    int turn_budget = 20;
    int persona_pressure = 3;
};
struct PhaseSignals {
    bool synthesis_reached = false;
    bool contradiction_open = true;
};
inline constexpr int kDefaultTurnBudget = 20;
PhaseState initial_phase_state(int persona_pressure, int turn_budget = kDefaultTurnBudget);
bool pressure_enabled(int persona_pressure);
PhaseState next_phase(const PhaseState& state, const PhaseSignals& signals = PhaseSignals{});

// ---- question-plan.ts ----
inline const std::vector<std::string>& axis_keys() {
    static const std::vector<std::string> k = {"consistency",        "clarity",    "demeanor",
                                               "self_understanding", "target_fit", "depth_resilience"};
    return k;
}
bool is_axis_key(const std::string& k);

struct PlanBrief {
    std::string stage;
    std::optional<std::string> role;
    std::optional<std::string> company_name;
    std::vector<Json> candidates;  // QuestionCandidate (phase 無し)
};
int plan_slot_count(Phase p);
std::vector<Json> compile_question_plan(const PlanBrief& brief, const std::vector<std::string>& weak_top3, const Rng& rng);
// plan の phase の未消化スロット (cursor[phase] 番目)。無ければ nullopt。
std::optional<Json> next_slot(const std::vector<Json>& plan, Phase phase, const std::map<std::string, int>& cursor);

// ---- role-aliases.ts ----
// 'general' | 'planner' | 'programmer' | 'designer' | 'sound'
std::string canonical_role(const std::optional<std::string>& input);
std::vector<std::string> expand_terms(const std::vector<std::string>& terms);
std::vector<std::string> split_keywords(const std::string& text);

// ---- technical-topics.ts ----
Json select_technical_topic(const std::string& role, const std::string& level, const std::vector<std::string>& seen,
                            const Rng& rng);

}  // namespace tr::llm
