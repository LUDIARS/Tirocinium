#include "core/llm/engine.hpp"

#include <algorithm>
#include <chrono>
#include <cmath>
#include <random>
#include <stdexcept>

#include "core/text.hpp"

namespace tr::llm {

// ---- rng ----

double Mulberry32::next() {
    a_ = a_ + 0x6D2B79F5u;
    std::uint32_t t = (a_ ^ (a_ >> 15)) * (1u | a_);
    t = (t + ((t ^ (t >> 7)) * (61u | t))) ^ t;
    return static_cast<double>(t ^ (t >> 14)) / 4294967296.0;
}

Rng mulberry32(std::uint32_t seed) {
    auto state = std::make_shared<Mulberry32>(seed);
    return [state] { return state->next(); };
}

std::uint32_t new_session_seed() {
    // (Date.now() ^ floor(Math.random() * 0xffffffff)) >>> 0 と同じ分布 (非決定でよい唯一の箇所)。
    const auto now = static_cast<std::uint64_t>(
        std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch()).count());
    std::random_device rd;
    return static_cast<std::uint32_t>(now) ^ rd();
}

std::vector<Json> shuffled(const std::vector<Json>& items, const Rng& rng) {
    std::vector<Json> out = items;
    for (std::size_t i = out.size(); i-- > 1;) {
        const auto j = static_cast<std::size_t>(std::floor(rng() * static_cast<double>(i + 1)));
        std::swap(out[i], out[j]);
    }
    return out;
}

double js_round(double x) {
    if (!std::isfinite(x)) return x;
    double r = std::floor(x);
    if (x - r >= 0.5) r += 1;
    return r;
}

// ---- phase ----

std::string phase_name(Phase p) {
    switch (p) {
        case Phase::Opening: return "opening";
        case Phase::Probe: return "probe";
        case Phase::Pressure: return "pressure";
        case Phase::Closing: return "closing";
        case Phase::Ended: return "ended";
    }
    return "ended";
}

std::optional<Phase> phase_from_name(const std::string& s) {
    if (s == "opening") return Phase::Opening;
    if (s == "probe") return Phase::Probe;
    if (s == "pressure") return Phase::Pressure;
    if (s == "closing") return Phase::Closing;
    if (s == "ended") return Phase::Ended;
    return std::nullopt;
}

const PhaseSpec& phase_spec(Phase p) {
    static const PhaseSpec opening{"導入。自己紹介を引き出し傾聴する", 1, 2};
    static const PhaseSpec probe{"主題をファネルで掘る (本体)", 4, 10};
    static const PhaseSpec pressure{"矛盾突き・詰めで深掘り耐性を試す", 2, 4};
    static const PhaseSpec closing{"合を確認し逆質問を促して締める", 1, 2};
    switch (p) {
        case Phase::Opening: return opening;
        case Phase::Probe: return probe;
        case Phase::Pressure: return pressure;
        default: return closing;
    }
}

PhaseState initial_phase_state(int persona_pressure, int turn_budget) {
    return PhaseState{Phase::Opening, 0, turn_budget, persona_pressure};
}

bool pressure_enabled(int persona_pressure) { return persona_pressure >= 4; }

namespace {

Phase advance(Phase phase, int persona_pressure) {
    if (phase == Phase::Opening) return Phase::Probe;
    if (phase == Phase::Probe) return pressure_enabled(persona_pressure) ? Phase::Pressure : Phase::Closing;
    return Phase::Closing;
}

PhaseState enter(PhaseState s, Phase phase) {
    s.phase = phase;
    s.phase_turn_no = 0;
    return s;
}

}  // namespace

PhaseState next_phase(const PhaseState& state, const PhaseSignals& signals) {
    if (state.phase == Phase::Ended) return state;
    PhaseState s = state;
    s.phase_turn_no = state.phase_turn_no + 1;
    s.turn_budget = state.turn_budget - 1;
    if (state.phase == Phase::Closing) {
        if (s.phase_turn_no >= phase_spec(Phase::Closing).max_turns || s.turn_budget <= 0) {
            s.phase = Phase::Ended;
        }
        return s;
    }
    if (s.turn_budget <= phase_spec(Phase::Closing).min_turns) return enter(s, Phase::Closing);
    const PhaseSpec& spec = phase_spec(state.phase);
    if (s.phase_turn_no >= spec.max_turns) return enter(s, advance(state.phase, state.persona_pressure));
    if (state.phase == Phase::Probe && s.phase_turn_no >= spec.min_turns && signals.synthesis_reached) {
        return enter(s, advance(Phase::Probe, state.persona_pressure));
    }
    if (state.phase == Phase::Pressure && s.phase_turn_no >= spec.min_turns && !signals.contradiction_open) {
        return enter(s, Phase::Closing);
    }
    return s;
}

// ---- question plan ----

bool is_axis_key(const std::string& k) {
    const auto& keys = axis_keys();
    return std::find(keys.begin(), keys.end(), k) != keys.end();
}

int plan_slot_count(Phase p) { return p == Phase::Ended ? 0 : phase_spec(p).max_turns; }

namespace {

int origin_priority(const Json& c) {
    const std::string o = string_or(c, "origin");
    if (o == "company") return 0;
    if (o == "ob") return 1;
    if (o == "newgrad") return 2;
    if (o == "seed") return 3;
    if (o == "refine") return 4;
    return 5;  // 未知の origin は JS では NaN 比較 (順序不定)。最後に回す。
}

int weak_score(const Json& c, const std::vector<std::string>& weak) {
    int s = 0;
    if (const Json* axes = member(c, "axes"); axes && axes->is_array()) {
        for (const auto& a : *axes) {
            if (a.is_string() && std::find(weak.begin(), weak.end(), a.get<std::string>()) != weak.end()) ++s;
        }
    }
    return s;
}

std::string theme_key(const Json& c) { return js_trim(string_or(c, "theme")); }

bool truthy_string(const Json& c, const char* key) {
    const Json* v = member(c, key);
    return v && v->is_string() && !v->get<std::string>().empty();
}

std::size_t followup_count(const Json& c) {
    const Json* f = member(c, "followups");
    return f && f->is_array() ? f->size() : 0;
}

Json with_phase(Json c, const char* phase) {
    c["phase"] = phase;
    return c;
}

Json fixed_slot(Phase phase) {
    if (phase == Phase::Opening) {
        return Json{{"theme", "自己紹介"},
                    {"question", "最初に、自己紹介と、これまで力を入れてきたことの概要を教えてください。"},
                    {"followups", Json::array()},
                    {"axes", Json::array({"clarity", "self_understanding"})},
                    {"origin", "seed"},
                    {"phase", "opening"}};
    }
    return Json{{"theme", "逆質問"},
                {"question", "最後に、こちらへ聞いておきたいことはありますか。"},
                {"followups", Json::array()},
                {"axes", Json::array({"target_fit"})},
                {"origin", "seed"},
                {"phase", "closing"}};
}

}  // namespace

std::vector<Json> compile_question_plan(const PlanBrief& brief, const std::vector<std::string>& weak_top3, const Rng& rng) {
    std::vector<Json> ranked = shuffled(brief.candidates, rng);
    std::stable_sort(ranked.begin(), ranked.end(), [&](const Json& a, const Json& b) {
        const int p = origin_priority(a) - origin_priority(b);
        if (p != 0) return p < 0;
        return weak_score(b, weak_top3) < weak_score(a, weak_top3);
    });
    // 以降は ranked の添字で扱う (JS の Set はオブジェクトの同一性で判定するため)。
    std::vector<std::size_t> required;
    for (const char* kind : {"random-technical", "company-color", "ai-strategy"}) {
        for (std::size_t i = 0; i < ranked.size(); ++i) {
            if (string_or(ranked[i], "required") == kind) {
                required.push_back(i);
                break;
            }
        }
    }
    std::vector<std::string> seen = {"自己紹介", "逆質問"};
    for (auto i : required) seen.push_back(theme_key(ranked[i]));
    std::vector<std::size_t> dedup;
    for (std::size_t i = 0; i < ranked.size(); ++i) {
        if (truthy_string(ranked[i], "required")) continue;
        const std::string key = theme_key(ranked[i]);
        if (std::find(seen.begin(), seen.end(), key) != seen.end()) continue;
        seen.push_back(key);
        dedup.push_back(i);
    }
    auto in = [](const std::vector<std::size_t>& v, std::size_t i) { return std::find(v.begin(), v.end(), i) != v.end(); };
    std::vector<std::size_t> pressure;
    for (auto i : dedup) {
        if (!in(required, i) && followup_count(ranked[i]) > 0 &&
            static_cast<int>(pressure.size()) < plan_slot_count(Phase::Pressure)) {
            pressure.push_back(i);
        }
    }
    std::vector<std::size_t> probe = required;
    for (auto i : dedup) {
        if (!in(required, i) && !in(pressure, i)) probe.push_back(i);
    }
    if (static_cast<int>(probe.size()) > plan_slot_count(Phase::Probe)) {
        probe.resize(static_cast<std::size_t>(plan_slot_count(Phase::Probe)));
    }
    std::vector<Json> plan;
    plan.push_back(fixed_slot(Phase::Opening));
    for (auto i : probe) plan.push_back(with_phase(ranked[i], "probe"));
    for (auto i : pressure) plan.push_back(with_phase(ranked[i], "pressure"));
    plan.push_back(fixed_slot(Phase::Closing));
    return plan;
}

std::optional<Json> next_slot(const std::vector<Json>& plan, Phase phase, const std::map<std::string, int>& cursor) {
    if (phase == Phase::Ended) return std::nullopt;
    const std::string name = phase_name(phase);
    int idx = 0;
    if (auto it = cursor.find(name); it != cursor.end()) idx = it->second;
    int seen = 0;
    for (const auto& s : plan) {
        if (string_or(s, "phase") != name) continue;
        if (seen == idx) return s;
        ++seen;
    }
    return std::nullopt;
}

// ---- role aliases ----

namespace {

const std::vector<std::pair<std::string, std::vector<std::string>>>& role_aliases() {
    static const std::vector<std::pair<std::string, std::vector<std::string>>> table = {
        {"programmer",
         {"programmer", "プログラマ", "プログラマー", "エンジニア", "engineer", "クライアントエンジニア", "サーバーエンジニア",
          "サーバエンジニア", "fe", "フロントエンド", "frontend", "バックエンド", "backend", "ゲームプログラマ",
          "ゲームプログラマー", "テクニカルアーティスト", "ta"}},
        {"planner",
         {"planner", "プランナー", "企画", "ゲームプランナー", "ゲームデザイナー", "game designer", "レベルデザイナー",
          "ディレクター志望"}},
        {"designer",
         {"designer", "デザイナー", "グラフィッカー", "アーティスト", "artist", "2d", "3d", "モデラー", "アニメーター", "ui",
          "uiデザイナー", "イラストレーター"}},
        {"sound", {"sound", "サウンド", "コンポーザー", "作曲", "サウンドクリエイター", "se", "音響"}},
    };
    return table;
}

const std::vector<std::vector<std::string>>& tech_alias_groups() {
    static const std::vector<std::vector<std::string>> groups = {
        {"ue", "unreal engine", "unreal", "アンリアルエンジン", "アンリアル"},
        {"unity", "ユニティ"},
        {"fe", "フロントエンド", "frontend"},
        {"バックエンド", "backend", "サーバーサイド", "サーバサイド"},
        {"c++", "cpp", "シープラスプラス"},
        {"c#", "csharp", "シーシャープ"},
        {"ts", "typescript", "タイプスクリプト"},
        {"gl", "opengl"},
        {"ml", "機械学習", "machine learning", "ai"},
    };
    return groups;
}

bool contains(const std::vector<std::string>& v, const std::string& s) { return std::find(v.begin(), v.end(), s) != v.end(); }

}  // namespace

std::string canonical_role(const std::optional<std::string>& input) {
    if (!input) return "general";
    const std::string t = js_to_lower(js_trim(*input));
    if (t.empty()) return "general";
    for (const auto& [canon, aliases] : role_aliases()) {
        if (canon == t) return canon;
        for (const auto& a : aliases) {
            if (t == a || (utf16_length(a) >= 3 && t.find(a) != std::string::npos)) return canon;
        }
    }
    return "general";
}

std::vector<std::string> expand_terms(const std::vector<std::string>& terms) {
    std::vector<std::string> out;
    std::vector<std::string> seen;
    auto push = [&](const std::string& t) {
        const std::string k = js_trim(t);
        const std::string lk = js_to_lower(k);
        if (!k.empty() && !contains(seen, lk)) {
            seen.push_back(lk);
            out.push_back(k);
        }
    };
    for (const auto& term : terms) {
        push(term);
        const std::string lower = js_to_lower(js_trim(term));
        for (const auto& group : tech_alias_groups()) {
            if (contains(group, lower)) {
                for (const auto& g : group) push(g);
            }
        }
        for (const auto& [canon, aliases] : role_aliases()) {
            (void)canon;
            if (contains(aliases, lower)) {
                for (std::size_t i = 0; i < aliases.size() && i < 4; ++i) push(aliases[i]);
            }
        }
    }
    return out;
}

std::vector<std::string> split_keywords(const std::string& text) {
    // /[\s、。,.\/・()（）「」\[\]【】]+/
    static const std::u32string seps = U"、。,./・()（）「」[]【】";
    std::vector<std::string> out;
    std::vector<char32_t> current;
    auto flush = [&] {
        std::string t = js_trim(encode_utf8(current));
        if (utf16_length(t) >= 2) out.push_back(t);
        current.clear();
    };
    for (char32_t cp : decode_utf8(text)) {
        if (is_js_space(cp) || seps.find(cp) != std::u32string::npos) {
            flush();
        } else {
            current.push_back(cp);
        }
    }
    flush();
    return out;
}

// ---- technical topics ----

Json select_technical_topic(const std::string& role, const std::string& level, const std::vector<std::string>& seen,
                            const Rng& rng) {
    static const std::map<std::string, std::vector<std::string>> topics = {
        {"programmer", {"データ構造と計算量", "メモリと所有権", "状態遷移とテスト", "通信遅延と整合性", "CPU/GPU/GCの計測", "並行処理とキャンセル"}},
        {"planner", {"ルールと体験の整合", "難易度とプレイテスト", "経済バランス", "仕様の境界条件", "指標と仮説検証", "変更管理と優先順位"}},
        {"designer", {"視認性とアクセシビリティ", "アセットの性能予算", "制作工程とレビュー", "UI状態と遷移", "モーションの伝達性", "データ管理と再利用"}},
        {"sound", {"音量と聴きやすさ", "音声資源とメモリ", "インタラクティブ音響", "同期と遅延", "ミックスの検証", "アセットと実装境界"}},
        {"general", {"課題の分解", "仮説と検証", "品質と制約", "再現性と記録", "チーム内の仕様共有", "優先順位の判断"}},
    };
    auto it = topics.find(role);
    if (it == topics.end()) throw std::runtime_error("unknown role");
    struct Topic {
        std::string id;
        std::string topic;
    };
    std::vector<Topic> all;
    for (std::size_t i = 0; i < it->second.size(); ++i) all.push_back({role + ":" + std::to_string(i), it->second[i]});
    std::vector<std::string> exclusions = seen;
    auto pick = [&] {
        std::vector<Topic> c;
        for (const auto& t : all) {
            if (!contains(exclusions, t.id)) c.push_back(t);
        }
        return c;
    };
    auto choices = pick();
    while (choices.empty() && !exclusions.empty()) {
        exclusions.pop_back();
        choices = pick();
    }
    const double random = rng();
    if (!std::isfinite(random) || random < 0 || random >= 1) throw std::runtime_error("invalid_topic_rng");
    const Topic& selected = choices[static_cast<std::size_t>(std::floor(random * static_cast<double>(choices.size())))];
    return Json{
        {"theme", "技術ランダム: " + selected.topic},
        {"origin", "seed"},
        {"followups", Json::array()},
        {"axes", Json::array({"clarity", "depth_resilience"})},
        {"required", "random-technical"},
        {"topicId", selected.id},
        {"selectionReason", role + "/" + level + "; portfolio-independent; seeded RNG; recent topic exclusion"},
        {"question", selected.topic + "について、" +
                         (level == "entry" ? std::string("基礎と小さな具体例で説明できる")
                                           : std::string("設計の代替案・制約・運用を比較できる")) +
                         "技術質問を一つ選んで具体化してください。本人がその実装を経験したと決めつけず、必要なら仮定の設計問題にしてください。"},
    };
}

}  // namespace tr::llm
