#pragma once
// packages/training/memoria-client.ts の移植 (Memoria の RAG / 教師データ投入。MEMORIA_URL が無ければ使わない)。

#include <optional>
#include <string>
#include <vector>

#include "app/services.hpp"

namespace tr::app {

std::optional<std::string> memoria_base_url(const Services& s);
// POST /api/v1/tirocinium/rag/search。失敗は例外 (呼び出し側が縮退する)。
Json memoria_rag(const Services& s, const std::string& user_id, const std::string& query,
                 const std::vector<std::string>& kinds, const std::optional<std::vector<std::string>>& tags, int top_k);
// renderRagBlock: "1. (kind) excerpt" の行。
std::string render_rag_block(const Json& result);

}  // namespace tr::app
