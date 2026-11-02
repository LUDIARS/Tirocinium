#pragma once
// ES → おすすめ企業 (recommend/service.ts, recommend/repo.ts, routes/recommend.ts)。
// ES 本文は要求の es_text か Memoria RAG の抜粋だけを使い、DB には保存しない (導出結果だけを保存)。
// LLM の rerank は Node 版と同じく llm_backend=api かつ ANTHROPIC_API_KEY があるときだけ。
// C++ 版は API を直接呼ばず claude -p (RECOMMENDER のモデル、ツール無し) で行う。失敗は heuristic に戻す。

#include <optional>
#include <string>
#include <vector>

#include "app/services.hpp"
#include "core/domain/recommend.hpp"

namespace tr::app {

struct RecommendRequest {
    std::string user_id;
    std::optional<std::string> target_role;
    std::optional<std::string> target_company;
    std::vector<std::string> tags;
    std::optional<std::string> es_text;
    std::optional<double> top_k;
};

struct RecommendOutcome {
    Json result;  // {method, model, items}
    Json query;   // {target_role?, target_company?, tags, weak_axes}
    bool has_es_material = false;
};

// Array.prototype.slice(0, end) の件数 (end が負なら末尾から数える)。
std::size_t js_slice_count(std::size_t length, double end);

RecommendOutcome run_recommend(Services& s, const RecommendRequest& req);
Json save_recommendation(db::Database& db, const std::string& user_id, const Json& query, const Json& result);
db::Rows list_recommendations(db::Database& db, const std::string& user_id, long long limit);

void register_recommend_routes(http::Router& r, Services& s);

}  // namespace tr::app
