#include "core/llm/output.hpp"

#include <algorithm>
#include <charconv>
#include <cmath>
#include <limits>

#include "core/llm/engine.hpp"
#include "core/text.hpp"

namespace tr::llm {

namespace {

double string_to_number(const std::string& raw) {
    const std::string s = js_trim(raw);
    if (s.empty()) return 0;
    if (s == "Infinity" || s == "+Infinity") return std::numeric_limits<double>::infinity();
    if (s == "-Infinity") return -std::numeric_limits<double>::infinity();
    if (s.size() > 2 && s[0] == '0' && (s[1] == 'x' || s[1] == 'X' || s[1] == 'o' || s[1] == 'O' || s[1] == 'b' || s[1] == 'B')) {
        const int base = (s[1] == 'x' || s[1] == 'X') ? 16 : (s[1] == 'o' || s[1] == 'O') ? 8 : 2;
        double v = 0;
        for (std::size_t i = 2; i < s.size(); ++i) {
            const char c = s[i];
            int d = -1;
            if (c >= '0' && c <= '9') d = c - '0';
            else if (c >= 'a' && c <= 'f') d = c - 'a' + 10;
            else if (c >= 'A' && c <= 'F') d = c - 'A' + 10;
            if (d < 0 || d >= base) return std::nan("");
            v = v * base + d;
        }
        return v;
    }
    // StrDecimalLiteral: [+-] digits [. digits] [e[+-]digits] (from_chars は '+' を受けないので外す)
    std::string_view v = s;
    bool neg = false;
    if (v[0] == '+' || v[0] == '-') {
        neg = v[0] == '-';
        v.remove_prefix(1);
    }
    if (v.empty() || v[0] == '+' || v[0] == '-') return std::nan("");
    for (char c : v) {
        if (!((c >= '0' && c <= '9') || c == '.' || c == 'e' || c == 'E' || c == '+' || c == '-')) return std::nan("");
    }
    double d = 0;
    auto r = std::from_chars(v.data(), v.data() + v.size(), d);
    if (r.ec != std::errc() || r.ptr != v.data() + v.size()) return std::nan("");
    return neg ? -d : d;
}

}  // namespace

double js_to_number(const Json& v) {
    switch (v.type()) {
        case Json::value_t::number_integer:
        case Json::value_t::number_unsigned:
        case Json::value_t::number_float:
            return v.get<double>();
        case Json::value_t::boolean:
            return v.get<bool>() ? 1 : 0;
        case Json::value_t::null:
            return 0;
        case Json::value_t::string:
            return string_to_number(v.get<std::string>());
        case Json::value_t::array:
            // [] → "" → 0, [x] → String(x), それ以外 → "a,b" → NaN
            if (v.empty()) return 0;
            if (v.size() == 1) {
                const Json& x = v[0];
                if (x.is_null()) return 0;
                if (x.is_string()) return string_to_number(x.get<std::string>());
                if (x.is_number()) return x.get<double>();
                if (x.is_array()) return js_to_number(x);
                return std::nan("");
            }
            return std::nan("");
        default:
            return std::nan("");
    }
}

bool js_truthy(const Json& v) {
    switch (v.type()) {
        case Json::value_t::null:
        case Json::value_t::discarded:
            return false;
        case Json::value_t::boolean:
            return v.get<bool>();
        case Json::value_t::number_integer:
        case Json::value_t::number_unsigned:
        case Json::value_t::number_float: {
            const double d = v.get<double>();
            return d != 0 && !std::isnan(d);
        }
        case Json::value_t::string:
            return !v.get<std::string>().empty();
        default:
            return true;  // object / array
    }
}

std::string serialize_history(const std::vector<Turn>& turns) {
    std::vector<std::string> lines;
    lines.reserve(turns.size());
    for (const auto& t : turns) {
        lines.push_back("[" + std::to_string(t.turn_no) + "] (" + (t.role == "interviewer" ? "面接官" : "受験者") + "): " + t.text);
    }
    return join(lines, "\n");
}

std::string extract_json_block(const std::string& text) {
    // /```(?:json)?\s*([\s\S]*?)```/ と同じ結果を前進走査だけで求める:
    // 最初の ``` の後で "json" を (あれば) 飛ばし、空白 (\s = JS の空白と改行) を飛ばし、次の ``` までを取る。
    // 最初の ``` に閉じが無ければ、それ以降に ``` は無いので一致しない。取り出した中身が空なら次の手段へ。
    const auto open = text.find("```");
    if (open != std::string::npos) {
        std::size_t p = open + 3;
        if (text.compare(p, 4, "json") == 0) p += 4;
        const auto close = text.find("```", p);
        if (close != std::string::npos) {
            const std::string group = js_trim_start(std::string_view(text).substr(p, close - p));
            if (!group.empty()) return js_trim(group);
        }
    }
    const auto start = text.find('{');
    const auto end = text.rfind('}');
    if (start == std::string::npos || end == std::string::npos || end < start) {
        throw std::runtime_error("no JSON object found in LLM output");
    }
    return text.substr(start, end - start + 1);
}

namespace {

int clamp_int(const Json* v, int min, int max, int fallback) {
    const double n = v ? js_to_number(*v) : std::nan("");
    if (!std::isfinite(n)) return fallback;
    const double r = js_round(n);
    return static_cast<int>(std::max<double>(min, std::min<double>(max, r)));
}

void require_object(const Json& raw, const char* label) {
    if (!raw.is_object()) throw CoerceError(std::string(label) + ": object でない");
}

Json parse_strict(const std::string& text) {
    JsonLimits limits;
    limits.max_bytes = 1024 * 1024;
    auto v = parse_json(text, limits);
    if (!v) throw std::runtime_error("invalid JSON in LLM output");
    return *v;
}

}  // namespace

AnswerSignals coerce_signals(const Json& raw) {
    require_object(raw, "signals");
    const Json& obj = raw;
    AnswerSignals s;
    std::string hint;
    if (const Json* h = member(obj, "followup_hint"); h && h->is_string()) hint = js_trim(h->get<std::string>());
    s.specificity = clamp_int(member(obj, "specificity"), 0, 3, 0);
    auto pick = [&](const char* a, const char* b) {
        const Json* v = member(obj, a);
        if (!v || v->is_null()) v = member(obj, b);
        return v ? js_truthy(*v) : false;
    };
    s.synthesis_reached = pick("synthesis_reached", "synthesisReached");
    s.contradiction_open = pick("contradiction_open", "contradictionOpen");
    if (!hint.empty()) s.followup_hint = hint;
    return s;
}

Json coerce_axes(const Json& raw) {
    require_object(raw, "axes");
    const Json& obj = raw;
    Json out = Json::object();
    for (const auto& k : axis_keys()) out[k] = clamp_int(member(obj, k), 0, 5, 0);
    return out;
}

std::optional<std::string> coerce_focus(const Json& raw) {
    if (raw.is_null()) return std::nullopt;
    if (!raw.is_string()) throw CoerceError("focus: string でない");
    std::string t = js_trim(raw.get<std::string>());
    if (t.empty()) return std::nullopt;
    return t;
}

AnswerSignals parse_answer_signals(const std::string& text) { return coerce_signals(parse_strict(extract_json_block(text))); }

ParsedEvaluation parse_evaluation(const std::string& text) {
    const Json obj = parse_strict(extract_json_block(text));
    ParsedEvaluation out;
    const Json* axes = obj.is_object() ? member(obj, "axes") : nullptr;
    out.axes = coerce_axes(axes ? *axes : Json(nullptr));
    if (const Json* c = obj.is_object() ? member(obj, "comment") : nullptr; c && c->is_string()) out.comment = c->get<std::string>();
    if (const Json* h = obj.is_object() ? member(obj, "hints") : nullptr; h && h->is_array()) {
        for (const auto& x : *h) {
            if (x.is_string() && !js_trim(x.get<std::string>()).empty() && out.hints.size() < 3) {
                out.hints.push_back(x.get<std::string>());
            }
        }
    }
    return out;
}

Json clamp_axes(const Json& raw) {
    Json out = Json::object();
    for (const auto& k : axis_keys()) out[k] = clamp_int(raw.is_object() ? member(raw, k) : nullptr, 0, 5, 0);
    return out;
}

Json average_axes(const std::vector<Json>& samples) {
    if (samples.empty()) return clamp_axes(Json::object());
    Json out = Json::object();
    for (const auto& k : axis_keys()) {
        double sum = 0;
        for (const auto& s : samples) sum += s.value(k, 0.0);
        const double mean = sum / static_cast<double>(samples.size());
        out[k] = static_cast<int>(std::max(0.0, std::min(5.0, js_round(mean))));
    }
    return out;
}

std::vector<std::string> dedup_hints(const std::vector<std::string>& hints) {
    std::vector<std::string> out;
    for (const auto& h : hints) {
        const std::string t = js_trim(h);
        if (!t.empty() && std::find(out.begin(), out.end(), t) == out.end()) out.push_back(t);
    }
    return out;
}

Json parse_summary(const std::string& text) {
    Json obj = parse_strict(extract_json_block(text));
    if (!obj.is_object()) throw std::runtime_error("summarizer output schema mismatch");
    auto has = [&](const char* k) { return obj.contains(k); };
    if (!has("headline") || !obj["headline"].is_string() || !has("highlights") || !obj["highlights"].is_array() ||
        !has("axes_summary") || !js_truthy(obj["axes_summary"]) || !has("growth_points") ||
        !obj["growth_points"].is_array() || !has("carry_over") || !obj["carry_over"].is_array() ||
        !has("interviewer_note") || !obj["interviewer_note"].is_string()) {
        throw std::runtime_error("summarizer output schema mismatch");
    }
    return obj;
}

std::string parse_interviewer_output(const std::string& model, const std::string& stdout_text) {
    auto size_check = [](const std::string& text) {
        if (text.empty() || utf16_length(text) > 8000) throw std::runtime_error("interviewer_output_size");
        return text;
    };
    if (model == "opus") {
        const Json json = parse_strict(stdout_text);
        std::vector<Json> messages;
        if (json.is_array()) {
            for (const auto& m : json) messages.push_back(m);
        } else {
            messages.push_back(json);
        }
        const Json* result = nullptr;
        for (auto it = messages.rbegin(); it != messages.rend(); ++it) {
            if (it->is_object() && it->contains("result") && (*it)["result"].is_string()) {
                result = &*it;
                break;
            }
        }
        if (!result || (result->contains("is_error") && js_truthy((*result)["is_error"])) ||
            string_or(*result, "subtype") != "success") {
            throw std::runtime_error("interviewer_output_failed");
        }
        for (const auto& m : messages) {
            const Json* message = m.is_object() ? member(m, "message") : nullptr;
            const Json* content = message ? member(*message, "content") : nullptr;
            if (content && content->is_array()) {
                for (const auto& c : *content) {
                    if (c.is_object() && string_or(c, "type") == "tool_use") throw std::runtime_error("interviewer_tools_forbidden");
                }
            }
        }
        return size_check(js_trim((*result)["result"].get<std::string>()));
    }
    std::vector<Json> events;
    for (const auto& line : split(stdout_text, '\n')) {
        if (js_trim(line).empty()) continue;
        events.push_back(parse_strict(line));
    }
    bool completed = false;
    for (const auto& e : events) {
        const std::string type = e.is_object() ? string_or(e, "type") : "";
        if (type == "turn.completed") completed = true;
        if (type == "error" || type == "turn.failed") throw std::runtime_error("interviewer_output_failed");
    }
    if (!completed) throw std::runtime_error("interviewer_output_failed");
    std::vector<std::string> texts;
    for (const auto& e : events) {
        const Json* item = e.is_object() ? member(e, "item") : nullptr;
        const std::string item_type = item && item->is_object() ? string_or(*item, "type") : "";
        if (!item_type.empty() && item_type != "reasoning" && item_type != "agent_message") {
            throw std::runtime_error("interviewer_tools_forbidden");
        }
        if (string_or(e, "type") == "item.completed" && item_type == "agent_message") {
            texts.push_back(string_or(*item, "text"));
        }
    }
    return size_check(js_trim(join(texts, "\n")));
}

}  // namespace tr::llm
