#pragma once
// packages/llm の文面と組み立て (prompts.ts / response.ts の buildSystemPrompt / brain.ts の renderSlotBlock /
// specialist-*.ts / persona/prompt.ts)。文言は Node 版と 1 文字も変えない (golden で確かめる)。

#include <optional>
#include <string>
#include <vector>

#include "core/json.hpp"
#include "core/llm/engine.hpp"

namespace tr::llm {

extern const char* const kDialecticProbe;
extern const char* const kEvalInstruction;
extern const char* const kSummaryInstruction;
extern const char* const kJudgeInstruction;
extern const char* const kRefineInstruction;
extern const char* const kReverseQuestionRule;
std::string phase_guidance(Phase p);

struct InterviewerPersona {
    std::string display_name;
    std::string stage;  // hr | peer-tech | lead-tech | final
    std::string role_lens = "any";
    std::string temperament;
    int pressure = 3;
    std::vector<std::string> tics;
    std::string bio;
    Json evaluation_bias = Json::object();
};

struct SpecialistProfile {
    std::string role;         // planner | programmer | designer | sound
    std::string level;        // entry | experienced
    std::string interviewer;  // field | senior
};

// ---- specialist-profile.ts ----
// undefined → nullopt、不正な明示値は例外 (invalid_specialist_interview)。
std::optional<SpecialistProfile> parse_specialist_profile(const Json* value);
std::optional<SpecialistProfile> specialist_from_metadata(const Json& metadata);
InterviewerPersona specialist_persona(const SpecialistProfile& p);
Json specialist_to_json(const SpecialistProfile& p);

// ---- specialist-focus.ts ----
struct FocusPoints {
    std::vector<std::string> senior;
    std::vector<std::string> field;
};
struct NewgradFocus {
    std::string summary;
    std::vector<std::string> themes;
};
FocusPoints fallback_focus_points(const SpecialistProfile& p, const std::optional<NewgradFocus>& newgrad);
std::string focus_points_prompt(const SpecialistProfile& p, const std::optional<NewgradFocus>& newgrad,
                                const std::string& materials);
std::optional<FocusPoints> parse_focus_points(const std::string& text);
std::string render_focus_block(const FocusPoints& points, const SpecialistProfile& p);

// ---- specialist-prompts.ts ----
std::string specialist_question_prompt(const std::optional<SpecialistProfile>& p);
std::string specialist_evaluation_prompt(const std::optional<SpecialistProfile>& p, bool summary = false);

// ---- response.ts ----
std::string build_interviewer_prompt_block(const InterviewerPersona& p);
std::string build_weakness_block(const std::vector<std::string>& weak_top3);
struct SystemPromptInput {
    InterviewerPersona interviewer;
    std::optional<SpecialistProfile> specialist;
    std::vector<std::string> weak_top3;
    std::string rag_block;
    std::string refine_block;
    std::optional<Phase> phase;
    std::string brief_md;
    std::string focus_block;
};
std::string build_system_prompt(const SystemPromptInput& in);

// ---- brain.ts ----
std::string render_slot_block(const Json& slot);

// ---- persona/prompt.ts (サーバ側) ----
std::string interviewer_to_system_prompt(const Json& persona_row);
std::string examinee_to_system_prompt(const Json& persona_row);

}  // namespace tr::llm
