#pragma once
// JSON の型と、外部入力の JSON を上限つきで読む関数、JS の JSON.stringify と同じ文字列を作る関数。
// Node 実装 (hono の c.json = JSON.stringify) と同じバイト列を返すため、出力は必ず js_stringify を通す。

#include <cstddef>
#include <optional>
#include <string>
#include <string_view>

#include <lorica/input_budget.hpp>
#include <nlohmann/json.hpp>

namespace tr {

// JS のオブジェクトと同じく、キーは挿入順に保つ。
using Json = nlohmann::ordered_json;

struct JsonLimits {
    std::size_t max_bytes = 2 * 1024 * 1024;
    std::size_t max_elements = 200'000;
    std::size_t max_depth = 64;
};

// 予算を課金しながら JSON を読む。入力の大きさ・要素数・入れ子の深さ・復号後の文字列の大きさを
// すべて課金し、超えたら nullopt (壊れた JSON も nullopt)。
std::optional<Json> parse_json_bounded(std::string_view text, lorica::input_budget& budget,
                                       std::size_t max_depth);
std::optional<Json> parse_json(std::string_view text, const JsonLimits& limits = {});

// JSON.stringify(value) と同じ出力 (空白なし)。
std::string js_stringify(const Json& value);
// Number.prototype.toString と同じ数値の文字列 (NaN/Infinity は JSON では null)。
std::string js_number_to_string(double value);

// JS の値の読み方を真似る小さな補助。
bool is_plain_object(const Json& value);
// typeof v === 'string' ? v : fallback
std::string string_or(const Json& object, std::string_view key, std::string_view fallback = {});
// typeof v === 'string' のときだけ値を返す
std::optional<std::string> optional_string(const Json& object, std::string_view key);
const Json* member(const Json& object, std::string_view key);

}  // namespace tr
