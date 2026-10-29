// 互換性テスト: Node 実装の純関数に合成データを入れた入出力 (fixtures/golden_pure.json、
// native/tools/golden/record_pure.mjs が作る) と、C++ 実装の出力が一致することを確かめる。
#include <cstdlib>
#include <fstream>
#include <map>
#include <sstream>

#include "check.hpp"
#include "core/domain/domain.hpp"
#include "core/encoding.hpp"
#include "core/llm/engine.hpp"
#include "core/llm/output.hpp"
#include "core/llm/prompts.hpp"
#include "core/text.hpp"
#include "core/time.hpp"

using namespace tr;
using trtest::check;

namespace {

Json load_fixture() {
    const char* d = std::getenv("TR_FIXTURES");
    std::ifstream in(std::string(d ? d : "fixtures") + "/golden_pure.json");
    std::stringstream ss;
    ss << in.rdbuf();
    JsonLimits limits;
    limits.max_bytes = 64 * 1024 * 1024;
    limits.max_elements = 10'000'000;
    auto v = parse_json(ss.str(), limits);
    if (!v) throw std::runtime_error("fixture missing or invalid");
    return *v;
}

std::vector<std::string> strs(const Json& a) {
    std::vector<std::string> out;
    if (a.is_array()) {
        for (const auto& x : a) out.push_back(x.get<std::string>());
    }
    return out;
}

llm::InterviewerPersona persona_of(const Json& j) {
    llm::InterviewerPersona p;
    p.display_name = string_or(j, "display_name");
    p.stage = string_or(j, "stage");
    p.role_lens = string_or(j, "role_lens");
    p.temperament = string_or(j, "temperament");
    p.pressure = j.value("pressure", 3);
    p.tics = strs(j.value("tics", Json::array()));
    p.bio = string_or(j, "bio");
    p.evaluation_bias = j.value("evaluation_bias", Json::object());
    return p;
}

std::optional<llm::SpecialistProfile> specialist_of(const Json* j) {
    if (!j || j->is_null()) return std::nullopt;
    return llm::SpecialistProfile{string_or(*j, "role"), string_or(*j, "level"), string_or(*j, "interviewer")};
}

Json persona_json(const llm::InterviewerPersona& p) {
    return Json{{"display_name", p.display_name}, {"stage", p.stage},       {"role_lens", p.role_lens},
                {"temperament", p.temperament},   {"pressure", p.pressure}, {"tics", p.tics},
                {"bio", p.bio},                   {"evaluation_bias", p.evaluation_bias}};
}

Json phase_json(const llm::PhaseState& s) {
    return Json{{"phase", llm::phase_name(s.phase)},
                {"phaseTurnNo", s.phase_turn_no},
                {"turnBudget", s.turn_budget},
                {"personaPressure", s.persona_pressure}};
}

llm::PhaseState phase_of(const Json& j) {
    llm::PhaseState s;
    s.phase = *llm::phase_from_name(j["phase"].get<std::string>());
    s.phase_turn_no = j["phaseTurnNo"].get<int>();
    s.turn_budget = j["turnBudget"].get<int>();
    s.persona_pressure = j["personaPressure"].get<int>();
    return s;
}

Json focus_json(const llm::FocusPoints& p) { return Json{{"senior", p.senior}, {"field", p.field}}; }

llm::FocusPoints focus_of(const Json& j) { return {strs(j["senior"]), strs(j["field"])}; }

std::vector<llm::Turn> turns_of(const Json& a) {
    std::vector<llm::Turn> out;
    for (const auto& t : a) out.push_back({t["turn_no"].get<int>(), t["role"].get<std::string>(), t["text"].get<std::string>()});
    return out;
}

// 1 ケースを C++ で計算する。Node が例外だったケースは C++ も例外であること。
Json run_case(const std::string& fn, const Json& in) {
    if (fn == "mulberry32") {
        auto r = llm::mulberry32(in["seed"].get<std::uint32_t>());
        Json out = Json::array();
        for (int i = 0; i < in["n"].get<int>(); ++i) out.push_back(r());
        return out;
    }
    if (fn == "shuffled") {
        std::vector<Json> items(in["items"].begin(), in["items"].end());
        return llm::shuffled(items, llm::mulberry32(in["seed"].get<std::uint32_t>()));
    }
    if (fn == "nextPhase") {
        llm::PhaseSignals sig{in["signals"]["synthesisReached"].get<bool>(), in["signals"]["contradictionOpen"].get<bool>()};
        return phase_json(llm::next_phase(phase_of(in["state"]), sig));
    }
    if (fn == "compileQuestionPlan") {
        llm::PlanBrief b;
        b.stage = in["brief"]["stage"];
        b.candidates.assign(in["brief"]["candidates"].begin(), in["brief"]["candidates"].end());
        return llm::compile_question_plan(b, strs(in["weakTop3"]), llm::mulberry32(in["seed"].get<std::uint32_t>()));
    }
    if (fn == "nextSlot") {
        std::vector<Json> plan(in["plan"].begin(), in["plan"].end());
        std::map<std::string, int> cursor;
        for (auto it = in["cursor"].begin(); it != in["cursor"].end(); ++it) cursor[it.key()] = it.value().get<int>();
        auto s = llm::next_slot(plan, *llm::phase_from_name(in["phase"].get<std::string>()), cursor);
        return s ? *s : Json(nullptr);
    }
    if (fn == "selectTechnicalTopic") {
        return llm::select_technical_topic(in["role"], in["level"], strs(in["seen"]),
                                           llm::mulberry32(in["seed"].get<std::uint32_t>()));
    }
    if (fn == "canonicalRole") {
        return llm::canonical_role(in.is_null() ? std::nullopt : std::optional<std::string>(in.get<std::string>()));
    }
    if (fn == "expandTerms") return llm::expand_terms(strs(in));
    if (fn == "splitKeywords") return llm::split_keywords(in.get<std::string>());
    if (fn == "buildInterviewerPromptBlock") return llm::build_interviewer_prompt_block(persona_of(in));
    if (fn == "buildWeaknessBlock") return llm::build_weakness_block(strs(in));
    if (fn == "buildSystemPrompt") {
        llm::SystemPromptInput p;
        p.interviewer = persona_of(in["interviewer"]);
        p.specialist = specialist_of(member(in, "specialist"));
        if (in.contains("weakTop3")) p.weak_top3 = strs(in["weakTop3"]);
        p.rag_block = string_or(in, "ragBlock");
        p.refine_block = string_or(in, "refineBlock");
        if (in.contains("phase")) p.phase = llm::phase_from_name(in["phase"]);
        p.brief_md = string_or(in, "briefMd");
        p.focus_block = string_or(in, "focusBlock");
        return llm::build_system_prompt(p);
    }
    if (fn == "renderSlotBlock") return llm::render_slot_block(in);
    if (fn == "parseSpecialistProfile") {
        const bool undefined = in.is_string() && in.get<std::string>() == "__undefined__";
        auto p = llm::parse_specialist_profile(undefined ? nullptr : &in);
        return p ? llm::specialist_to_json(*p) : Json("__undefined__");
    }
    if (fn == "specialistPersona") return persona_json(llm::specialist_persona(*specialist_of(&in)));
    if (fn == "specialistQuestionPrompt") return llm::specialist_question_prompt(specialist_of(&in));
    if (fn == "specialistEvaluationPrompt") {
        return llm::specialist_evaluation_prompt(specialist_of(&in["profile"]), in["summary"].get<bool>());
    }
    auto newgrad_of = [](const Json& j) -> std::optional<llm::NewgradFocus> {
        if (j.is_null()) return std::nullopt;
        return llm::NewgradFocus{j["summary"], strs(j["themes"])};
    };
    if (fn == "fallbackFocusPoints") return focus_json(llm::fallback_focus_points(*specialist_of(&in["profile"]), newgrad_of(in["newgrad"])));
    if (fn == "focusPointsPrompt") {
        return llm::focus_points_prompt(*specialist_of(&in["profile"]), newgrad_of(in["newgrad"]), in["materials"]);
    }
    if (fn == "parseFocusPoints") {
        auto p = llm::parse_focus_points(in.get<std::string>());
        return p ? focus_json(*p) : Json(nullptr);
    }
    if (fn == "renderFocusBlock") return llm::render_focus_block(focus_of(in["points"]), *specialist_of(&in["profile"]));
    if (fn == "serializeHistory") return llm::serialize_history(turns_of(in));
    if (fn == "extractJsonBlock") return llm::extract_json_block(in.get<std::string>());
    if (fn == "parseEvaluation") {
        auto e = llm::parse_evaluation(in.get<std::string>());
        return Json{{"axes", e.axes}, {"comment", e.comment}, {"hints", e.hints}};
    }
    if (fn == "parseAnswerSignals") {
        auto s = llm::parse_answer_signals(in.get<std::string>());
        return Json{{"specificity", s.specificity},
                    {"synthesisReached", s.synthesis_reached},
                    {"contradictionOpen", s.contradiction_open},
                    {"followupHint", s.followup_hint ? Json(*s.followup_hint) : Json("__undefined__")}};
    }
    if (fn == "coerceFocus") {
        auto f = llm::coerce_focus(in);
        return f ? Json(*f) : Json("__null__");
    }
    if (fn == "averageAxes") return llm::average_axes(std::vector<Json>(in.begin(), in.end()));
    if (fn == "parseSummary") return llm::parse_summary(in.get<std::string>());
    if (fn == "parseInterviewerOutput") return llm::parse_interviewer_output(in["model"], in["stdout"]);
    if (fn == "applyEvaluationToProfile") return domain::apply_evaluation_to_profile(in["cur"], in["axes"], strs(in["hints"]));
    if (fn == "decideActionsFor") {
        const Json& r = in["reservation"];
        domain::ReservationRow row{r["id"], r["user_id"], *parse_iso_ms(r["slot_start"].get<std::string>()), r["status"],
                                   r["notify_sent"].get<bool>()};
        Json out = Json::array();
        for (const auto& a : domain::decide_actions_for(row, *parse_iso_ms(in["now"].get<std::string>()),
                                                        in["noShowTimeoutMin"], in["notifyLeadMin"], 30)) {
            out.push_back(Json{{"kind", a.kind}, {"id", row.id}, {"leadMin", a.kind == "notify_lead" ? Json(a.lead_min) : Json(nullptr)}});
        }
        return out;
    }
    if (fn == "currentSlotStart") return iso_from_ms(domain::current_slot_start(*parse_iso_ms(in.get<std::string>()), 30));
    if (fn == "nextSlotStart") return iso_from_ms(domain::next_slot_start(*parse_iso_ms(in.get<std::string>()), 30));
    if (fn == "interviewerToSystemPrompt") return llm::interviewer_to_system_prompt(in);
    if (fn == "examineeToSystemPrompt") return llm::examinee_to_system_prompt(in);
    if (fn == "assessSufficiency") {
        return domain::assess_sufficiency(in["companyResolved"], in["hasNewgradImage"], in["companyQuestionCount"],
                                          in["obPatternCount"]);
    }
    if (fn == "newgradThemeCandidates") return domain::newgrad_theme_candidates(strs(in));
    if (fn == "companyQuestionCandidates") {
        const Json* profile = in["profile"].is_null() ? nullptr : &in["profile"];
        const std::optional<std::string> name =
            in["companyName"].is_null() ? std::nullopt : std::optional<std::string>(in["companyName"].get<std::string>());
        Json r = domain::company_question_candidates(name, profile, in["ai"]);
        return Json{{"profileSnapshot", r["profileSnapshot"]}, {"candidates", r["candidates"]}};
    }
    if (fn == "planBriefFromSourceMeta") {
        auto p = domain::plan_brief_from_source_meta(in);
        return p ? *p : Json("__null__");
    }
    if (fn == "parseMaterialUpload") {
        Json raw = in;
        if (raw.is_object() && raw.contains("data_base64") && raw["data_base64"].is_string()) {
            const std::string d = raw["data_base64"];
            if (starts_with(d, "A*")) raw["data_base64"] = std::string(std::stoul(d.substr(2)), 'A');
        }
        auto r = domain::parse_material_upload(&raw);
        if (auto* err = std::get_if<std::string>(&r)) return *err;
        const auto& up = std::get<domain::MaterialUpload>(r);
        return Json{{"kind", up.kind}, {"mime", up.mime}, {"extension", up.extension}, {"bytes_base64", base64_encode(up.bytes)}};
    }
    if (fn == "normalizeDigest") {
        auto d = domain::normalize_digest(in.get<std::string>());
        return d ? Json(*d) : Json("__null__");
    }
    if (fn == "buildReaderPrompt") return domain::build_reader_prompt(in["skill"], in["kind"], in["file"]);
    if (fn == "renderMaterialBrief") return domain::render_material_brief(in["interviewerSkill"], in["digest"]);
    if (fn == "stripFrontmatter") return domain::strip_frontmatter(in.get<std::string>());
    if (fn == "parseDiscordCommand") {
        auto c = domain::parse_discord_command(in["content"], in["prefix"]);
        if (c.kind == "start") return Json{{"kind", "start"}, {"mode", c.mode}, {"target", c.target}};
        return Json{{"kind", c.kind}};
    }
    if (fn == "renderDiscordHelp") return domain::render_discord_help(in.get<std::string>());
    if (fn == "chunkContent") {
        std::string content = in.get<std::string>();
        if (starts_with(content, "len:")) return Json("__skip__");  // 長い入力は別の単体テストで確かめる
        Json out = Json::array();
        for (const auto& c : domain::chunk_content(content)) {
            out.push_back(Json{{"len", utf16_length(c)}, {"head", utf16_slice(c, 0, 2)},
                               {"tail", utf16_slice(c, utf16_length(c) >= 2 ? utf16_length(c) - 2 : 0, utf16_length(c))}});
        }
        return out;
    }
    if (fn == "normalizeName") return domain::normalize_name(in.get<std::string>());
    throw std::runtime_error("unknown fn " + fn);
}

}  // namespace

TEST_CASE("golden: Node pure functions and the C++ port give identical outputs") {
    const Json fx = load_fixture();
    int compared = 0;
    int mismatched = 0;
    std::string first_failures;
    for (const auto& c : fx["cases"]) {
        const std::string fn = c["fn"];
        const Json& input = c["input"];
        const bool node_error = c.contains("error");
        try {
            Json got = run_case(fn, input);
            if (got.is_string() && got.get<std::string>() == "__skip__") continue;
            ++compared;
            if (node_error) {
                ++mismatched;
                if (first_failures.size() < 4000) first_failures += "\n  [" + fn + "] node threw (" + c["error"].get<std::string>() + ") but C++ returned " + js_stringify(got).substr(0, 200);
            } else if (!(got == c["output"])) {
                ++mismatched;
                if (first_failures.size() < 4000) {
                    first_failures += "\n  [" + fn + "] input=" + js_stringify(input).substr(0, 160) +
                                      "\n     node=" + js_stringify(c["output"]).substr(0, 400) +
                                      "\n     c++ =" + js_stringify(got).substr(0, 400);
                }
            }
        } catch (const std::exception& e) {
            ++compared;
            if (!node_error) {
                ++mismatched;
                if (first_failures.size() < 4000) first_failures += "\n  [" + fn + "] C++ threw: " + e.what() + " input=" + js_stringify(input).substr(0, 160);
            }
        }
    }
    std::cout << "golden cases compared: " << compared << '\n';
    check(compared > 500, "fixture has the expected number of cases");
    check(mismatched == 0, std::to_string(mismatched) + " mismatches:" + first_failures);
}

TEST_CASE("chunkContent (C++ only): long input splits at 1900 UTF-16 units and never splits a surrogate pair") {
    auto chunks = domain::chunk_content(std::string(3 * 1900 + 5, 'a'));
    check(chunks.size() == 4 && chunks.back().size() == 5, "4 chunks");
    auto astral = domain::chunk_content(std::string(1899, 'a') + "😀b");
    check(astral.size() == 2 && utf16_length(astral[0]) == 1899 && astral[1] == "😀b",
          "pair moved whole to the next chunk (Node splits it into lone surrogates)");
}

TEST_MAIN()
