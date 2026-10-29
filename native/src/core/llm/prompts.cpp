#include "core/llm/prompts.hpp"

#include <map>
#include <stdexcept>

#include "core/text.hpp"

namespace tr::llm {

const char* const kDialecticProbe = R"(深掘りは「弁証法サイクル」で行う (出力は次の発話=質問のみ。内部思考は出さない):
  正(thesis): 直前回答から候補者の主張/自己評価を 1 つ取り出す
  反(antithesis): 次の一手だけを当てる
    - 矛盾: 過去発言や ES と食い違う点を突く
    - 反例/別視点: 「逆に〜なケースでは?」
    - 未踏スロット: STAR の欠け (具体例 / 数値 / あなた個人の担当範囲) を 1 つ
  合(synthesis): 候補者の統合回答を待つ。次の turn で:
    - 深まった → 次テーマへ (質問を一段具体に狭める = ファネル)
    - 浅い → 同じテーマで反を一段強める
1 turn に質問は 1 つだけ。人格否定はしない。)";

std::string phase_guidance(Phase p) {
    switch (p) {
        case Phase::Opening: return "いまは導入。自己紹介や志望動機を促し、まず傾聴する。深掘りはまだしない。";
        case Phase::Probe: return "主題を弁証法サイクル (上記) で 1 テーマずつ掘る。未踏スロットを優先する。";
        case Phase::Pressure:
            return "反を強める段。矛盾・反例を 1 つ正面からぶつけ、深掘り耐性を試す。圧は強めてよいが人格否定はしない。";
        case Phase::Closing:
            return "合を確認し、候補者からの逆質問を促し、120 秒を目安に締めに入る。新しい深掘りは始めない。";
        case Phase::Ended: return "面接は終盤。短く締めくくる。";
    }
    return "";
}

const char* const kEvalInstruction = R"(あなたは面接の評価者です。 与えられた面接の turn 履歴を読み、
6 軸 (consistency / clarity / demeanor / self_understanding / target_fit / depth_resilience)
を 0-5 で評価し、 改善 hint を出してください。

出力は以下の JSON のみ。 余計な前置きや説明は禁止。

{
  "axes": {
    "consistency": <0-5>, "clarity": <0-5>, "demeanor": <0-5>,
    "self_understanding": <0-5>, "target_fit": <0-5>, "depth_resilience": <0-5>
  },
  "comment": "<200 字以内の所感>",
  "hints": ["<改善 hint 1>", "<改善 hint 2>", "<改善 hint 3>"]
}

評価軸の意味:
- consistency: 過去回答との矛盾の無さ
- clarity: 結論先出し / 因果説明の質
- demeanor: フィラー / 沈黙 / 早口の出現頻度
- self_understanding: 強み・弱みを具体例で語れているか
- target_fit: 志望企業 tag との接続度
- depth_resilience: "なぜ?" 連打への持ち堪え

各軸の 0-5 アンカー (3 を標準点とし、過大評価しない):
- 0: 該当行動がほぼ見られない / 1-2: 部分的だが弱い / 3: 標準的 / 4: 良好 / 5: 卓越

採点の根拠を comment に必ず turn 番号で 1 つ以上引用する (例: 「turn 5 で結論が後出し」)。
hints は具体的・行動可能なものを最大 3 個。)";

const char* const kSummaryInstruction = R"(あなたは面接の評価者です。 与えられた面接の全 turn と中間評価を読み、
構造化サマリを生成してください。

出力は以下の JSON のみ。 余計な前置きや説明は禁止。

{
  "headline": "<40 字以内の一行サマリ>",
  "highlights": [
    {"turn_no": <int>, "comment": "<1 行コメント>"}
  ],
  "axes_summary": {
    "final": {
      "consistency": <0-5>, "clarity": <0-5>, "demeanor": <0-5>,
      "self_understanding": <0-5>, "target_fit": <0-5>, "depth_resilience": <0-5>
    },
    "ema_delta": {
      "consistency": <number>, "clarity": <number>, "demeanor": <number>,
      "self_understanding": <number>, "target_fit": <number>, "depth_resilience": <number>
    }
  },
  "growth_points": ["<改善 hint 1>", "<改善 hint 2>", "<改善 hint 3>"],
  "carry_over": ["<次回深掘りテーマ 1>", "<次回深掘りテーマ 2>"],
  "interviewer_note": "<面接官ペルソナの総評。 100-200 字>"
}

ルール:
- highlights は印象に残った turn を 3-5 個
- growth_points は具体的 / 行動可能であること
- carry_over は次回 session で深掘るべきテーマ 1-2 個
- interviewer_note は面接官ペルソナの語り口で)";

const char* const kJudgeInstruction = R"(あなたは面接の進行補佐です。直近の面接官の質問と受験者の回答を読み、回答の質を判定して JSON のみで返してください。

{
  "specificity": <0-3 具体性: 0=抽象的/一般論, 3=具体例・数値・本人の担当が明確>,
  "synthesis_reached": <bool 主張が十分に掘れ、統合された回答に達したか>,
  "contradiction_open": <bool 過去発言や自己評価との未解決の矛盾が残っているか>,
  "followup_hint": "<次に深掘るべき論点を1文。無ければ空文字>"
}

余計な前置きや説明は禁止。JSON のみを出力する。)";

const char* const kRefineInstruction = R"(あなたは面接設計の補佐です。 過去の面接 turn を読み、 次に面接官 (Sonnet) が
深掘りすべき論点を **1-2 文で** 返してください。

ルール:
- 候補者がまだ語っていない領域、 浅く語った領域、 矛盾していそうな領域 のいずれかを指摘
- Sonnet が即時に質問に変換できる粒度で
- 出力は本文のみ。 「次は〜」 「深掘り対象: 〜」 のような前置きは不要

例:
- 「リーダー経験と短所 (周りが見えない) の整合性を聞き直す」
- 「ジャム賞の等級を正確に確認し、 他者との貢献比率に踏み込む」
- 「『計測してから判断する』 と言ったが、 実装スピードとどう両立するかを問う」)";

const char* const kReverseQuestionRule = R"(逆質問には、この会社で働く面接官として具体的に答える。
開発体制・チーム規模・使っている技術・新人研修・評価やキャリアの道筋など、手元の資料に無いことも、
「わからない」「お答えできない」で済ませず、ゲーム会社の現場としてもっともらしい内容をその場で答える。
同じ面接の中で前に答えた内容と矛盾させない。答えた後に、質問の意図を一言返すか、次の逆質問を促す。
合否・内定・待遇の確約や、実在の人物・未公開タイトルの具体名は出さない。)";

// ---- specialist ----

namespace {

struct RoleInfo {
    const char* label;
    const char* topics;
    const char* criteria;
};

const RoleInfo* role_info(const std::string& role) {
    static const std::map<std::string, RoleInfo> roles = {
        {"planner",
         {"プランナー", "遊びの目的、ルール設計、レベル設計、難易度と経済バランス、仕様の伝達、プレイテスト",
          "狙う体験と仕様の整合、仮説の根拠、指標と観察による検証、制作制約との折り合い"}},
        {"programmer",
         {"プログラマー", "データ構造、アルゴリズム、設計、メモリと並行処理、性能計測、不具合の切り分け、テスト",
          "正確性、計算量と資源の説明、責務分割、再現と計測、境界条件と検証方法"}},
        {"designer",
         {"デザイナー", "造形と視認性、2D・3D・UIの制作工程、アニメーション、実装制約、アセット最適化、レビュー",
          "表現意図と利用場面の整合、制作工程の説明、可読性、性能予算、修正と品質確認"}},
        {"sound",
         {"サウンド", "音楽・効果音の設計、録音と編集、ミックス、インタラクティブ音響、実装、音声資源管理",
          "音の役割と演出意図、聴きやすさ、遷移と同期、音量と資源の制約、実機での検証"}},
    };
    auto it = roles.find(role);
    return it == roles.end() ? nullptr : &it->second;
}

const char* interviewer_label(const std::string& who) { return who == "senior" ? "シニア (テックリード)" : "現場エンジニア"; }
const char* interviewer_stage(const std::string& who) { return who == "senior" ? "lead-tech" : "peer-tech"; }

std::string scope(const SpecialistProfile& p) {
    const RoleInfo* role = role_info(p.role);
    return std::string("対象職種: ") + role->label + "\n経験: " +
           (p.level == "entry" ? "学生・未経験。学習や自主制作の経験を使い、実務経験を必須にしない"
                               : "実務経験者。担当範囲、制約、代替案、成果を深掘りする") +
           "\n面接官: " + interviewer_label(p.interviewer) + "\n出題領域: " + role->topics + "\n専門観点: " + role->criteria;
}

constexpr std::size_t kMaxPoints = 6;
constexpr std::size_t kMaxPointChars = 160;

std::string clip(const std::string& text) {
    // text.replace(/\s+/g, ' ').trim()
    std::string collapsed;
    bool in_space = false;
    for (char32_t cp : decode_utf8(text)) {
        if (is_js_space(cp)) {
            if (!in_space) collapsed.push_back(' ');
            in_space = true;
        } else {
            append_utf8(collapsed, cp);
            in_space = false;
        }
    }
    std::string t = js_trim(collapsed);
    if (utf16_length(t) > kMaxPointChars) return utf16_slice(t, 0, kMaxPointChars - 1) + "…";
    return t;
}

std::vector<std::string> string_list(const Json* value) {
    std::vector<std::string> out;
    if (!value || !value->is_array()) return out;
    for (const auto& v : *value) {
        if (!v.is_string() || js_trim(v.get<std::string>()).empty()) continue;
        if (out.size() >= kMaxPoints) break;
        out.push_back(clip(v.get<std::string>()));
    }
    return out;
}

}  // namespace

std::optional<SpecialistProfile> parse_specialist_profile(const Json* value) {
    if (value == nullptr) return std::nullopt;  // undefined
    if (!value->is_object()) throw std::runtime_error("invalid_specialist_interview");
    const Json* role = member(*value, "role");
    const Json* level = member(*value, "level");
    if (!role || !role->is_string() || !role_info(role->get<std::string>()) || !level || !level->is_string() ||
        (level->get<std::string>() != "entry" && level->get<std::string>() != "experienced")) {
        throw std::runtime_error("invalid_specialist_interview");
    }
    const Json* who = member(*value, "interviewer");
    // JSON に undefined は無い。キーがあれば (null を含め) 明示値として検査する。
    if (who && !(who->is_string() && (who->get<std::string>() == "field" || who->get<std::string>() == "senior"))) {
        throw std::runtime_error("invalid_specialist_interview");
    }
    SpecialistProfile p;
    p.role = role->get<std::string>();
    p.level = level->get<std::string>();
    p.interviewer = who ? who->get<std::string>() : (p.level == "entry" ? "field" : "senior");
    return p;
}

std::optional<SpecialistProfile> specialist_from_metadata(const Json& metadata) {
    Json value = metadata;
    if (metadata.is_string()) {
        auto parsed = parse_json(metadata.get<std::string>());
        if (!parsed) throw std::runtime_error("invalid metadata json");
        value = *parsed;
    }
    if (!value.is_object()) return std::nullopt;
    return parse_specialist_profile(member(value, "specialist_interview"));
}

InterviewerPersona specialist_persona(const SpecialistProfile& p) {
    InterviewerPersona out;
    out.display_name = std::string(role_info(p.role)->label) + "の" + interviewer_label(p.interviewer) + "面接官";
    out.stage = interviewer_stage(p.interviewer);
    out.role_lens = p.role;
    out.temperament = p.interviewer == "senior"
                          ? "落ち着いて全体を見る。判断の根拠、成長の仕方、チームへの効き方を確認する"
                          : "穏やかで具体的。手を動かした範囲、詰まった所、検証方法を確認する";
    out.pressure = 3;
    out.bio = "専門職の模擬面接を担当する仮想面接官。実在企業の採用担当者ではない。";
    out.evaluation_bias = Json::object();
    return out;
}

Json specialist_to_json(const SpecialistProfile& p) {
    return Json{{"role", p.role}, {"level", p.level}, {"interviewer", p.interviewer}};
}

FocusPoints fallback_focus_points(const SpecialistProfile& p, const std::optional<NewgradFocus>& newgrad) {
    const RoleInfo* role = role_info(p.role);
    std::vector<std::string> senior = {
        "判断の根拠とトレードオフ: 取り組みの中で何を選び、何を捨てたか",
        "品質と保守: 他人が触る・後から直す前提でどう作ったか",
        "学び方と伸びしろ: 新しい技術や手法をどう身につけ、どう確かめたか",
        "チームでの役割: 意見が割れたときの合意の作り方と自分の責任範囲",
    };
    if (newgrad) {
        for (const auto& t : newgrad->themes) {
            const std::string tt = js_trim(t);
            if (!tt.empty()) senior.push_back("新卒像「" + tt + "」: 自分の経験のどこにそれが表れているか");
        }
    }
    std::vector<std::string> field = {
        "担当範囲: 自分の手で作った部分と、他人・既存資産に頼った部分の切り分け",
        "道具と工程: 使ったエンジン・ツール・ワークフローと、それを選んだ理由",
        "詰まった問題: 不具合や品質問題をどう再現し、どう切り分けて直したか",
        "具体的な数字: 処理時間・容量・工数・件数など、結果を測った値",
        std::string(role->label) + "の専門領域: " + role->topics + " のうち、実際に経験したもの",
    };
    FocusPoints out;
    for (std::size_t i = 0; i < senior.size() && i < kMaxPoints; ++i) out.senior.push_back(clip(senior[i]));
    for (std::size_t i = 0; i < field.size() && i < kMaxPoints; ++i) out.field.push_back(clip(field[i]));
    return out;
}

std::string focus_points_prompt(const SpecialistProfile& p, const std::optional<NewgradFocus>& newgrad,
                                const std::string& materials) {
    const RoleInfo* role = role_info(p.role);
    std::string ng = "(企業固有データなし)";
    if (newgrad) {
        ng = newgrad->summary + "\nテーマ: " + (newgrad->themes.empty() ? std::string("(なし)") : join(newgrad->themes, " / "));
    }
    const std::string mat = js_trim(materials);
    return std::string("あなたはゲーム会社の技術面接の準備をしている。受験者の素材と、企業が求める新卒像から、\n") +
           "シニア (テックリード) と現場エンジニアがそれぞれ面接で確かめたい要点を書き出す。\n\n## 職種と経験\n職種: " +
           role->label + "\n経験: " + (p.level == "entry" ? "学生・未経験 (自主制作・学習を含めて扱う)" : "実務経験者") +
           "\n出題領域: " + role->topics + "\n専門観点: " + role->criteria + "\n\n## 企業が求める新卒像\n" + ng +
           "\n\n## 受験者の素材 (ES など)\n" + (mat.empty() ? std::string("(素材なし)") : mat) +
           "\n\n## 書き方\n- senior: 判断の根拠、トレードオフ、品質と保守、学び方と伸びしろ、チームへの効き方、新卒像との接続を見る。\n"
           "- field: 実際に手を動かした範囲、道具と工程、詰まった問題の切り分け、具体的な数字、一緒に働く場面を見る。\n- 各 " +
           std::to_string(kMaxPoints) +
           " 個以内。1 項目は「観点: ES のどの記述 / 新卒像のどのテーマについて何を確かめるか」の 1 文。\n"
           "- 素材に無い経験や数字を事実として作らない。素材が薄い所は「〜を確認する」と書く。\n"
           "- 出力は次の JSON のみ: {\"senior\": [\"...\"], \"field\": [\"...\"]}";
}

std::optional<FocusPoints> parse_focus_points(const std::string& text) {
    const auto start = text.find('{');
    const auto end = text.rfind('}');
    if (start == std::string::npos || end == std::string::npos || end <= start) return std::nullopt;
    auto raw = parse_json(std::string_view(text).substr(start, end - start + 1));
    if (!raw || !raw->is_object()) return std::nullopt;
    FocusPoints out{string_list(member(*raw, "senior")), string_list(member(*raw, "field"))};
    if (out.senior.empty() || out.field.empty()) return std::nullopt;
    return out;
}

std::string render_focus_block(const FocusPoints& points, const SpecialistProfile& p) {
    const std::string primary = p.interviewer;
    const std::string secondary = primary == "senior" ? "field" : "senior";
    auto list = [&](const std::string& who) {
        const auto& items = who == "senior" ? points.senior : points.field;
        std::vector<std::string> lines;
        for (const auto& x : items) lines.push_back("- " + x);
        return std::string("### ") + interviewer_label(who) + "が聞きたい要点\n" + join(lines, "\n");
    };
    return join({"## 聞きたい要点 (面接官の準備メモ。読み上げない)",
                 std::string("今回の面接官は") + interviewer_label(primary) +
                     "。その要点を質問の中心にし、ES の記述に当てて一つずつ確かめる。",
                 std::string(interviewer_label(secondary)) + "の要点は別の段階で扱う想定。今回は時間が余れば一つだけ扱う。",
                 list(primary), list(secondary)},
                "\n");
}

std::string specialist_question_prompt(const std::optional<SpecialistProfile>& p) {
    if (!p) return "";
    return "## 専門面接\n" + scope(*p) +
           "\n最初に専門分野と制作・学習経験を一問で確認し、回答から扱う領域を選ぶ。全領域の経験を必須にしない。\n"
           "既存の進行フェーズに従い、基礎の理解→具体的な設計・制作課題→不具合や品質問題の切り分け→検証と代替案を順に扱う。\n"
           "質問スロットや参考資料もこの職種・経験に適合させる。一度に一問。回答を受けて理由・制約・検証方法のいずれかを深掘りする。\n"
           "答えを先に教えず、詰まった場合はヒントを一つ示し、ヒント後の回答と自力の回答を区別する。\n"
           "コード実行・作品閲覧・音声試聴をしていない場合、それらを検証済みと述べない。機密のソースや未公開作品の提出を求めない。\n"
           "終結では根拠のある強みと次の練習を伝える。採用可否は断定しない。\n" +
           kReverseQuestionRule;
}

std::string specialist_evaluation_prompt(const std::optional<SpecialistProfile>& p, bool summary) {
    if (!p) return "";
    return "\n## 専門分野の講評\n" + scope(*p) +
           "\n共通6軸の定義とJSON形式は維持する。専門能力を独立した数値として捏造したり、6軸を専門点数に置き換えたりしない。\n" +
           (summary ? "interviewer_note に「専門講評」として" : "comment に「専門講評」として") +
           "、専門観点ごとの確認できた点・改善点・未確認事項を記す。根拠には実際の回答のturn番号を添える。\n"
           "未出題・未回答の専門観点は未確認とし、不正解や能力不足と断定しない。ヒント利用も明記する。\n" +
           (summary ? "growth_points と carry_over" : "hints") +
           " に、根拠のある改善点と次に取り組む具体的な練習を示す。\n"
           "実行していないコードや見ていない作品を検証済みと扱わず、採用可否を判定しない。";
}

// ---- response.ts ----

namespace {

const char* stage_label(const std::string& stage) {
    if (stage == "hr") return "人事 (1次)";
    if (stage == "peer-tech") return "技術者面接 (現場 peer)";
    if (stage == "lead-tech") return "2 次技術者面接 (部長 / テックリード)";
    if (stage == "final") return "最終面接 (社長 / 役員 / CTO)";
    return nullptr;
}

const char* pressure_label(int p) {
    switch (p) {
        case 1: return "穏やか、 相槌多め";
        case 2: return "優しめ、 軽い深掘り";
        case 3: return "中立、 反応控えめ";
        case 4: return "押し強め、 矛盾を突く";
        case 5: return "厳しい、 反論や沈黙圧を多用";
        default: return "";
    }
}

const char* const kStaticRoot = R"(あなたは LUDIARS Tirocinium 内の面接 AI です。
役柄に従って受験者に質問を投げ、 引き出す情報を増やす役回りを担当します。

ルール:
- 1 回の応答は 30-200 字を目安
- 結論先出し / 因果先出しを意識する
- 候補者を萎縮させる言葉は使わない (圧の強さで挑むが、 人格否定はしない)
- 質問を 1 turn に 1 つだけ
- 候補者の答えが薄かったら、 1 段深掘りする)";

std::string tics_line(const std::vector<std::string>& tics) {
    if (tics.empty()) return "";
    std::vector<std::string> q;
    for (const auto& t : tics) q.push_back("\"" + t + "\"");
    return "\n- 口癖: " + join(q, ", ");
}

void push_if(std::vector<std::string>& v, const std::string& s) {
    if (!s.empty()) v.push_back(s);
}

}  // namespace

std::string build_interviewer_prompt_block(const InterviewerPersona& p) {
    const std::string lens = (!p.role_lens.empty() && p.role_lens != "any") ? " (" + p.role_lens + " 志望者向け)" : "";
    const char* sl = stage_label(p.stage);
    return join({"あなたは " + p.display_name + " という面接官です。", "所属: " + p.bio,
                 "担当: " + std::string(sl ? sl : p.stage) + lens, "性格傾向: " + p.temperament,
                 "圧の強さ: " + std::to_string(p.pressure) + "/5 (" + pressure_label(p.pressure) + ")" + tics_line(p.tics),
                 "評価バイアス: " + js_stringify(p.evaluation_bias) + " (重み 1.0 を超える軸を念入りに探る)"},
                "\n");
}

std::string build_weakness_block(const std::vector<std::string>& weak_top3) {
    if (weak_top3.empty()) return "";
    return "今回の session では、 以下の軸を特に問うてください: " + join(weak_top3, ", ");
}

std::string build_system_prompt(const SystemPromptInput& in) {
    const bool dialectic = in.phase && (*in.phase == Phase::Probe || *in.phase == Phase::Pressure);
    std::vector<std::string> parts;
    parts.push_back(kStaticRoot);
    if (in.phase) parts.push_back("\n## 進行フェーズ\n" + phase_guidance(*in.phase));
    if (dialectic) parts.push_back(std::string("\n## 深掘りの型\n") + kDialecticProbe);
    if (!in.brief_md.empty()) {
        parts.push_back("\n## 面接ブリーフ\n" + in.brief_md);
        push_if(parts, specialist_question_prompt(in.specialist));
        if (!in.focus_block.empty()) parts.push_back("\n" + in.focus_block);
        if (!in.refine_block.empty()) parts.push_back("\n## 次に深掘るべき論点\n" + in.refine_block);
        return join(parts, "\n");
    }
    // 空文字 ('') は filter(Boolean) で落ちる。
    push_if(parts, build_interviewer_prompt_block(in.interviewer));
    push_if(parts, specialist_question_prompt(in.specialist));
    if (!in.focus_block.empty()) parts.push_back("\n" + in.focus_block);
    if (!in.weak_top3.empty()) parts.push_back("\n" + build_weakness_block(in.weak_top3));
    if (!in.rag_block.empty()) parts.push_back("\n## 参考素材\n" + in.rag_block);
    if (!in.refine_block.empty()) parts.push_back("\n## 次に深掘るべき論点\n" + in.refine_block);
    return join(parts, "\n");
}

std::string render_slot_block(const Json& slot) {
    std::vector<std::string> followups;
    if (const Json* f = member(slot, "followups"); f && f->is_array()) {
        for (const auto& x : *f) followups.push_back(x.is_string() ? x.get<std::string>() : js_stringify(x));
    }
    std::vector<std::string> axes;
    if (const Json* a = member(slot, "axes"); a && a->is_array()) {
        for (const auto& x : *a) axes.push_back(x.is_string() ? x.get<std::string>() : js_stringify(x));
    }
    const std::string fu = followups.empty() ? "" : "\n深掘り候補 (回答が浅い時に使う): " + join(followups, " / ");
    return join({"## 今回の質問スロット", "テーマ: " + string_or(slot, "theme"), "質問の種: " + string_or(slot, "question"),
                 "測る軸: " + join(axes, ", ") + fu, "この意図を、あなたのペルソナの口調で自然な質問 1 つに整形して発話する。"},
                "\n");
}

// ---- persona/prompt.ts ----

namespace {

std::vector<std::string> str_array(const Json& row, const char* key) {
    std::vector<std::string> out;
    if (const Json* v = member(row, key); v && v->is_array()) {
        for (const auto& x : *v) {
            if (x.is_string()) out.push_back(x.get<std::string>());
        }
    }
    return out;
}

std::string num_text(const Json& v) { return v.is_string() ? v.get<std::string>() : js_stringify(v); }

}  // namespace

std::string interviewer_to_system_prompt(const Json& p) {
    const std::string lens = string_or(p, "role_lens") == "any" ? "" : " (" + string_or(p, "role_lens") + " 志望者向け)";
    const auto tics = str_array(p, "tics");
    const int pressure = p.contains("pressure") && p["pressure"].is_number() ? p["pressure"].get<int>() : 0;
    const char* sl = stage_label(string_or(p, "stage"));
    return join({"あなたは " + string_or(p, "display_name") + " という面接官です。", "所属背景: " + string_or(p, "bio"),
                 "担当する面接タイプ: " + std::string(sl ? sl : string_or(p, "stage")) + lens,
                 "性格傾向: " + string_or(p, "temperament"),
                 "圧の強さ: " + num_text(p.value("pressure", Json(nullptr))) + "/5 (" + pressure_label(pressure) + ")" +
                     tics_line(tics),
                 "評価バイアス: " + js_stringify(p.value("evaluation_bias", Json::object())),
                 "- 重みが高い軸 (>1.0) は念入りに探る。 低い軸 (<1.0) は深掘り頻度を下げる。"},
                "\n");
}

std::string examinee_to_system_prompt(const Json& p) {
    static const std::map<std::string, std::string> speech = {
        {"formal", "丁寧で慎重、 結論まで時間がかかる"},
        {"casual", "砕けた口調、 思ったまま喋る"},
        {"nervous", "緊張で言葉に詰まる、 沈黙が出やすい"},
        {"verbose", "言葉が多く、 結論より背景説明が先に出る"},
    };
    std::vector<std::string> weak;
    if (const Json* w = member(p, "weakness_axes"); w && w->is_object()) {
        for (auto it = w->begin(); it != w->end(); ++it) weak.push_back(it.key() + ": " + num_text(it.value()));
    }
    const std::string style = string_or(p, "speech_style");
    auto sp = speech.find(style);
    const auto strengths = str_array(p, "strengths");
    const auto flaws = str_array(p, "intentional_flaws");
    std::vector<std::string> lines = {"あなたは " + string_or(p, "display_name") + " という面接候補者を演じます。",
                                      "背景: " + string_or(p, "background"), "志望: " + string_or(p, "target_role"),
                                      "話し方: " + (sp != speech.end() ? sp->second : style)};
    if (!strengths.empty()) lines.push_back("得意分野: " + join(strengths, ", "));
    if (!weak.empty()) lines.push_back("意図的な弱い軸 (0-5、 大きいほど弱い): " + join(weak, ", "));
    if (!flaws.empty()) lines.push_back("顕在化する癖:\n- " + join(flaws, "\n- "));
    // '' (空行) は filter(Boolean) で落ちる。
    lines.push_back("ルール:");
    lines.push_back("- 質問に答える時、 弱い軸では「結論先出しが弱い」 「具体例が薄い」 等の癖を再現");
    lines.push_back("- 強い分野では明瞭に答えてよい");
    lines.push_back("- 経歴・経験は背景の範囲内で創作。 ハルシネーション禁止");
    return join(lines, "\n");
}

}  // namespace tr::llm
