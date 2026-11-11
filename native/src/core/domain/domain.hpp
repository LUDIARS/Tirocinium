#pragma once
// apps/server の副作用のない業務判断 (DB・HTTP・環境変数に触れない)。
// - feedback/weakness-math.ts      : 弱点プロファイルの EMA
// - reservation/slot.ts, tick-rules : 予約スロットの境界と、予約ごとの次の行動
// - brief/sufficiency-gate.ts ほか   : 面接ブリーフの材料判定と候補の導出
// - materials/material-policy.ts ほか: 提出資料の受付判定と要点の検査
// - discord/commands.ts ほか        : Discord コマンドの解釈・本文の分割
// - companies (normalize/sources)   : 社名の正規化・クロールソース名

#include <cstdint>
#include <optional>
#include <string>
#include <variant>
#include <vector>

#include "core/json.hpp"
#include "core/time.hpp"

namespace tr::domain {

// ---- weakness-math.ts ----
inline constexpr double kEmaAlpha = 0.3;
Json initial_weakness_snapshot();
// cur / 返り値は {axes_ema, axes_variance, weak_top3, hint_history, session_count}
Json apply_evaluation_to_profile(const Json& cur, const Json& eval_axes, const std::vector<std::string>& eval_hints);

// ---- slot.ts / tick-rules.ts ----
// slot.ts は SLOT_DURATION_MIN を env から直接読む (config とは別)。呼び出し側が渡す。
EpochMs current_slot_start(EpochMs now, int slot_duration_min);
EpochMs next_slot_start(EpochMs after, int slot_duration_min);
struct ReservationRow {
    std::string id;
    std::string user_id;
    EpochMs slot_start = 0;
    std::string status;
    bool notify_sent = false;
};
struct TickAction {
    std::string kind;  // notify_lead | mark_no_show | ready_to_start
    int lead_min = 0;
};
std::vector<TickAction> decide_actions_for(const ReservationRow& r, EpochMs now, int no_show_timeout_min,
                                           int notify_lead_min, int slot_duration_min);

// ---- brief ----
Json assess_sufficiency(bool company_resolved, bool has_newgrad_image, int company_question_count, int ob_pattern_count);
std::vector<Json> newgrad_theme_candidates(const std::vector<std::string>& themes);
// company-question-candidates.ts: {candidates, profileSnapshot}
Json company_question_candidates(const std::optional<std::string>& company_name, const Json* profile, const Json& ai);
std::vector<std::string> profile_source_urls(const Json* profile);
// brief-builder.ts planBriefFromSourceMeta: {stage, role, companyName, candidates} か null。
std::optional<Json> plan_brief_from_source_meta(const Json& source_meta);

// ---- materials ----
struct MaterialUpload {
    std::string kind;  // es | portfolio
    std::string mime;
    std::string extension;
    std::string bytes;
};
inline constexpr std::size_t kMaxMaterialBytes = 5 * 1024 * 1024;
// 成功なら MaterialUpload、失敗なら理由の文字列 (invalid_material_request 等)。
std::variant<MaterialUpload, std::string> parse_material_upload(const Json* raw);
inline constexpr std::size_t kMaxDigestChars = 6000;
std::optional<std::string> normalize_digest(const std::string& output);
std::string build_reader_prompt(const std::string& reader_skill, const std::string& kind, const std::string& file_name);
std::string render_material_brief(const std::string& interviewer_skill, const std::string& digest);
std::string strip_frontmatter(const std::string& text);
std::string material_interview_speaker(const std::optional<std::string>& env_value);

// ---- discord ----
struct DiscordCommand {
    std::string kind;  // start | end | help | none
    std::string mode;  // text | voice
    std::string target;
};
DiscordCommand parse_discord_command(const std::string& content, const std::string& prefix);
std::string render_discord_help(const std::string& prefix);
// 1900 UTF-16 単位ごとに分ける。Node 版と違い、サロゲート対は割らない (割ると Discord で文字化けする)。
std::vector<std::string> chunk_content(const std::string& content);

// ---- companies ----
std::string normalize_name(const std::string& name);
const std::vector<std::string>& list_source_ids();

}  // namespace tr::domain
