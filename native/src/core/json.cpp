#include "core/json.hpp"

#include <charconv>
#include <cmath>
#include <cstdint>
#include <limits>

#include "core/text.hpp"

namespace tr {
namespace {

struct BudgetExceeded {};

}  // namespace

std::optional<Json> parse_json_bounded(std::string_view text, lorica::input_budget& budget,
                                       std::size_t max_depth) {
    if (!budget.consume(text.size(), 0, 1)) return std::nullopt;
    // hono の c.req.json() は本文を UTF-8 として読み (不正な列は U+FFFD)、JSON.parse に渡す。
    const std::string sanitized = sanitize_utf8(text);
    if (!budget.permits_depth(max_depth)) return std::nullopt;
    auto callback = [&](int depth, Json::parse_event_t event, Json& parsed) -> bool {
        if (depth < 0 || static_cast<std::size_t>(depth) > max_depth) throw BudgetExceeded{};
        switch (event) {
            case Json::parse_event_t::object_start:
            case Json::parse_event_t::array_start:
                if (!budget.consume(0, 1, 1)) throw BudgetExceeded{};
                break;
            case Json::parse_event_t::key:
            case Json::parse_event_t::value: {
                // 復号後の文字列も課金する (エスケープを解いた後の大きさ)。
                const std::size_t bytes = parsed.is_string() ? parsed.get_ref<const std::string&>().size() : 0;
                if (!budget.consume(bytes, 1, 1)) throw BudgetExceeded{};
                break;
            }
            default:
                break;
        }
        return true;
    };
    try {
        return Json::parse(sanitized, callback, true, false);
    } catch (const BudgetExceeded&) {
        return std::nullopt;
    } catch (const nlohmann::json::exception&) {
        return std::nullopt;
    }
}

std::optional<Json> parse_json(std::string_view text, const JsonLimits& limits) {
    lorica::input_budget budget({limits.max_bytes * 2 + 64, limits.max_elements, limits.max_elements + 1,
                                 limits.max_depth});
    if (text.size() > limits.max_bytes) return std::nullopt;
    return parse_json_bounded(text, budget, limits.max_depth);
}

std::string js_number_to_string(double value) {
    if (std::isnan(value) || std::isinf(value)) return "null";
    if (value == 0) return "0";
    std::string out;
    if (value < 0) {
        out.push_back('-');
        value = -value;
    }
    char buf[64];
    auto res = std::to_chars(buf, buf + sizeof buf, value, std::chars_format::scientific);
    std::string_view sci(buf, static_cast<std::size_t>(res.ptr - buf));
    // sci = d[.ddd]e±XX
    const auto epos = sci.find('e');
    std::string digits;
    for (char c : sci.substr(0, epos)) {
        if (c != '.') digits.push_back(c);
    }
    int exp10 = 0;
    std::from_chars(sci.data() + epos + 1 + (sci[epos + 1] == '+' ? 1 : 0), sci.data() + sci.size(), exp10);
    while (digits.size() > 1 && digits.back() == '0') digits.pop_back();
    const int k = static_cast<int>(digits.size());
    const int n = exp10 + 1;  // value = 0.digits × 10^n
    if (k <= n && n <= 21) {
        out += digits;
        out.append(static_cast<std::size_t>(n - k), '0');
    } else if (0 < n && n <= 21) {
        out += digits.substr(0, static_cast<std::size_t>(n));
        out.push_back('.');
        out += digits.substr(static_cast<std::size_t>(n));
    } else if (-6 < n && n <= 0) {
        out += "0.";
        out.append(static_cast<std::size_t>(-n), '0');
        out += digits;
    } else {
        const int e = n - 1;
        out.push_back(digits[0]);
        if (k > 1) {
            out.push_back('.');
            out += digits.substr(1);
        }
        out.push_back('e');
        out.push_back(e < 0 ? '-' : '+');
        out += std::to_string(e < 0 ? -e : e);
    }
    return out;
}

namespace {

void append_js_string(std::string& out, std::string_view s) {
    static constexpr char hex[] = "0123456789abcdef";
    out.push_back('"');
    const std::string clean = sanitize_utf8(s);
    for (unsigned char c : clean) {
        switch (c) {
            case '"': out += "\\\""; break;
            case '\\': out += "\\\\"; break;
            case '\b': out += "\\b"; break;
            case '\f': out += "\\f"; break;
            case '\n': out += "\\n"; break;
            case '\r': out += "\\r"; break;
            case '\t': out += "\\t"; break;
            default:
                if (c < 0x20) {
                    out += "\\u00";
                    out.push_back(hex[c >> 4]);
                    out.push_back(hex[c & 0xF]);
                } else {
                    out.push_back(static_cast<char>(c));
                }
        }
    }
    out.push_back('"');
}

constexpr double kMaxSafe = 9007199254740992.0;  // 2^53

void append_value(std::string& out, const Json& v) {
    switch (v.type()) {
        case Json::value_t::null:
        case Json::value_t::discarded:
            out += "null";
            break;
        case Json::value_t::boolean:
            out += v.get<bool>() ? "true" : "false";
            break;
        case Json::value_t::number_integer: {
            const auto i = v.get<std::int64_t>();
            if (static_cast<double>(i) > kMaxSafe || static_cast<double>(i) < -kMaxSafe) {
                out += js_number_to_string(static_cast<double>(i));
            } else {
                out += std::to_string(i);
            }
            break;
        }
        case Json::value_t::number_unsigned: {
            const auto u = v.get<std::uint64_t>();
            if (static_cast<double>(u) > kMaxSafe) {
                out += js_number_to_string(static_cast<double>(u));
            } else {
                out += std::to_string(u);
            }
            break;
        }
        case Json::value_t::number_float:
            out += js_number_to_string(v.get<double>());
            break;
        case Json::value_t::string:
            append_js_string(out, v.get_ref<const std::string&>());
            break;
        case Json::value_t::array: {
            out.push_back('[');
            bool first = true;
            for (const auto& item : v) {
                if (!first) out.push_back(',');
                first = false;
                append_value(out, item);
            }
            out.push_back(']');
            break;
        }
        case Json::value_t::object: {
            out.push_back('{');
            bool first = true;
            for (auto it = v.begin(); it != v.end(); ++it) {
                if (!first) out.push_back(',');
                first = false;
                append_js_string(out, it.key());
                out.push_back(':');
                append_value(out, it.value());
            }
            out.push_back('}');
            break;
        }
        case Json::value_t::binary:
            out += "null";
            break;
    }
}

}  // namespace

std::string js_stringify(const Json& value) {
    std::string out;
    append_value(out, value);
    return out;
}

bool is_plain_object(const Json& value) { return value.is_object(); }

const Json* member(const Json& object, std::string_view key) {
    if (!object.is_object()) return nullptr;
    auto it = object.find(std::string(key));
    return it == object.end() ? nullptr : &*it;
}

std::string string_or(const Json& object, std::string_view key, std::string_view fallback) {
    const Json* v = member(object, key);
    if (v && v->is_string()) return v->get<std::string>();
    return std::string(fallback);
}

std::optional<std::string> optional_string(const Json& object, std::string_view key) {
    const Json* v = member(object, key);
    if (v && v->is_string()) return v->get<std::string>();
    return std::nullopt;
}

}  // namespace tr
