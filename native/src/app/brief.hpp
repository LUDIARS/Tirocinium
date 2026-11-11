#pragma once
// 面接ブリーフのコンパイル (brief/brief-builder.ts, sources.ts, qa-seed-loader.ts)。
// 個人データ境界: Memoria RAG 抜粋 (受験者本人の ES 等) は本文・source_meta に焼き込まない。
// 企業サイトの AI 調査 (interview-research.ts) は HTML の解析を伴うため C++ では行わず、
// ai_research を注入された関数に委ねる (Node の企業 worker があればそれ、無ければ「確認できない」)。

#include <filesystem>
#include <functional>
#include <optional>
#include <string>
#include <vector>

#include "core/json.hpp"
#include "core/llm/engine.hpp"
#include "db/database.hpp"

namespace tr::app {

inline constexpr const char* kRagSectionTitle = "受験者の素材";

struct CompanyRef {
    std::string id;
    std::string name;
    std::string url;
};
std::optional<CompanyRef> resolve_company(db::Database& db, const std::optional<std::string>& target_company);
std::vector<std::string> recent_technical_topics(db::Database& db, const std::string& user_id);
struct NewgradImage {
    std::string role;
    std::string summary;
    std::vector<std::string> themes;
};
std::optional<NewgradImage> get_newgrad_image(db::Database& db, const std::string& company_id, const std::string& role);
std::vector<Json> get_company_questions(db::Database& db, const std::string& company_id, const std::string& stage,
                                        const std::string& role);
std::vector<Json> get_ob_patterns(db::Database& db, const std::string& company_id, const std::string& stage,
                                  const std::string& role);

struct QaSeed {
    std::vector<Json> items;
    std::optional<std::string> fallback_role;
};
// data/general/qa-seed/<stage>/<role>.json。無ければ同 stage の先頭 (名前順) へ明示的に退避。
// stage のフォルダが無ければ空。それ以外の I/O 失敗は例外。
QaSeed load_qa_seed(const std::filesystem::path& qa_seed_dir, const std::string& stage, const std::string& role);

struct BriefBuildInput {
    std::optional<std::string> user_id;
    std::string experience_level = "entry";
    std::string stage;
    std::optional<std::string> target_company;
    std::optional<std::string> target_role;
    std::string persona_block;
    std::vector<std::string> weak_top3;
    std::uint32_t seed = 0;
};
struct BuiltBrief {
    std::string body_md;
    Json source_meta;
    llm::PlanBrief plan_brief;
    std::string sufficiency_level;
};
// company_url と profile の参照 URL を受けて AiResearch (JSON) を返す。
using AiResearchFn = std::function<Json(const std::string& company_url, const std::vector<std::string>& profile_urls)>;
Json unavailable_ai_research(const std::string& now_iso);

BuiltBrief build_interview_brief(db::Database& db, const std::filesystem::path& root, const BriefBuildInput& input,
                                 const AiResearchFn& research, const std::function<std::string()>& now_iso);

std::optional<llm::PlanBrief> plan_brief_from_meta(const Json& source_meta);

}  // namespace tr::app
