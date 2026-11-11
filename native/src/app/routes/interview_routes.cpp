#include "app/routes/interview_routes.hpp"

#include <algorithm>
#include <cmath>
#include <cstdio>

#include "app/interview_repo.hpp"
#include "app/materials.hpp"
#include "core/llm/engine.hpp"
#include "core/llm/output.hpp"
#include "core/llm/prompts.hpp"
#include "core/text.hpp"
#include "crypto/crypto.hpp"

namespace tr::app {

namespace {

using http::Request;
using http::Response;
using Ctx = http::Context;

Response json(const Json& v, int status = 200) { return Response::json(v, status); }
Response error(const std::string& code, int status) { return json(Json{{"error", code}}, status); }

// ---- reservations ----

void reservations(http::Router& r, Services& s) {
    r.use("/api/v1/reservations/*", s.auth.middleware());
    // GET /api/v1/reservations/slots?from=ISO&hours=24
    r.get("/api/v1/reservations/slots", [&s](Request& req, Ctx&) {
        EpochMs from = s.now();
        if (auto f = req.query("from"); f && !f->empty()) {
            auto ms = parse_iso_ms(*f);
            // new Date(不正) → toISOString が RangeError → onError (500 internal) と同じ。
            if (!ms) throw std::runtime_error("Invalid time value");
            from = *ms;
        }
        auto h = js_parse_int(req.query("hours").value_or("24"));
        long long hours = (h && *h != 0) ? *h : 24;  // parseInt(...) || 24
        hours = std::min<long long>(std::max<long long>(hours, 1), 168);
        return json(Json{{"slots", list_slots(s.db, from, static_cast<int>(hours))}});
    });
    // POST /api/v1/reservations  body: { slot_start }
    r.post("/api/v1/reservations", [&s](Request& req, Ctx& ctx) {
        auto body = read_json_body(req);
        const Json* slot = body ? member(*body, "slot_start") : nullptr;
        if (!slot || !llm::js_truthy(*slot)) return error("slot_start required", 400);
        auto ms = slot->is_string() ? parse_iso_ms(slot->get<std::string>()) : std::nullopt;
        if (slot->is_number()) ms = static_cast<EpochMs>(slot->get<double>());
        if (!ms) return json(Json{{"error", "reservation_failed"}, {"detail", "Invalid time value"}}, 500);
        try {
            return json(Json{{"id", reserve(s.db, user_id(ctx), *ms, s.config.slot_capacity)}});
        } catch (const std::exception& e) {
            const std::string msg = e.what();
            if (msg == "slot_full") return error("slot_full", 409);
            return json(Json{{"error", "reservation_failed"}, {"detail", msg}}, 500);
        }
    });
    // GET /api/v1/reservations/me
    r.get("/api/v1/reservations/me", [&s](Request&, Ctx& ctx) {
        return json(Json{{"reservations", list_my_reservations(s.db, user_id(ctx))}});
    });
    // DELETE /api/v1/reservations/:id
    r.del("/api/v1/reservations/:id", [&s](Request& req, Ctx& ctx) {
        const std::string id = req.param("id");
        if (!is_uuid(id)) return error("not_found", 404);
        try {
            cancel_reservation(s.db, id, user_id(ctx));
            return json(Json{{"ok", true}});
        } catch (const std::exception& e) {
            const std::string msg = e.what();
            if (msg == "not_found") return error("not_found", 404);
            if (msg == "cannot_cancel") return error("cannot_cancel", 409);
            return json(Json{{"error", "cancel_failed"}, {"detail", msg}}, 500);
        }
    });
}

// ---- sessions + summary ----

std::optional<Response> owner_check(Services& s, const std::string& session_id, const std::string& uid,
                                    const char* not_found_code) {
    auto rows = is_uuid(session_id) ? s.db.query("SELECT user_id FROM sessions WHERE id = $1", {session_id}) : db::Rows{};
    if (rows.empty()) return error(not_found_code, 404);
    if (rows[0]["user_id"] != uid) return error("forbidden", 403);
    return std::nullopt;
}

bool owns_active(Services& s, const std::string& id, const std::string& uid) {
    if (!is_uuid(id)) return false;
    return !s.db.query("SELECT id FROM sessions WHERE id = $1 AND user_id = $2 AND status = 'active'", {id, uid}).empty();
}

void sessions(http::Router& r, Services& s) {
    r.use("/api/v1/sessions/*", s.auth.middleware());
    // POST /api/v1/sessions — 即時開始 or 予約 offer
    r.post("/api/v1/sessions", [&s](Request& req, Ctx& ctx) {
        if (auto limited = check_session_rate(s, ctx)) return std::move(*limited);
        auto raw = read_json_body(req);
        if (!raw || !raw->is_object()) return error("invalid_session_request", 400);
        const Json& body = *raw;
        for (const char* k : {"interviewer_id", "target_company", "target_role"}) {
            if (const Json* v = member(body, k); v && !v->is_string()) return error("invalid_session_request", 400);
        }
        std::optional<llm::SpecialistProfile> specialist;
        try {
            specialist = llm::parse_specialist_profile(member(body, "specialist_interview"));
        } catch (...) {
            return error("invalid_specialist_interview", 400);
        }
        const auto interviewer_id = optional_string(body, "interviewer_id");
        const auto target_company = optional_string(body, "target_company");
        const auto target_role = optional_string(body, "target_role");
        const bool has_interviewer = interviewer_id && !interviewer_id->empty();
        if (specialist && (has_interviewer || target_role != std::optional<std::string>(specialist->role))) {
            return error("specialist_role_or_interviewer_conflict", 400);
        }
        const std::string uid = user_id(ctx);
        ensure_user(s.db, uid);
        const auto decision = try_start(s.db, uid, s.now(), s.config.slot_capacity, s.slot_duration_env);
        if (decision.kind == "start") {
            const bool any = has_interviewer || (target_company && !target_company->empty()) ||
                             (target_role && !target_role->empty());
            if (any) {
                if (has_interviewer || specialist) {
                    patch_session_metadata(s.db, decision.session_id,
                                           specialist ? Json{{"specialist_interview", llm::specialist_to_json(*specialist)}}
                                                      : Json{{"interviewer_id", *interviewer_id}});
                }
                s.db.query(
                    "UPDATE sessions SET target_company = COALESCE($1, target_company), "
                    "target_role = COALESCE($2, target_role) WHERE id = $3",
                    {target_company ? db::Param(*target_company) : db::Param(db::Null{}),
                     target_role ? db::Param(*target_role) : db::Param(db::Null{}), decision.session_id});
            }
            return json(Json{{"session_id", decision.session_id}, {"ws_url", "/api/v1/ws/session/" + decision.session_id}});
        }
        if (decision.kind == "offer") {
            const double eta = llm::js_round(static_cast<double>(decision.slot_start - s.now()) / 60000.0);
            return json(Json{{"reservation_offer",
                              {{"slot_start", iso_from_ms(decision.slot_start)},
                               {"eta_min", static_cast<std::int64_t>(eta)},
                               {"slot_duration_min", s.config.slot_duration_min}}}});
        }
        return error(decision.reason, 503);
    });
    // GET /api/v1/sessions/:id
    r.get("/api/v1/sessions/:id", [&s](Request& req, Ctx& ctx) {
        const std::string id = req.param("id");
        auto rows = is_uuid(id) ? s.db.query("SELECT id, user_id, mode, status, started_at FROM sessions WHERE id = $1", {id})
                                : db::Rows{};
        if (rows.empty()) return error("not_found", 404);
        if (rows[0]["user_id"] != user_id(ctx)) return error("forbidden", 403);
        return json(Json{{"session", rows[0]}});
    });
    // POST /api/v1/sessions/:id/call-ticket — 1 回限りの通話用 capability (WS URL に Bearer を載せない)
    r.post("/api/v1/sessions/:id/call-ticket", [&s](Request& req, Ctx& ctx) {
        if (auto limited = check_session_rate(s, ctx)) return std::move(*limited);
        const std::string id = req.param("id");
        const std::string uid = user_id(ctx);
        const bool ok = owns_active(s, id, uid);
        Response res = ok ? json(Json{{"ticket", s.call_tickets.issue(id, uid, s.now())},
                                      {"expires_in", 30},
                                      {"ws_path", "/api/v1/ws/call/" + id}})
                          : error("not_found", 404);
        res.headers.set("Cache-Control", "private, no-store");
        return res;
    });
    // POST /api/v1/sessions/:id/materials — 面接前に ES / ポートフォリオを 1 件提出する
    r.post("/api/v1/sessions/:id/materials", [&s](Request& req, Ctx& ctx) {
        if (auto limited = check_session_rate(s, ctx)) return std::move(*limited);
        if (req.body_too_large) return error("material_too_large", 413);
        const std::string id = req.param("id");
        const std::string uid = user_id(ctx);
        auto with_cache = [](Response r) {
            r.headers.set("Cache-Control", "private, no-store");
            return r;
        };
        if (!owns_active(s, id, uid)) return with_cache(error("not_found", 404));
        // 本文 (7 MiB まで) を受けた要求の予算で JSON を読む (base64 の文字列 1 つ = 要素は少ない)。
        auto raw = read_json_body(req);
        SubmitMaterialPorts ports;
        ports.log = s.log;
        ports.load_skills = [&s] { return load_interviewer_skills(consult_root(s.env, std::filesystem::current_path())); };
        ports.read = [&s](const domain::MaterialUpload& up, const std::string& skill) {
            if (!s.llm) throw std::runtime_error("llm unavailable");
            return read_material(up, skill, [&s](const std::string& p, const CliRunOptions& o) { return s.llm->run_claude(p, o); });
        };
        auto result = submit_material(s.materials, id, uid, raw ? &*raw : nullptr, ports, s.now());
        if (!result.ok) return with_cache(error(result.error, result.status));
        return with_cache(json(Json{{"ok", true}, {"kind", result.kind}, {"digest_chars", result.digest_chars}}));
    });
    // POST /api/v1/sessions/:id/end
    r.post("/api/v1/sessions/:id/end", [&s](Request& req, Ctx& ctx) {
        const std::string id = req.param("id");
        auto rows = is_uuid(id) ? s.db.query(
                                      "UPDATE sessions SET status = 'ended', ended_at = now() "
                                      "WHERE id = $1 AND user_id = $2 AND status = 'active' RETURNING id",
                                      {id, user_id(ctx)})
                                : db::Rows{};
        if (rows.empty()) return error("not_found_or_not_active", 404);
        s.materials.clear(id);
        return json(Json{{"ok", true}});
    });
    // GET/POST /api/v1/sessions/:id/summary
    r.get("/api/v1/sessions/:id/summary", [&s](Request& req, Ctx& ctx) {
        const std::string id = req.param("id");
        if (auto bad = owner_check(s, id, user_id(ctx), "session_not_found")) return std::move(*bad);
        auto sum = get_summary(s.db, id);
        if (!sum) return error("summary_not_yet_generated", 404);
        return json(Json{{"summary", *sum}});
    });
    r.post("/api/v1/sessions/:id/summary", [&s](Request& req, Ctx& ctx) {
        const std::string id = req.param("id");
        if (auto bad = owner_check(s, id, user_id(ctx), "session_not_found")) return std::move(*bad);
        try {
            const std::string result = generate_summary_for_session(s, id);
            if (result == "anthropic_api_key_missing") return error("llm_not_configured", 503);
            if (result == "no_turns") return error("no_turns_to_summarize", 409);
            if (result != "ok") return json(Json{{"error", "generation_failed"}, {"detail", result}}, 500);
            auto sum = get_summary(s.db, id);
            return json(Json{{"summary", sum ? *sum : Json(nullptr)}});
        } catch (const std::exception& e) {
            return json(Json{{"error", "generation_failed"}, {"detail", std::string(e.what())}}, 500);
        }
    });
}

// ---- personas ----

bool truthy_field(const Json& body, const char* k) {
    const Json* v = member(body, k);
    return v && llm::js_truthy(*v);
}

Json or_default(const Json& body, const char* k, Json fallback) {
    const Json* v = member(body, k);
    return (!v || v->is_null()) ? fallback : *v;
}

Response create_failed(const db::DbError& e) {
    const std::string msg = e.what();
    if (e.sqlstate() == "23505" || msg.find("duplicate key") != std::string::npos) return error("id_exists", 409);
    return json(Json{{"error", "create_failed"}, {"detail", msg}}, 500);
}

void personas(http::Router& r, Services& s) {
    r.use("/api/v1/personas/*", s.auth.middleware());
    r.get("/api/v1/personas/interviewers", [&s](Request& req, Ctx&) {
        return json(Json{{"personas", list_interviewers(s.db, req.query("stage"), req.query("role_lens"),
                                                        req.query("temperament"))}});
    });
    r.get("/api/v1/personas/interviewers/:id", [&s](Request& req, Ctx&) {
        auto p = get_interviewer(s.db, req.param("id"));
        return p ? json(Json{{"persona", *p}}) : error("not_found", 404);
    });
    r.post("/api/v1/personas/interviewers", [&s](Request& req, Ctx&) {
        auto body = read_json_body(req);
        if (!body || !body->is_object() || !truthy_field(*body, "id") || !truthy_field(*body, "display_name") ||
            !truthy_field(*body, "stage") || !truthy_field(*body, "temperament")) {
            return error("missing_required_fields", 400);
        }
        const Json& b = *body;
        try {
            auto rows = s.db.query(
                "INSERT INTO interviewer_personas (id, display_name, stage, role_lens, temperament, pressure, tics, bio, "
                "evaluation_bias, is_seed) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, false) RETURNING *",
                {param_from_json(b["id"]), param_from_json(b["display_name"]), param_from_json(b["stage"]),
                 param_from_json(or_default(b, "role_lens", "any")), param_from_json(b["temperament"]),
                 param_from_json(or_default(b, "pressure", nullptr)), param_from_json(or_default(b, "tics", Json::array())),
                 param_from_json(or_default(b, "bio", nullptr)),
                 db::JsonParam{or_default(b, "evaluation_bias", Json::object())}});
            return json(Json{{"persona", rows.at(0)}}, 201);
        } catch (const db::DbError& e) {
            return create_failed(e);
        }
    });
    r.get("/api/v1/personas/examinees", [&s](Request& req, Ctx&) {
        return json(Json{{"personas", list_examinees(s.db, req.query("target_role"))}});
    });
    r.get("/api/v1/personas/examinees/:id", [&s](Request& req, Ctx&) {
        auto p = get_examinee(s.db, req.param("id"));
        return p ? json(Json{{"persona", *p}}) : error("not_found", 404);
    });
    r.post("/api/v1/personas/examinees", [&s](Request& req, Ctx&) {
        auto body = read_json_body(req);
        if (!body || !body->is_object() || !truthy_field(*body, "id") || !truthy_field(*body, "display_name") ||
            !truthy_field(*body, "background") || !truthy_field(*body, "target_role") ||
            !truthy_field(*body, "speech_style")) {
            return error("missing_required_fields", 400);
        }
        const Json& b = *body;
        try {
            auto rows = s.db.query(
                "INSERT INTO examinee_personas (id, display_name, background, target_role, weakness_axes, strengths, "
                "speech_style, intentional_flaws, bio, is_seed) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, false) "
                "RETURNING *",
                {param_from_json(b["id"]), param_from_json(b["display_name"]), param_from_json(b["background"]),
                 param_from_json(b["target_role"]), db::JsonParam{or_default(b, "weakness_axes", Json::object())},
                 param_from_json(or_default(b, "strengths", Json::array())), param_from_json(b["speech_style"]),
                 param_from_json(or_default(b, "intentional_flaws", Json::array())),
                 param_from_json(or_default(b, "bio", nullptr))});
            return json(Json{{"persona", rows.at(0)}}, 201);
        } catch (const db::DbError& e) {
            return create_failed(e);
        }
    });
}

// ---- feedback / ft-runs / training ----

void feedback(http::Router& r, Services& s) {
    r.use("/api/v1/feedback/*", s.auth.middleware());
    static const std::vector<std::string> kinds = {"summary_block", "growth_hint", "rag_ref", "ai_critique", "evaluation_axis"};
    static const std::vector<std::string> actions = {"accept", "reject", "edit", "skip"};
    r.post("/api/v1/feedback", [&s](Request& req, Ctx& ctx) {
        auto body = read_json_body(req);
        if (!body || !body->is_object() || !truthy_field(*body, "target_kind") || !truthy_field(*body, "target_id") ||
            !truthy_field(*body, "action")) {
            return error("missing_required_fields", 400);
        }
        const Json& b = *body;
        const std::string kind = b["target_kind"].is_string() ? b["target_kind"].get<std::string>() : "";
        if (std::find(kinds.begin(), kinds.end(), kind) == kinds.end()) return error("invalid_target_kind", 400);
        const std::string action = b["action"].is_string() ? b["action"].get<std::string>() : "";
        if (std::find(actions.begin(), actions.end(), action) == actions.end()) return error("invalid_action", 400);
        const Json* payload = member(b, "edit_payload");
        const Json* reason = member(b, "reason");
        auto rows = s.db.query(
            "INSERT INTO human_feedback (user_id, target_kind, target_id, action, edit_payload, reason) "
            "VALUES ($1, $2, $3, $4, $5, $6) RETURNING *",
            {user_id(ctx), kind, param_from_json(b["target_id"]), action,
             payload ? db::Param(db::JsonParam{*payload}) : db::Param(db::Null{}),
             reason ? param_from_json(*reason) : db::Param(db::Null{})});
        return json(Json{{"feedback", rows.at(0)}}, 201);
    });
    r.get("/api/v1/feedback", [&s](Request& req, Ctx& ctx) {
        const auto sid = req.query("session_id");
        if (sid && !sid->empty()) {
            return json(Json{{"feedback", s.db.query("SELECT * FROM human_feedback WHERE user_id = $1 AND "
                                                     "(target_id = $2 OR target_id LIKE $3) ORDER BY created_at DESC",
                                                     {user_id(ctx), *sid, *sid + ":%"})}});
        }
        return json(Json{{"feedback", s.db.query("SELECT * FROM human_feedback WHERE user_id = $1 ORDER BY created_at DESC "
                                                 "LIMIT $2",
                                                 {user_id(ctx), std::int64_t{100}})}});
    });
}

void ft_runs(http::Router& r, Services& s) {
    r.use("/api/v1/ft-runs/*", s.auth.middleware());
    r.get("/api/v1/ft-runs/:id", [&s](Request& req, Ctx&) {
        const std::string id = req.param("id");
        auto rows = is_uuid(id) ? s.db.query("SELECT * FROM ft_loop_runs WHERE id = $1", {id}) : db::Rows{};
        return rows.empty() ? error("not_found", 404) : json(Json{{"run", rows[0]}});
    });
    r.get("/api/v1/ft-runs", [&s](Request& req, Ctx&) {
        auto n = js_parse_int(req.query("limit").value_or("50"));
        const long long limit = std::min<long long>((n && *n != 0) ? *n : 50, 200);
        return json(Json{{"runs", s.db.query("SELECT * FROM ft_loop_runs ORDER BY started_at DESC LIMIT $1",
                                             {static_cast<std::int64_t>(limit)})}});
    });
    r.post("/api/v1/ft-runs", [](Request&, Ctx&) {
        return json(Json{{"error", "not_implemented"},
                         {"detail", "FT loop の起動は PR-iii (LLM Orchestrator) と PR-iv で実装"}},
                    501);
    });
}

std::optional<std::string> env_of(const Services& s, const std::string& key) {
    for (const auto& [k, v] : s.env) {
        if (k == key) return v;
    }
    return std::nullopt;
}

void training(http::Router& r, Services& s) {
    r.use("/api/v1/training/*", s.auth.middleware());
    static const std::vector<std::string> kinds = {"es", "portfolio", "past_qa", "self_intro"};
    const char* cols = "id, user_id, kind, memoria_uri, embedding_id, tags";
    r.get("/api/v1/training", [&s, cols](Request&, Ctx& ctx) {
        return json(Json{{"refs", s.db.query(std::string("SELECT ") + cols +
                                                 " FROM training_data_refs WHERE user_id = $1 ORDER BY added_at DESC",
                                             {user_id(ctx)})}});
    });
    r.post("/api/v1/training", [&s, cols](Request& req, Ctx& ctx) {
        auto body = read_json_body(req);
        const std::string kind = body && body->is_object() ? string_or(*body, "kind") : "";
        if (!body || !body->is_object() || kind.empty() || std::find(kinds.begin(), kinds.end(), kind) == kinds.end()) {
            return error("invalid_kind", 400);
        }
        db::StringArray tags;
        if (const Json* t = member(*body, "tags"); t && t->is_array()) {
            for (const auto& x : *t) {
                if (x.is_string()) tags.items.push_back(x.get<std::string>());
            }
        }
        const std::string uid = user_id(ctx);
        ensure_user(s.db, uid);
        std::string memoria_uri = string_or(*body, "memoria_uri");
        std::string embedding_id;
        const auto memoria_url = env_of(s, "MEMORIA_URL");
        const Json* text = member(*body, "body");
        if (memoria_url && !memoria_url->empty() && text && llm::js_truthy(*text)) {
            std::string base = *memoria_url;
            if (!base.empty() && base.back() == '/') base.pop_back();
            io::HttpClientRequest m;
            m.method = "POST";
            m.url = base + "/api/v1/tirocinium/training/upsert";
            m.headers = {{"content-type", "application/json"}};
            if (auto token = env_of(s, "MEMORIA_PROJECT_TOKEN"); token && !token->empty()) {
                m.headers.emplace_back("authorization", "Bearer " + *token);
            }
            m.body = js_stringify(Json{{"user_id", uid}, {"kind", kind}, {"body", *text}, {"tags", tags.items}});
            m.timeout = std::chrono::milliseconds(30'000);
            try {
                auto res = s.fetch(m);
                if (!res.ok()) {
                    return json(Json{{"error", "memoria_upsert_failed"},
                                     {"detail", "memoria upsert failed: " + std::to_string(res.status) + " " +
                                                    utf16_slice(res.body, 0, 500)}},
                                502);
                }
                auto ref = parse_json(res.body);
                if (!ref) return json(Json{{"error", "memoria_upsert_failed"}, {"detail", "invalid JSON"}}, 502);
                memoria_uri = string_or(*ref, "memoria_uri");
                embedding_id = string_or(*ref, "embedding_id");
            } catch (const std::exception& e) {
                return json(Json{{"error", "memoria_upsert_failed"}, {"detail", std::string(e.what())}}, 502);
            }
        }
        if (memoria_uri.empty()) {
            // dev: Memoria 無し → 本文は保持せず placeholder ref のみ
            memoria_uri = "local:training:" + kind + ":" + crypto::random_uuid_v4();
        }
        auto rows = s.db.query(std::string("INSERT INTO training_data_refs (user_id, kind, memoria_uri, embedding_id, tags) "
                                           "VALUES ($1, $2, $3, $4, $5) RETURNING ") +
                                   cols,
                               {uid, kind, memoria_uri, embedding_id, tags});
        return json(Json{{"ref", rows.at(0)}}, 201);
    });
    r.del("/api/v1/training/:id", [&s](Request& req, Ctx& ctx) {
        const std::string id = req.param("id");
        auto rows = is_uuid(id) ? s.db.query("DELETE FROM training_data_refs WHERE id = $1 AND user_id = $2 RETURNING id",
                                             {id, user_id(ctx)})
                                : db::Rows{};
        return rows.empty() ? error("not_found", 404) : json(Json{{"ok", true}});
    });
}

}  // namespace

std::string generate_summary_for_session(Services& s, const std::string& session_id) {
    if (!s.llm || !s.llm->anthropic_enabled()) return "anthropic_api_key_missing";
    auto turn_rows = s.db.query(
        "SELECT turn_no, role, stt_text, text_uri FROM session_turns WHERE session_id = $1 ORDER BY turn_no ASC", {session_id});
    if (turn_rows.empty()) return "no_turns";
    auto eval_rows = s.db.query(
        "SELECT turn_range::text AS turn_range, axes, comment, hints, model FROM evaluations WHERE session_id = $1 "
        "ORDER BY scored_at ASC",
        {session_id});
    std::vector<llm::Turn> turns;
    for (const auto& r : turn_rows) {
        turns.push_back({r["turn_no"].get<int>(), r["role"].get<std::string>(),
                         r["stt_text"].is_string() ? r["stt_text"].get<std::string>() : r["text_uri"].get<std::string>()});
    }
    std::vector<Json> evaluations;
    for (const auto& r : eval_rows) {
        // int4range の "[a,b)" を [a, b-1] へ (半開区間)
        int lo = 0, hi = 0;
        const std::string range = r["turn_range"].get<std::string>();
        if (std::sscanf(range.c_str(), "%*c%d,%d", &lo, &hi) == 2) {
            if (!range.empty() && range.back() == ')') hi -= 1;
        } else {
            lo = hi = 0;
        }
        evaluations.push_back(Json{{"turn_range", Json::array({lo, hi})},
                                   {"axes", r["axes"]},
                                   {"comment", r["comment"]},
                                   {"hints", r["hints"]},
                                   {"model", r["model"]}});
    }
    auto session = s.db.query("SELECT metadata FROM sessions WHERE id = $1", {session_id});
    if (session.empty()) return "session_not_found";
    const auto specialist = llm::specialist_from_metadata(session[0]["metadata"]);
    const Json doc = summarize_with_cli(*s.llm, specialist, turns, evaluations);
    upsert_summary(s.db, session_id, doc, "claude-opus-4-7");
    return "ok";
}

void register_interview_routes(http::Router& router, Services& services) {
    reservations(router, services);
    sessions(router, services);
    personas(router, services);
    feedback(router, services);
    ft_runs(router, services);
    training(router, services);
}

}  // namespace tr::app
