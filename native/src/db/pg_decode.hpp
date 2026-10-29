#pragma once
// Postgres のテキスト形式の値を、postgres.js の既定の parse と同じ JSON に変える (純関数)。
// 値はすべて外部入力として Lorica の予算に課金する。

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>

#include <lorica/input_budget.hpp>

#include "core/json.hpp"
#include "db/database.hpp"

namespace tr::db {

namespace oid {
inline constexpr unsigned kBool = 16, kBytea = 17, kInt8 = 20, kInt2 = 21, kInt4 = 23, kText = 25, kOid = 26,
                          kJson = 114, kFloat4 = 700, kFloat8 = 701, kBoolArray = 1000, kInt2Array = 1005,
                          kInt4Array = 1007, kTextArray = 1009, kVarcharArray = 1015, kInt8Array = 1016,
                          kFloat4Array = 1021, kFloat8Array = 1022, kDate = 1082, kTimestamp = 1114,
                          kTimestamptz = 1184, kTimestamptzArray = 1185, kNumeric = 1700, kUuid = 2950,
                          kUuidArray = 2951, kJsonb = 3802, kJsonbArray = 3807;
}

// 1 つの値を変換する。予算超過・壊れた値は DbError。
Json decode_value(std::string_view text, unsigned type_oid, lorica::input_budget& budget);

// '{"a","b c",NULL}' の 1 次元配列リテラルを要素に分ける (NULL は nullopt)。
std::optional<std::vector<std::optional<std::string>>> parse_array_literal(std::string_view text);

// パラメータをテキスト形式と型 OID (0 = サーバが推論) にする。
struct EncodedParam {
    bool is_null = false;
    std::string text;
    unsigned type_oid = 0;
};
EncodedParam encode_param(const Param& p);
// PG の配列リテラル {"a","b"} を作る (要素は常に引用する)。
std::string to_array_literal(const std::vector<std::string>& items);

}  // namespace tr::db
