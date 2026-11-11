#pragma once
// HTTP の要求 1 つに 1 つの Lorica 予算 (input_budget)。受け口がヘッダを読んだ時点で作り、
// ヘッダ・本文・本文の JSON の読み取り (復号後の文字列を含む) まで同じ予算から差し引く。
//
// 上限の根拠:
// - bytes: ヘッダ上限 + 本文上限 × 3 + 64 KiB。本文は「受信」「JSON の読み取り」「復号後の文字列」の
//   最大 3 回分を数える (JSON の文字列は復号で短くなることはあっても長くはならない)。64 KiB は余白。
// - elements: JSON の要素 200,000 (前回の read_json_body と同じ) + ヘッダのフィールド 1,024。
// - allocations: elements の 2 倍 + 16 (要素ごとに 1 回 + 受信・読み取りの分)。
// - depth: 64 (前回の read_json_body と同じ)。

#include <cstddef>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include <lorica/input_budget.hpp>

namespace tr::http {

struct RequestBudgetSpec {
    std::size_t header_limit = 16 * 1024;
    std::size_t body_limit = 2 * 1024 * 1024;
    std::size_t json_elements = 200'000;
    std::size_t max_depth = 64;
};

inline constexpr std::size_t kMaxHeaderFields = 1024;

// 桁あふれするなら nullopt (その要求は断る)。
std::optional<lorica::budget_limits> request_budget_limits(const RequestBudgetSpec& spec);

// ヘッダ (名前 + 値 + 区切り 4 バイト) を課金する。超えたら false (431)。
bool charge_headers(lorica::input_budget& budget, const std::vector<std::pair<std::string, std::string>>& fields);

// 本文を課金する。超えたら false (413)。
bool charge_body(lorica::input_budget& budget, std::string_view body);

}  // namespace tr::http
