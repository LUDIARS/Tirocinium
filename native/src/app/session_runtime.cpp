#include "app/session_runtime.hpp"

#include <algorithm>
#include <cmath>

#include "app/companies_repo.hpp"
#include "app/interview_repo.hpp"
#include "app/memoria.hpp"
#include "core/domain/domain.hpp"
#include "core/text.hpp"

namespace tr::app {

namespace {

constexpr int kEvalEveryNTurns = 5;

std::optional<std::string> env_get(const Services& s, const std::string& k) {
    for (const auto& [key, v] : s.env) {
        if (key == k) return v;
    }
    return std::nullopt;
}

double to_uint32(double n) {
    // ToUint32 (>>> 0)
    if (!std::isfinite(n)) return 0;
    double t = std::trunc(n);
    double m = std::fmod(t, 4294967296.0);
    if (m < 0) m += 4294967296.0;
    return m;
}

}  // namespace

std::optional<PhaseProgress> as_phase_progress(const Json* v) {
    if (!v || !v->is_object()) return std::nullopt;
    const Json* phase = member(*v, "phase");
    const Json* turn = member(*v, "phaseTurnNo");
    const Json* budget = member(*v, "turnBudget");
    if (!phase || !phase->is_string() || !turn || !turn->is_number() || !budget || !budget->is_number()) return std::nullopt;
    auto p = llm::phase_from_name(phase->get<std::string>());
    if (!p) return std::nullopt;  // Node 版は任意の文字列を Phase として受けていた (未知の phase は扱えないので縮退)
    PhaseProgress out{*p, static_cast<int>(turn->get<double>()), static_cast<int>(budget->get<double>()), {}};
    if (const Json* c = member(*v, "planCursor"); c && c->is_object()) {
        for (auto it = c->begin(); it != c->end(); ++it) {
            if (it.value().is_number()) out.plan_cursor[it.key()] = static_cast<int>(it.value().get<double>());
        }
    }
    return out;
}

SeedResolution resolve_session_seed(const Json* raw) {
    if (raw && !raw->is_null()) {
        const double n = llm::js_to_number(*raw);
        if (std::isfinite(n)) return {static_cast<std::uint32_t>(to_uint32(n)), false};
    }
    return {llm::new_session_seed(), true};
}

SessionRuntime::SessionRuntime(std::shared_ptr<FrameSink> sink, std::string session_id, std::string user_id, RuntimeDeps deps)
    : sink_(std::move(sink)), session_id_(std::move(session_id)), user_id_(std::move(user_id)), deps_(std::move(deps)),
      s_(*deps_.services) {
    plan_enabled_ = env_get(s_, "TIROCINIUM_QUESTION_PLAN").value_or("") != "0";
}

void SessionRuntime::send(const Json& frame) {
    if (!sink_->is_open()) return;
    sink_->send(js_stringify(frame));
}

void SessionRuntime::init() {
    auto rows = s_.db.query("SELECT metadata, llm_profile, target_company, target_role FROM sessions WHERE id = $1", {session_id_});
    if (rows.empty()) {
        send(Json{{"kind", "system"}, {"code", "error"}, {"message", "session not found"}});
        sink_->close();
        return;
    }
    const Json metadata = as_object(rows[0]["metadata"]);
    const std::optional<std::string> target_company =
        rows[0]["target_company"].is_string() ? std::optional<std::string>(rows[0]["target_company"].get<std::string>()) : std::nullopt;
    const std::optional<std::string> target_role =
        rows[0]["target_role"].is_string() ? std::optional<std::string>(rows[0]["target_role"].get<std::string>()) : std::nullopt;
    specialist_ = llm::specialist_from_metadata(metadata);
    const auto interviewer_id = optional_string(metadata, "interviewer_id");
    if (specialist_) {
        interviewer_ = llm::specialist_persona(*specialist_);
    } else if (interviewer_id) {
        if (auto p = get_interviewer(s_.db, *interviewer_id)) {
            llm::InterviewerPersona ip;
            ip.display_name = string_or(*p, "display_name");
            ip.stage = string_or(*p, "stage");
            ip.role_lens = string_or(*p, "role_lens");
            ip.temperament = string_or(*p, "temperament");
            ip.pressure = (*p)["pressure"].is_number() ? (*p)["pressure"].get<int>() : 3;
            if ((*p)["tics"].is_array()) {
                for (const auto& t : (*p)["tics"]) {
                    if (t.is_string()) ip.tics.push_back(t);
                }
            }
            ip.bio = string_or(*p, "bio");
            ip.evaluation_bias = (*p)["evaluation_bias"].is_object() ? (*p)["evaluation_bias"] : Json::object();
            interviewer_ = ip;
        }
    }
    // 既存 turn を読み込み (再接続復元)
    for (const auto& r : s_.db.query("SELECT turn_no, role, stt_text, text_uri FROM session_turns WHERE session_id = $1 "
                                     "ORDER BY turn_no ASC",
                                     {session_id_})) {
        turns_.push_back({r["turn_no"].get<int>(), r["role"].get<std::string>(),
                          r["stt_text"].is_string() ? r["stt_text"].get<std::string>() : r["text_uri"].get<std::string>()});
    }
    current_turn_no_ = static_cast<int>(turns_.size());
    auto weak = s_.db.query("SELECT weak_top3 FROM weakness_profiles WHERE user_id = $1", {user_id_});
    if (!weak.empty() && weak[0]["weak_top3"].is_array()) {
        for (const auto& x : weak[0]["weak_top3"]) weak_top3_.push_back(x);
    }
    // Memoria RAG (MEMORIA_URL 未設定なら skip、失敗しても面接は続ける)
    if (memoria_base_url(s_)) {
        try {
            std::vector<std::string> parts;
            if (target_company && !target_company->empty()) parts.push_back(*target_company);
            if (target_role && !target_role->empty()) parts.push_back(*target_role);
            for (const auto& w : weak_top3_) {
                if (!w.empty()) parts.push_back(w);
            }
            if (interviewer_ && !interviewer_->stage.empty()) parts.push_back(interviewer_->stage);
            const std::string query = parts.empty() ? "interview practice" : join(parts, " ");
            std::optional<std::vector<std::string>> tags;
            if (interviewer_ && !interviewer_->stage.empty()) tags = std::vector<std::string>{interviewer_->stage};
            rag_block_ = render_rag_block(memoria_rag(s_, user_id_, query, {"es", "portfolio", "past_qa", "self_intro"}, tags, 6));
        } catch (const std::exception& e) {
            if (s_.log) s_.log(std::string("[ws] memoria rag failed ") + e.what());
        }
    }
    auto material = s_.materials.get(session_id_, user_id_, s_.now());
    if (material) {
        material_block_ = domain::render_material_brief(material->interviewer_skill, material->digest);
        tts_voice_ = domain::material_interview_speaker(env_get(s_, "TIROCINIUM_MATERIAL_INTERVIEW_SPEAKER"));
    }
    if (specialist_) {
        // 既定の要点は同期で用意し (Node 版も最初の onReady は await の前)、残りは背景で差し替える。
        focus_block_ = llm::render_focus_block(llm::fallback_focus_points(*specialist_, std::nullopt), *specialist_);
        std::vector<std::string> parts;
        if (!rag_block_.empty()) parts.push_back(rag_block_);
        if (material && !material->digest.empty()) parts.push_back(material->digest);
        const std::string materials = join(parts, "\n\n");
        auto self = shared_from_this();
        if (!s_.background.submit([self, target_company, materials] { self->prepare_specialist_focus(target_company, materials); })) {
            if (s_.log) s_.log("[ws] background queue full; specialist focus stays on defaults");
        }
    }
    phase_state_ = llm::initial_phase_state(interviewer_ ? interviewer_->pressure : 3);
    if (auto progress = as_phase_progress(member(metadata, "phase_progress"))) {
        phase_state_->phase = progress->phase;
        phase_state_->phase_turn_no = progress->phase_turn_no;
        phase_state_->turn_budget = progress->turn_budget;
        plan_cursor_ = progress->plan_cursor;
    }
    if (plan_enabled_ && interviewer_) {
        try {
            compile_plan(metadata, target_company, target_role);
        } catch (const std::exception& e) {
            if (s_.log) s_.log(std::string("[ws] question plan compile failed ") + e.what());
            send(Json{{"kind", "system"}, {"code", "error"}, {"message", std::string("question plan unavailable: ") + e.what()}});
        }
    }
    send(Json{{"kind", "session_ready"}, {"session_id", session_id_}, {"turn_no", current_turn_no_}});
}

void SessionRuntime::prepare_specialist_focus(std::optional<std::string> target_company, std::string materials) {
    const auto profile = *specialist_;
    std::optional<llm::NewgradFocus> newgrad;
    try {
        if (auto company = resolve_company(s_.db, target_company)) {
            if (auto img = get_newgrad_image(s_.db, company->id, profile.role)) {
                newgrad = llm::NewgradFocus{img->summary, img->themes};
                std::lock_guard lock(mu_);
                if (!closed_) focus_block_ = llm::render_focus_block(llm::fallback_focus_points(profile, newgrad), profile);
            }
        }
    } catch (const std::exception& e) {
        if (s_.log) s_.log(std::string("[ws] specialist focus newgrad lookup failed ") + e.what());
    }
    try {
        if (auto points = deps_.brain->list_focus_points(profile, newgrad, materials)) {
            std::lock_guard lock(mu_);
            if (!closed_) focus_block_ = llm::render_focus_block(*points, profile);
        }
    } catch (const std::exception& e) {
        if (s_.log) s_.log(std::string("[ws] specialist focus generation failed ") + e.what());
    }
}

void SessionRuntime::compile_plan(const Json& metadata, const std::optional<std::string>& company,
                                  const std::optional<std::string>& role) {
    if (!interviewer_) return;
    const auto [seed, is_new] = resolve_session_seed(member(metadata, "session_seed"));
    if (is_new) {
        Json merged = metadata;
        merged["session_seed"] = seed;
        s_.db.query("UPDATE sessions SET metadata = $1 WHERE id = $2", {db::JsonParam{merged}, session_id_});
    }
    auto stored = get_brief(s_.db, session_id_);
    if (!stored) {
        BriefBuildInput in;
        in.user_id = user_id_;
        in.experience_level = specialist_ ? specialist_->level : (interviewer_->stage == "lead-tech" ? "experienced" : "entry");
        in.stage = interviewer_->stage;
        in.target_company = company;
        in.target_role = role;
        in.persona_block = llm::build_interviewer_prompt_block(*interviewer_);
        in.weak_top3 = weak_top3_;
        in.seed = seed;
        auto now_iso = [this] { return iso_from_ms(s_.now()); };
        const BuiltBrief built = build_interview_brief(s_.db, s_.root, in, deps_.research, now_iso);
        stored = save_brief_if_absent(s_.db, session_id_, built.body_md, built.source_meta, seed);
        // 自動学習ループ: 企業データが薄ければ crawl を非同期投入する (面接開始は待たせない)。
        const std::string company_url = string_or(built.source_meta, "company_url");
        if (built.sufficiency_level != "rich" && !company_url.empty()) {
            const std::string name_hint = built.plan_brief.company_name.value_or("");
            if (!s_.background.submit([this_s = &s_, company_url, name_hint] {
                    try {
                        enqueue_crawl(this_s->db, company_url, name_hint, "manual", std::nullopt, "brief-gate");
                    } catch (const std::exception& e) {
                        if (this_s->log) this_s->log(std::string("[ws] brief crawl enqueue failed ") + e.what());
                    }
                })) {
                if (s_.log) s_.log("[ws] background queue full; brief crawl not enqueued");
            }
        }
    }
    // 個人データ境界: 永続化済み brief に RAG 抜粋は入っていない。この接続の取得分を in-memory で足す。
    brief_md_ = !rag_block_.empty() ? stored->body_md + "\n# " + kRagSectionTitle + " (session 限定・非永続)\n\n" + rag_block_ + "\n"
                                    : stored->body_md;
    if (!material_block_.empty()) brief_md_ += "\n" + material_block_;
    auto plan_brief = plan_brief_from_meta(stored->source_meta);
    if (!plan_brief) throw std::runtime_error("stored brief に候補 snapshot が無い (source_meta.candidates)");
    std::vector<std::string> weak;
    if (const Json* w = member(stored->source_meta, "weak_top3"); w && w->is_array()) {
        for (const auto& x : *w) {
            if (x.is_string()) weak.push_back(x);
        }
    } else {
        weak = weak_top3_;
    }
    std::vector<std::string> axes;
    for (const auto& a : weak) {
        if (llm::is_axis_key(a)) axes.push_back(a);
    }
    plan_ = llm::compile_question_plan(*plan_brief, axes, llm::mulberry32(stored->seed));
}

void SessionRuntime::on_message(const std::string& raw) {
    auto parsed = parse_json(raw, JsonLimits{8 * 1024 * 1024, 2'000'000, 32});
    if (!parsed) {
        send(Json{{"kind", "system"}, {"code", "error"}, {"message", "invalid json"}});
        return;
    }
    const Json& frame = *parsed;
    const std::string kind = frame.is_object() ? string_or(frame, "kind") : "";
    if (kind == "start_interview") {
        handle_start_interview();
    } else if (kind == "stt_final") {
        const Json* t = member(frame, "text");
        handle_user_turn(t && t->is_string() ? t->get<std::string>() : (t ? js_stringify(*t) : "undefined"));
    } else if (kind == "barge_in") {
        std::lock_guard lock(mu_);
        if (current_abort_) current_abort_->store(true);
        if (tts_abort_) tts_abort_->store(true);
    } else if (kind == "end_session") {
        handle_end();
    } else if (kind == "audio_chunk") {
        // STT (Imperativus gRPC) は C++ 版では未対応 (起動時に拒否)。STT が無い構成では受けて捨てる
        // (Node 版は STT 無しでも音声をメモリに溜め続けていた)。
    } else if (kind == "pong") {
        // keepalive
    } else {
        send(Json{{"kind", "system"}, {"code", "error"}, {"message", "unknown frame kind"}});
    }
}

void SessionRuntime::handle_user_turn(const std::string& text) {
    std::string last_question;
    int user_turn_no = 0;
    {
        std::lock_guard lock(mu_);
        for (auto it = turns_.rbegin(); it != turns_.rend(); ++it) {
            if (it->role == "interviewer") {
                last_question = it->text;
                break;
            }
        }
        current_turn_no_ += 1;
        user_turn_no = current_turn_no_;
        turns_.push_back({user_turn_no, "user", text});
    }
    persist_turn(user_turn_no, "user", text);
    send(Json{{"kind", "stt_final"}, {"text", text}, {"turn_no", user_turn_no}});
    auto response = generate_interviewer_turn();
    if (!response) return;
    if (deps_.brain->can_assess() && !js_trim(response->text).empty()) {
        try {
            std::vector<llm::Turn> recent;
            {
                std::lock_guard lock(mu_);
                const std::size_t from = turns_.size() > 4 ? turns_.size() - 4 : 0;
                recent.assign(turns_.begin() + static_cast<std::ptrdiff_t>(from), turns_.end());
            }
            const auto signals = deps_.brain->assess_answer(last_question, text, recent);
            std::lock_guard lock(mu_);
            latest_signals_ = llm::PhaseSignals{signals.synthesis_reached, signals.contradiction_open};
            if (signals.followup_hint) refine_block_ = *signals.followup_hint;
        } catch (const std::exception& e) {
            // judge 失敗は前ターンの信号を維持する縮退 (phase は time-box で進む)。
            if (s_.log) s_.log(std::string("[ws] judge failed ") + e.what());
        }
    }
    advance_interviewer_phase(response->turn_no);
}

void SessionRuntime::handle_start_interview() {
    auto response = generate_interviewer_turn();
    if (!response) return;
    advance_interviewer_phase(response->turn_no);
}

std::optional<SessionRuntime::Generated> SessionRuntime::generate_interviewer_turn() {
    if (!deps_.brain->can_compose()) {
        send(Json{{"kind", "system"}, {"code", "error"}, {"message", "llm not configured"}});
        return std::nullopt;
    }
    int turn_no = 0;
    std::shared_ptr<std::atomic<bool>> abort;
    std::optional<Json> slot;
    std::string system_prompt;
    std::vector<llm::Turn> turns;
    std::optional<llm::Phase> slot_phase;
    {
        std::lock_guard lock(mu_);
        if (!interviewer_) {
            send(Json{{"kind", "system"}, {"code", "error"}, {"message", "interviewer persona missing"}});
            return std::nullopt;
        }
        current_turn_no_ += 1;
        turn_no = current_turn_no_;
        abort = std::make_shared<std::atomic<bool>>(false);
        current_abort_ = abort;
        if (plan_ && phase_state_) {
            slot = llm::next_slot(*plan_, phase_state_->phase, plan_cursor_);
            slot_phase = phase_state_->phase;
        }
        llm::SystemPromptInput in;
        in.interviewer = *interviewer_;
        in.specialist = specialist_;
        in.weak_top3 = weak_top3_;
        in.rag_block = rag_block_;
        in.refine_block = refine_block_;
        if (phase_state_) in.phase = phase_state_->phase;
        in.brief_md = brief_md_;
        in.focus_block = focus_block_;
        system_prompt = llm::build_system_prompt(in);
        turns = turns_;
    }
    std::string acc;
    try {
        acc = deps_.brain->compose_utterance(system_prompt, turns, slot, abort.get());
        send(Json{{"kind", "response_token"}, {"token", acc}, {"turn_no", turn_no}});
        if (closed_) abort->store(true);
    } catch (const std::exception& e) {
        const std::string msg = e.what();
        if (msg != "aborted" && !abort->load()) {
            send(Json{{"kind", "system"}, {"code", "error"}, {"message", msg.empty() ? std::string("stream error") : msg}});
        }
        acc.clear();
    }
    {
        std::lock_guard lock(mu_);
        if (current_abort_ == abort) current_abort_.reset();
        if (js_trim(acc).empty()) {
            current_turn_no_ -= 1;
            return std::nullopt;
        }
        // スロットを消化 (発話が成立した時だけ進める)
        if (slot && phase_state_) plan_cursor_[llm::phase_name(phase_state_->phase)] += 1;
        turns_.push_back({turn_no, "interviewer", acc});
    }
    persist_turn(turn_no, "interviewer", acc);
    send(Json{{"kind", "response_end"}, {"turn_no", turn_no}, {"text_uri", "local:turn:" + std::to_string(turn_no)}});
    // TTS は付加経路。中断済みの turn は読み上げない。
    if (!abort->load()) {
        auto self = shared_from_this();
        if (!s_.background.submit([self, turn_no, acc] { self->run_tts_background(turn_no, acc); })) {
            if (s_.log) s_.log("[ws] background queue full; tts skipped");
        }
    }
    (void)slot_phase;
    return Generated{turn_no, acc};
}

void SessionRuntime::advance_interviewer_phase(int interviewer_turn_no) {
    bool changed = false;
    bool has_phase = false;
    {
        std::lock_guard lock(mu_);
        if (phase_state_) {
            has_phase = true;
            const auto prev = phase_state_->phase;
            phase_state_ = llm::next_phase(*phase_state_, latest_signals_);
            changed = phase_state_->phase != prev;
        }
    }
    auto self = shared_from_this();
    if (has_phase) {
        if (deps_.brain->can_refine() && changed) {
            if (!s_.background.submit([self] { self->run_refine_background(); }) && s_.log) {
                s_.log("[ws] background queue full; refine skipped");
            }
        }
        if (!s_.background.submit([self] { self->persist_phase_progress(); }) && s_.log) {
            s_.log("[ws] background queue full; phase progress not persisted");
        }
    }
    if (deps_.brain->can_evaluate() && interviewer_turn_no > 0 && interviewer_turn_no % kEvalEveryNTurns == 0) {
        if (!s_.background.submit([self, interviewer_turn_no] { self->run_evaluation_background(interviewer_turn_no); }) && s_.log) {
            s_.log("[ws] background queue full; evaluation skipped");
        }
    }
}

void SessionRuntime::persist_phase_progress() {
    Json patch;
    {
        std::lock_guard lock(mu_);
        if (!phase_state_) return;
        Json cursor = Json::object();
        for (const auto& [k, v] : plan_cursor_) cursor[k] = v;
        patch = Json{{"phase_progress",
                      {{"phase", llm::phase_name(phase_state_->phase)},
                       {"phaseTurnNo", phase_state_->phase_turn_no},
                       {"turnBudget", phase_state_->turn_budget},
                       {"planCursor", cursor}}}};
    }
    try {
        patch_session_metadata(s_.db, session_id_, patch);
    } catch (const std::exception& e) {
        if (s_.log) s_.log(std::string("[ws] phase progress persist failed ") + e.what());
    }
}

void SessionRuntime::run_refine_background() {
    try {
        std::vector<llm::Turn> turns;
        {
            std::lock_guard lock(mu_);
            turns = turns_;
        }
        auto focus = deps_.brain->refine_focus(turns);
        if (!focus) return;
        std::lock_guard lock(mu_);
        if (plan_ && phase_state_ && phase_state_->phase != llm::Phase::Ended) {
            insert_deviation_slot(*focus);
        } else {
            refine_block_ = *focus;
        }
    } catch (const std::exception& e) {
        if (s_.log) s_.log(std::string("[ws] refine error ") + e.what());
    }
}

void SessionRuntime::insert_deviation_slot(const std::string& focus) {
    if (!plan_ || !phase_state_) return;
    const auto phase = phase_state_->phase;
    if (phase == llm::Phase::Ended) return;
    const std::string name = llm::phase_name(phase);
    Json slot{{"theme", "深掘り論点 (逸脱)"}, {"question", focus}, {"followups", Json::array()}, {"axes", Json::array()},
              {"origin", "refine"}, {"phase", name}};
    const int consumed = plan_cursor_.count(name) ? plan_cursor_[name] : 0;
    int seen = 0;
    std::size_t insert_at = plan_->size();
    for (std::size_t i = 0; i < plan_->size(); ++i) {
        if (string_or((*plan_)[i], "phase") != name) continue;
        if (seen == consumed) {
            insert_at = i;
            break;
        }
        ++seen;
    }
    plan_->insert(plan_->begin() + static_cast<std::ptrdiff_t>(insert_at), slot);
}

void SessionRuntime::run_evaluation_background(int up_to) {
    try {
        const int window = std::max(0, up_to - kEvalEveryNTurns);
        std::vector<llm::Turn> slice;
        std::optional<llm::SpecialistProfile> specialist;
        {
            std::lock_guard lock(mu_);
            for (const auto& t : turns_) {
                if (t.turn_no > window && t.turn_no <= up_to) slice.push_back(t);
            }
            specialist = specialist_;
        }
        const auto ev = deps_.brain->evaluate(specialist, slice, window + 1, up_to);
        Json hints = Json::array();
        for (const auto& h : ev.hints) hints.push_back(h);
        s_.db.query(
            "INSERT INTO evaluations (session_id, turn_range, axes, comment, hints, model, method) VALUES ($1, $2, $3, $4, $5, $6, $7)",
            {session_id_, "[" + std::to_string(window + 1) + "," + std::to_string(up_to) + "]", db::JsonParam{ev.axes}, ev.comment,
             db::JsonParam{hints}, ev.model, deps_.brain->kind()});
        send(Json{{"kind", "eval"}, {"evaluation", ev.to_json()}});
        try {
            const Json updated = apply_evaluation(s_.db, user_id_, ev.axes, ev.hints);
            std::lock_guard lock(mu_);
            weak_top3_.clear();
            for (const auto& x : updated["weak_top3"]) weak_top3_.push_back(x);
        } catch (const std::exception& e) {
            if (s_.log) s_.log(std::string("[ws] weakness profile update error ") + e.what());
        }
    } catch (const std::exception& e) {
        if (s_.log) s_.log(std::string("[ws] evaluation error ") + e.what());
    }
}

void SessionRuntime::run_tts_background(int turn_no, std::string text) {
    if (!deps_.tts_over_ws || !deps_.voice || !deps_.voice->tts_enabled) return;
    std::shared_ptr<std::atomic<bool>> abort = std::make_shared<std::atomic<bool>>(false);
    std::optional<std::string> voice;
    {
        std::lock_guard lock(mu_);
        if (tts_abort_) tts_abort_->store(true);  // 直前 turn の合成は破棄 (最新発話を優先)
        tts_abort_ = abort;
        voice = tts_voice_;
    }
    try {
        for (const auto& sentence : split_sentences(text)) {
            if (abort->load() || closed_) return;
            for (const auto& chunk : voicevox_tts(*deps_.voice, s_.fetch, sentence, voice, 24000, 1, abort.get())) {
                if (abort->load() || closed_) return;
                Json pcm = Json::array();
                for (unsigned char c : chunk) pcm.push_back(static_cast<int>(c));
                send(Json{{"kind", "tts_chunk"}, {"turn_no", turn_no}, {"pcm", pcm}, {"sample_rate", 24000}, {"channels", 1}});
            }
        }
        if (!abort->load()) send(Json{{"kind", "tts_end"}, {"turn_no", turn_no}});
    } catch (const std::exception& e) {
        if (s_.log) s_.log(std::string("[ws] tts failed ") + e.what());
        send(Json{{"kind", "system"}, {"code", "error"}, {"message", std::string("tts failed: ") + e.what()}});
    }
    std::lock_guard lock(mu_);
    if (tts_abort_ == abort) tts_abort_.reset();
}

void SessionRuntime::handle_end() {
    closed_ = true;
    s_.db.query("UPDATE sessions SET status = 'ended', ended_at = now() WHERE id = $1 AND status = 'active'", {session_id_});
    s_.materials.clear(session_id_);
    send(Json{{"kind", "system"}, {"code", "closing"}});
    sink_->close();
}

void SessionRuntime::persist_turn(int turn_no, const std::string& role, const std::string& text) {
    s_.db.query(
        "INSERT INTO session_turns (session_id, turn_no, role, stt_text, text_uri, started_at) VALUES ($1, $2, $3, $4, $5, now()) "
        "ON CONFLICT (session_id, turn_no) DO NOTHING",
        {session_id_, std::int64_t{turn_no}, role, role == "user" ? db::Param(text) : db::Param(db::Null{}),
         "local:turn:" + std::to_string(turn_no)});
}

void SessionRuntime::close() {
    closed_ = true;
    std::lock_guard lock(mu_);
    if (current_abort_) current_abort_->store(true);
    if (tts_abort_) tts_abort_->store(true);
}

}  // namespace tr::app
