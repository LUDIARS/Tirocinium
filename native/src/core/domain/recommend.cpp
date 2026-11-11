#include "core/domain/recommend.hpp"

#include <algorithm>
#include <cmath>
#include <map>

#include "core/llm/engine.hpp"
#include "core/llm/output.hpp"
#include "core/text.hpp"

namespace tr::domain {

const char* const kRecommendInstruction = R"PROMPT(あなたは就活アドバイザーです。 受験者の ES 要約と、 候補企業リストを渡します。
受験者に合うおすすめ企業を上位から並べ、 JSON で返してください。

出力は **JSON オブジェクト 1 個のみ**。前置き・コードフェンス以外の説明は禁止。
スキーマ:
{
  "items": [
    {
      "company_id": "渡された候補の id をそのまま",
      "score": 0-100 の適合度 (整数),
      "reasons": ["なぜ合うか (2-3 個、各 1 文)"],
      "concerns": ["ミスマッチ・確認すべき点 (0-2 個)"]
    }
  ]
}

ルール:
- **候補リストに無い企業は出さない** (company_id は必ず候補のもの)。
- reasons は ES の内容と企業の特徴を結びつけて述べる。 ES 本文を逐語コピーしない。
- 合わない候補は items から外してよい。 無理に全件返さない。
- score 降順で並べる。)PROMPT";

std::vector<std::string> normalize_roles(const std::vector<std::string>& roles) {
    static const std::vector<std::string> lenses = {"planner", "programmer", "designer", "sound", "any"};
    static const std::map<std::string, std::string> aliases = {
        {"planner", "planner"},     {"プランナー", "planner"},   {"企画", "planner"},       {"pm", "planner"},
        {"ディレクター", "planner"}, {"programmer", "programmer"}, {"engineer", "programmer"}, {"developer", "programmer"},
        {"プログラマ", "programmer"}, {"プログラマー", "programmer"}, {"エンジニア", "programmer"}, {"designer", "designer"},
        {"デザイナー", "designer"},   {"デザイン", "designer"},     {"ui", "designer"},        {"ux", "designer"},
        {"sound", "sound"},         {"サウンド", "sound"},         {"作曲", "sound"},         {"コンポーザー", "sound"}};
    std::vector<std::string> out;
    auto add = [&](const std::string& r) {
        if (std::find(out.begin(), out.end(), r) == out.end()) out.push_back(r);
    };
    for (const auto& raw : roles) {
        const std::string key = js_to_lower(js_trim(raw));
        if (key.empty()) continue;
        if (std::find(lenses.begin(), lenses.end(), key) != lenses.end() && key != "any") {
            add(key);
            continue;
        }
        if (auto it = aliases.find(key); it != aliases.end()) add(it->second);
    }
    return out;
}

std::vector<std::string> tokenize_keywords(const std::string& text) {
    // text.toLowerCase().split(/[\s,、。・/\\|()（）「」【】:：;；]+/) → trim → length >= 2 (Set の挿入順)
    static const std::u32string seps = U",、。・/\\|()（）「」【】:：;；";
    std::vector<std::string> out;
    std::vector<char32_t> cur;
    auto flush = [&] {
        std::string t = js_trim(encode_utf8(cur));
        cur.clear();
        if (utf16_length(t) >= 2 && std::find(out.begin(), out.end(), t) == out.end()) out.push_back(t);
    };
    for (char32_t cp : decode_utf8(js_to_lower(text))) {
        if (is_js_space(cp) || seps.find(cp) != std::u32string::npos) flush();
        else cur.push_back(cp);
    }
    flush();
    return out;
}

namespace {

std::vector<std::string> str_array(const Json& c, const char* k) {
    std::vector<std::string> out;
    if (const Json* v = member(c, k); v && v->is_array()) {
        for (const auto& x : *v) {
            if (x.is_string()) out.push_back(x);
        }
    }
    return out;
}

}  // namespace

ScoreBreakdown score_company(const ApplicantProfile& p, const Json& company) {
    std::vector<std::string> kw = tokenize_keywords(p.es_text);
    auto add_kw = [&](const std::string& t) {
        if (std::find(kw.begin(), kw.end(), t) == kw.end()) kw.push_back(t);
    };
    for (const auto& t : p.tags) add_kw(js_to_lower(t));
    if (p.target_company && !p.target_company->empty()) add_kw(js_to_lower(*p.target_company));
    std::vector<std::string> tag_lower;
    for (const auto& t : p.tags) tag_lower.push_back(js_to_lower(t));
    const auto target_roles = normalize_roles(p.target_role && !p.target_role->empty() ? std::vector<std::string>{*p.target_role}
                                                                                       : std::vector<std::string>{});
    const auto roles = str_array(company, "roles");
    const auto tags = str_array(company, "tags");
    ScoreBreakdown b;
    for (const auto& r : roles) {
        if (std::find(target_roles.begin(), target_roles.end(), r) != target_roles.end()) b.role_match = true;
    }
    for (const auto& t : tags) {
        if (std::find(tag_lower.begin(), tag_lower.end(), js_to_lower(t)) != tag_lower.end()) b.tag_overlap.push_back(t);
    }
    const auto haystack = tokenize_keywords(string_or(company, "description") + " " + join(tags, " ") + " " +
                                            string_or(company, "industry"));
    for (const auto& k : kw) {
        if (b.keyword_hits.size() >= 8) break;
        if (std::find(haystack.begin(), haystack.end(), k) != haystack.end()) b.keyword_hits.push_back(k);
    }
    const bool name_match = p.target_company && !p.target_company->empty() &&
                            js_to_lower(string_or(company, "name")).find(js_to_lower(*p.target_company)) != std::string::npos;
    int score = 0;
    if (b.role_match) score += 35;
    score += std::min(static_cast<int>(b.tag_overlap.size()) * 12, 36);
    score += std::min(static_cast<int>(b.keyword_hits.size()) * 6, 24);
    if (name_match) score += 5;
    b.score = std::min(100, score);
    return b;
}

std::vector<Candidate> rank_candidates(const ApplicantProfile& p, const std::vector<Json>& companies, std::size_t limit) {
    std::vector<Candidate> out;
    for (const auto& c : companies) {
        auto b = score_company(p, c);
        if (b.score > 0) out.push_back({c, b});
    }
    std::stable_sort(out.begin(), out.end(), [](const Candidate& a, const Candidate& b) { return a.breakdown.score > b.breakdown.score; });
    if (out.size() > limit) out.resize(limit);
    return out;
}

Json recommend_heuristic(const ApplicantProfile& p, const std::vector<Json>& companies, std::size_t top_k) {
    Json items = Json::array();
    for (const auto& c : rank_candidates(p, companies, top_k)) {
        Json reasons = Json::array();
        if (c.breakdown.role_match) reasons.push_back("志望職種の募集と一致");
        if (!c.breakdown.tag_overlap.empty()) reasons.push_back("共通キーワード: " + join(c.breakdown.tag_overlap, ", "));
        if (!c.breakdown.keyword_hits.empty()) {
            std::vector<std::string> top(c.breakdown.keyword_hits.begin(),
                                         c.breakdown.keyword_hits.begin() + std::min<std::size_t>(4, c.breakdown.keyword_hits.size()));
            reasons.push_back("ES と関連: " + join(top, ", "));
        }
        if (reasons.empty()) reasons.push_back("プロフィールと部分的に一致");
        items.push_back(Json{{"company_id", c.company.value("id", Json(""))},
                             {"name", c.company.value("name", Json(""))},
                             {"score", c.breakdown.score},
                             {"reasons", reasons},
                             {"concerns", c.breakdown.role_match ? Json::array() : Json::array({"志望職種の募集有無を要確認"})}});
    }
    return Json{{"method", "heuristic"}, {"model", "none"}, {"items", items}};
}

std::string render_candidates(const std::vector<Candidate>& candidates) {
    std::vector<std::string> lines;
    for (const auto& cand : candidates) {
        const Json& c = cand.company;
        std::vector<std::string> parts = {"id: " + string_or(c, "id"), "名前: " + string_or(c, "name")};
        if (!string_or(c, "industry").empty()) parts.push_back("業界: " + string_or(c, "industry"));
        if (auto r = str_array(c, "roles"); !r.empty()) parts.push_back("募集職種: " + join(r, ", "));
        if (auto t = str_array(c, "tags"); !t.empty()) parts.push_back("タグ: " + join(t, ", "));
        if (!string_or(c, "location").empty()) parts.push_back("所在地: " + string_or(c, "location"));
        if (!string_or(c, "size").empty()) parts.push_back("規模: " + string_or(c, "size"));
        if (!string_or(c, "description").empty()) parts.push_back("概要: " + string_or(c, "description"));
        lines.push_back("- " + join(parts, " / "));
    }
    return join(lines, "\n");
}

std::string render_profile(const ApplicantProfile& p) {
    std::vector<std::string> lines = {"## 受験者プロファイル"};
    if (p.target_role && !p.target_role->empty()) lines.push_back("志望職種: " + *p.target_role);
    if (p.target_company && !p.target_company->empty()) lines.push_back("志望企業/業界: " + *p.target_company);
    if (!p.tags.empty()) lines.push_back("興味タグ: " + join(p.tags, ", "));
    if (!p.weak_axes.empty()) lines.push_back("鍛えたい弱点軸: " + join(p.weak_axes, ", "));
    lines.push_back("");
    lines.push_back("## ES / ポートフォリオ要約");
    lines.push_back(utf16_slice(p.es_text, 0, 4000));
    return join(lines, "\n");
}

std::vector<Json> parse_recommendation(const std::string& text, const std::set<std::string>& valid_ids) {
    auto obj = parse_json(llm::extract_json_block(text));
    if (!obj) throw std::runtime_error("invalid JSON in recommendation");
    if (obj->is_null()) throw std::runtime_error("Cannot read properties of null (reading 'items')");  // JS と同じく失敗
    std::vector<Json> out;
    const Json* items = obj->is_object() ? member(*obj, "items") : nullptr;
    if (!items || !items->is_array()) return out;
    auto strs = [](const Json* v, std::size_t max) {
        Json a = Json::array();
        if (v && v->is_array()) {
            for (const auto& x : *v) {
                if (x.is_string() && !js_trim(x.get<std::string>()).empty() && a.size() < max) a.push_back(x);
            }
        }
        return a;
    };
    for (const auto& r : *items) {
        if (r.is_null()) throw std::runtime_error("Cannot read properties of null (reading 'company_id')");
        const std::string id = r.is_object() ? string_or(r, "company_id") : "";
        if (!valid_ids.count(id)) continue;  // 幻覚 id を弾く
        const double score = r.is_object() && r.contains("score") ? llm::js_to_number(r["score"]) : std::nan("");
        out.push_back(Json{{"company_id", id},
                           {"name", ""},
                           {"score", std::isfinite(score) ? static_cast<int>(std::max(0.0, std::min(100.0, llm::js_round(score)))) : 0},
                           {"reasons", strs(member(r, "reasons"), 4)},
                           {"concerns", strs(member(r, "concerns"), 3)}});
    }
    std::stable_sort(out.begin(), out.end(), [](const Json& a, const Json& b) { return a["score"].get<int>() > b["score"].get<int>(); });
    return out;
}

}  // namespace tr::domain
