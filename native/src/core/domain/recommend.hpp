#pragma once
// ES → おすすめ企業 (packages/companies/src/{score,recommend}.ts と normalize.ts の normalizeRoles)。純関数。
// LLM の rerank 本体 (CLI の起動) は app 側。ここは候補の絞り込み・プロンプト・出力の検証だけ。

#include <optional>
#include <set>
#include <string>
#include <vector>

#include "core/json.hpp"

namespace tr::domain {

struct ApplicantProfile {
    std::string es_text;
    std::optional<std::string> target_role;
    std::optional<std::string> target_company;
    std::vector<std::string> tags;
    std::vector<std::string> weak_axes;
};

struct ScoreBreakdown {
    int score = 0;
    bool role_match = false;
    std::vector<std::string> tag_overlap;
    std::vector<std::string> keyword_hits;
};

extern const char* const kRecommendInstruction;

std::vector<std::string> normalize_roles(const std::vector<std::string>& roles);
std::vector<std::string> tokenize_keywords(const std::string& text);  // Set の挿入順
ScoreBreakdown score_company(const ApplicantProfile& p, const Json& company);
struct Candidate {
    Json company;
    ScoreBreakdown breakdown;
};
std::vector<Candidate> rank_candidates(const ApplicantProfile& p, const std::vector<Json>& companies, std::size_t limit);
// {method:'heuristic', model:'none', items}
Json recommend_heuristic(const ApplicantProfile& p, const std::vector<Json>& companies, std::size_t top_k);
std::string render_candidates(const std::vector<Candidate>& candidates);
std::string render_profile(const ApplicantProfile& p);
// LLM 出力 → items (候補に無い id は捨てる、score 降順)。壊れていれば例外。
std::vector<Json> parse_recommendation(const std::string& text, const std::set<std::string>& valid_ids);

}  // namespace tr::domain
