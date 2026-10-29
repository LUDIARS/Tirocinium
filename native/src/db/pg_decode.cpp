#include "db/pg_decode.hpp"

#include <charconv>
#include <cmath>

#include "core/time.hpp"

namespace tr::db {
namespace {

[[noreturn]] void bad(const std::string& what) { throw DbError("unexpected database value: " + what, "XX000"); }

Json to_number(std::string_view text) {
    if (text == "NaN") return Json(std::nan(""));
    if (text == "Infinity") return Json(HUGE_VAL);
    if (text == "-Infinity") return Json(-HUGE_VAL);
    std::int64_t i = 0;
    auto r = std::from_chars(text.data(), text.data() + text.size(), i);
    if (r.ec == std::errc() && r.ptr == text.data() + text.size()) return Json(i);
    double d = 0;
    auto rd = std::from_chars(text.data(), text.data() + text.size(), d);
    if (rd.ec == std::errc() && rd.ptr == text.data() + text.size()) return Json(d);
    bad("number");
}

Json to_timestamp(std::string_view text) {
    // postgres.js は new Date(x)。'infinity' 等は Invalid Date → JSON.stringify で null。
    auto ms = parse_iso_ms(text);
    if (!ms) return Json(nullptr);
    return Json(iso_from_ms(*ms));
}

unsigned element_oid(unsigned array_oid) {
    switch (array_oid) {
        case oid::kBoolArray: return oid::kBool;
        case oid::kInt2Array: return oid::kInt2;
        case oid::kInt4Array: return oid::kInt4;
        case oid::kTextArray: return oid::kText;
        case oid::kVarcharArray: return oid::kText;
        case oid::kInt8Array: return oid::kInt8;
        case oid::kFloat4Array: return oid::kFloat4;
        case oid::kFloat8Array: return oid::kFloat8;
        case oid::kTimestamptzArray: return oid::kTimestamptz;
        case oid::kUuidArray: return oid::kUuid;
        case oid::kJsonbArray: return oid::kJsonb;
        default: return 0;
    }
}

}  // namespace

std::optional<std::vector<std::optional<std::string>>> parse_array_literal(std::string_view s) {
    // 区切り指定 (=[...]) 付きの形や多次元は扱わない (このスキーマの text[] は 1 次元のみ)。
    if (s.size() < 2 || s.front() != '{' || s.back() != '}') return std::nullopt;
    std::vector<std::optional<std::string>> out;
    std::size_t i = 1;
    const std::size_t end = s.size() - 1;
    if (i == end) return out;
    while (i <= end) {
        if (i == end) return std::nullopt;  // 末尾の ',' の後に要素が無い
        if (s[i] == '{') return std::nullopt;  // 多次元
        if (s[i] == '"') {
            std::string item;
            ++i;
            bool closed = false;
            while (i < end) {
                const char c = s[i];
                if (c == '\\') {
                    if (i + 1 >= end) return std::nullopt;
                    item.push_back(s[i + 1]);
                    i += 2;
                } else if (c == '"') {
                    closed = true;
                    ++i;
                    break;
                } else {
                    item.push_back(c);
                    ++i;
                }
            }
            if (!closed) return std::nullopt;
            out.emplace_back(std::move(item));
        } else {
            const std::size_t start = i;
            while (i < end && s[i] != ',') ++i;
            std::string_view raw = s.substr(start, i - start);
            if (raw == "NULL") out.emplace_back(std::nullopt);
            else out.emplace_back(std::string(raw));
        }
        if (i == end) break;
        if (s[i] != ',') return std::nullopt;
        ++i;
    }
    return out;
}

Json decode_value(std::string_view text, unsigned type_oid, lorica::input_budget& budget) {
    if (!budget.consume(text.size(), 1, 1)) throw DbError("database result exceeds the response budget", "54000");
    switch (type_oid) {
        case oid::kBool:
            return Json(text == "t");
        case oid::kInt2:
        case oid::kInt4:
        case oid::kOid:
        case oid::kFloat4:
        case oid::kFloat8:
            return to_number(text);
        case oid::kJson:
        case oid::kJsonb: {
            auto v = parse_json_bounded(text, budget, 64);
            if (!v) bad("json");
            return std::move(*v);
        }
        case oid::kDate:
        case oid::kTimestamp:
        case oid::kTimestamptz:
            return to_timestamp(text);
        default:
            break;
    }
    if (const unsigned elem = element_oid(type_oid)) {
        auto items = parse_array_literal(text);
        if (!items) bad("array");
        Json arr = Json::array();
        for (auto& item : *items) {
            if (!item) {
                arr.push_back(nullptr);
                continue;
            }
            arr.push_back(decode_value(*item, elem, budget));
        }
        return arr;
    }
    // int8 / numeric / uuid / text / int4range など: 文字列 (postgres.js の既定)。
    return Json(std::string(text));
}

std::string to_array_literal(const std::vector<std::string>& items) {
    std::string out = "{";
    for (std::size_t i = 0; i < items.size(); ++i) {
        if (i) out.push_back(',');
        out.push_back('"');
        for (char c : items[i]) {
            if (c == '"' || c == '\\') out.push_back('\\');
            out.push_back(c);
        }
        out.push_back('"');
    }
    out.push_back('}');
    return out;
}

EncodedParam encode_param(const Param& p) {
    EncodedParam e;
    std::visit(
        [&](const auto& v) {
            using T = std::decay_t<decltype(v)>;
            if constexpr (std::is_same_v<T, Null>) {
                e.is_null = true;
            } else if constexpr (std::is_same_v<T, std::string>) {
                e.text = v;
            } else if constexpr (std::is_same_v<T, std::int64_t>) {
                e.text = std::to_string(v);
            } else if constexpr (std::is_same_v<T, double>) {
                e.text = js_number_to_string(v);
            } else if constexpr (std::is_same_v<T, bool>) {
                e.text = v ? "true" : "false";
                e.type_oid = oid::kBool;
            } else if constexpr (std::is_same_v<T, StringArray>) {
                e.text = to_array_literal(v.items);
            } else if constexpr (std::is_same_v<T, JsonParam>) {
                e.text = js_stringify(v.value);
                e.type_oid = oid::kJsonb;
            }
        },
        p);
    return e;
}

}  // namespace tr::db
