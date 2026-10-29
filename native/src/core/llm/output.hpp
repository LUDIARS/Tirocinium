#pragma once
// LLM の出力の検証と変換 (evaluator.ts / judge.ts / coerce.ts / summarizer.ts / interviewer-cli.ts の parse 部分)。
// 原則は Node 版と同じ: clamp できる値は clamp、構造違反は例外 (呼び出し側が 1 回だけ再試行)。
// 正規表現 /```(?:json)?\s*([\s\S]*?)```/ は閉じないフェンスの繰り返しで二乗時間になりうるため、
// 前進するだけの線形走査で同じ結果を返す。

#include <optional>
#include <stdexcept>
#include <string>
#include <vector>

#include "core/json.hpp"

namespace tr::llm {

struct Turn {
    int turn_no = 0;
    std::string role;  // interviewer | user
    std::string text;
};

class CoerceError : public std::runtime_error {
public:
    explicit CoerceError(const std::string& m) : std::runtime_error("[coerce] " + m) {}
};

// JS の Number(v) (数値・文字列・真偽・null・1 要素配列)。変換できなければ NaN。
double js_to_number(const Json& v);
// JS の Boolean(v)。
bool js_truthy(const Json& v);

std::string serialize_history(const std::vector<Turn>& turns);
// ```json ... ``` のブロック (無ければ最初の { から最後の } まで)。どちらも無ければ例外。
std::string extract_json_block(const std::string& text);

struct AnswerSignals {
    int specificity = 0;
    bool synthesis_reached = false;
    bool contradiction_open = false;
    std::optional<std::string> followup_hint;
};
AnswerSignals coerce_signals(const Json& raw);
Json coerce_axes(const Json& raw);  // 6 軸すべて 0-5 の整数
std::optional<std::string> coerce_focus(const Json& raw);
AnswerSignals parse_answer_signals(const std::string& text);

struct ParsedEvaluation {
    Json axes;
    std::string comment;
    std::vector<std::string> hints;
};
ParsedEvaluation parse_evaluation(const std::string& text);
Json clamp_axes(const Json& raw);
Json average_axes(const std::vector<Json>& samples);
std::vector<std::string> dedup_hints(const std::vector<std::string>& hints);

// summarizer.ts parseSummary: 形が違えば例外。
Json parse_summary(const std::string& text);

// interviewer-cli.ts parseInterviewerOutput: opus = claude の JSON、sol = codex の JSON 行。
// 失敗・ツール使用・空・8000 字超は例外 (fail-closed)。
std::string parse_interviewer_output(const std::string& model, const std::string& stdout_text);

}  // namespace tr::llm
