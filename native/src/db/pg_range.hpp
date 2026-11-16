#pragma once
// Postgres の int4range のテキスト形式 ("[a,b)" など) を閉区間 [lo, hi] に直す (純関数)。

#include <optional>
#include <string_view>
#include <utility>

namespace tr::db {

// 先頭 1 文字 (境界の括弧) を読み飛ばして "<int>,<int>" を読み、末尾が ')' なら上端を 1 引く。
// 2 つ目の整数より後ろは見ない (従来の sscanf("%*c%d,%d") と同じ)。
// "empty"・上下端の欠けた範囲・int の範囲外・上端を引いて溢れる値は nullopt。
std::optional<std::pair<int, int>> parse_int4range_closed(std::string_view text);

}  // namespace tr::db
