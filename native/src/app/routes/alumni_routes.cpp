#include "app/routes/alumni_routes.hpp"


#include "io/file_read.hpp"
#include "app/alumni_repo.hpp"
#include "app/interview_repo.hpp"
#include "core/llm/output.hpp"
#include "core/text.hpp"

namespace tr::app {

namespace {

using http::Request;
using http::Response;
using Ctx = http::Context;

Response json(const Json& v, int status = 200) { return Response::json(v, status); }
Response error(const std::string& code, int status) { return json(Json{{"error", code}}, status); }

constexpr std::size_t kMaxStaticBytes = 8 * 1024 * 1024;

std::optional<std::string> read_file(const std::filesystem::path& p) {
    return io::read_file_text(p, kMaxStaticBytes);  // 読みながら上限で止める (Lorica の予算)
}

// c.req.json().catch(() => ({}))。object 以外は空の object として扱う。
Json body_object(Request& req) {
    auto b = read_json_body(req);
    return b && b->is_object() ? *b : Json::object();
}

// readPatch / readJobPatch: 許可した項目だけ、型が合うものだけ。
Json read_patch(const Json& body, const std::vector<std::string>& strings, const std::vector<std::string>& bools) {
    Json patch = Json::object();
    for (const auto& k : strings) {
        if (const Json* v = member(body, k); v && v->is_string()) patch[k] = *v;
    }
    for (const auto& k : bools) {
        if (const Json* v = member(body, k); v && v->is_boolean()) patch[k] = *v;
    }
    return patch;
}

Json array_of(const std::vector<Json>& v) {
    Json a = Json::array();
    for (const auto& x : v) a.push_back(x);
    return a;
}

Response viewer_page(const Services& s, const char* dir, const char* not_found) {
    auto html = read_file(s.root / dir / "index.html");
    if (!html) return Response::text(not_found, 404);
    return Response::html(*html);
}

}  // namespace

void register_alumni_routes(http::Router& r, Services& s) {
    auto auth = [&s](http::Handler h) { return authed(s, std::move(h)); };

    // ---- 裏口 (backdoor) ----
    r.get("/api/v1/backdoor/me", auth([&s](Request&, Ctx& ctx) {
        auto entry = get_entry(s.db, user_id(ctx));
        return json(Json{{"entry", entry ? *entry : Json(nullptr)},
                         {"displayName", entry ? (*entry)["display_name"] : Json("")}});
    }));
    r.put("/api/v1/backdoor/me", auth([&s](Request& req, Ctx& ctx) {
        const Json patch = read_patch(body_object(req),
                                      {"display_name", "current_company", "message_to_students", "message_to_industry"},
                                      {"students_published", "industry_published"});
        return json(Json{{"entry", upsert_entry(s.db, user_id(ctx), "", patch, s.now())}});
    }));
    r.del("/api/v1/backdoor/me", auth([&s](Request&, Ctx& ctx) {
        delete_entry(s.db, user_id(ctx));
        return json(Json{{"ok", true}});
    }));
    r.get("/api/v1/backdoor/industry", auth([&s](Request&, Ctx&) {
        Json messages = Json::array();
        Json roster = Json::array();
        for (const auto& e : list_industry_messages(s.db)) {
            messages.push_back(Json{{"display_name", e["display_name"]},
                                    {"current_company", e["current_company"]},
                                    {"message", e["message_to_industry"]},
                                    {"updated_at", e["updated_at"]}});
            if (llm::js_truthy(e["current_company"])) {
                roster.push_back(Json{{"display_name", e["display_name"]}, {"current_company", e["current_company"]}});
            }
        }
        return json(Json{{"messages", messages}, {"roster", roster}});
    }));
    const std::vector<std::string> job_strings = {"title", "role", "description", "company_name", "location",
                                                  "employment_type", "deadline"};
    r.get("/api/v1/backdoor/job-postings", auth([&s](Request&, Ctx& ctx) {
        return json(Json{{"postings", array_of(list_ob_job_postings_for_ob(s.db, user_id(ctx)))}});
    }));
    r.get("/api/v1/backdoor/job-postings/mine", auth([&s](Request&, Ctx& ctx) {
        return json(Json{{"postings", array_of(list_my_ob_job_postings(s.db, user_id(ctx)))}});
    }));
    r.post("/api/v1/backdoor/job-postings", auth([&s, job_strings](Request& req, Ctx& ctx) {
        const Json patch = read_patch(body_object(req), job_strings, {"is_active"});
        const Json* title = member(patch, "title");
        if (!title || js_trim(title->get<std::string>()).empty()) return error("title_required", 400);
        return json(Json{{"posting", insert_ob_job_posting(s.db, user_id(ctx), patch, s.now())}}, 201);
    }));
    r.put("/api/v1/backdoor/job-postings/:id", auth([&s, job_strings](Request& req, Ctx& ctx) {
        const std::string id = req.param("id");
        const Json patch = read_patch(body_object(req), job_strings, {"is_active"});
        auto posting = is_uuid(id) ? update_ob_job_posting(s.db, id, user_id(ctx), patch, s.now()) : std::nullopt;
        return posting ? json(Json{{"posting", *posting}}) : error("not_found_or_forbidden", 404);
    }));
    r.del("/api/v1/backdoor/job-postings/:id", auth([&s](Request& req, Ctx& ctx) {
        const std::string id = req.param("id");
        const bool ok = is_uuid(id) && delete_ob_job_posting(s.db, id, user_id(ctx));
        return ok ? json(Json{{"ok", true}}) : error("not_found_or_forbidden", 404);
    }));
    r.get("/api/v1/backdoor/es-requests", auth([&s](Request&, Ctx& ctx) {
        auto entry = get_entry(s.db, user_id(ctx));
        std::optional<std::string> company_id;
        if (entry && (*entry)["current_company_id"].is_string()) company_id = (*entry)["current_company_id"].get<std::string>();
        Json out = Json::array();
        for (const auto& r : list_pending_es_requests_for_ob(s.db, company_id, user_id(ctx))) out.push_back(review_view(r));
        return json(Json{{"requests", out}});
    }));
    r.post("/api/v1/backdoor/es-requests/:id/accept", auth([&s](Request& req, Ctx& ctx) {
        const std::string id = req.param("id");
        auto request = is_uuid(id) ? accept_es_request(s.db, id, user_id(ctx), "OB", s.now()) : std::nullopt;
        if (!request) return error("not_found_or_already_matched", 404);
        // 学生本人へ「引き受けられた」通知 (Cernere user id 宛、送りっぱなし)。
        push_notification_async(
            s, (*request)["student_cernere_user_id"], "ES 添削相談が引き受けられました",
            (*request)["target_company_name"].get<std::string>() +
                " の OB が ES 添削相談を引き受けました。Tirocinium の相談画面から Bot に接続してください。相手への直接連絡は不要です。",
            Json{{"kind", "es_request_matched"}, {"request_id", (*request)["id"]}});
        return json(Json{{"request", review_view(*request)}});
    }));
    r.get("/backdoor", [&s](Request&, Ctx&) { return viewer_page(s, "backdoor-viewer", "backdoor viewer not found"); });
    r.get("/ob-jobs", [&s](Request&, Ctx&) { return viewer_page(s, "ob-jobs-viewer", "ob-jobs viewer not found"); });

    // ---- ES 添削相談 (在校生) ----
    r.get("/api/v1/es-requests", auth([&s](Request&, Ctx& ctx) {
        Json out = Json::array();
        for (const auto& x : list_es_requests_by_student(s.db, user_id(ctx))) out.push_back(review_view(x));
        return json(Json{{"requests", out}});
    }));
    r.post("/api/v1/es-requests", auth([&s](Request& req, Ctx& ctx) {
        const Json body = body_object(req);
        const std::string name = js_trim(string_or(body, "target_company_name"));
        if (name.empty()) return error("target_company_name_required", 400);
        if (utf16_length(name) > 200 || !resolve_company_id(s.db, name)) return error("registered_company_required", 400);
        Json request = insert_es_request(s.db, user_id(ctx), "学生", "", name, "", s.now());
        if (request["target_company_id"].is_string()) {
            const std::string company_id = request["target_company_id"];
            const bool queued = s.background.submit([&s, company_id, request] {
                auto obs = list_obs_for_company(s.db, company_id);
                if (obs.empty()) return;
                const std::string note = request["request_note"].get<std::string>();
                const std::string note_line = note.empty() ? "" : "\n備考: " + note;
                const std::string text = join({"企業: " + request["target_company_name"].get<std::string>(),
                                               "学生: " + request["student_display_name"].get<std::string>() + note_line, "",
                                               "裏口ページの「ES添削相談」から引き受けられます。"},
                                              "\n");
                for (const auto& ob : obs) {
                    (void)push_notification(s, ob["cernere_user_id"], "ES 添削の相談リクエストが届きました", text,
                                            Json{{"kind", "es_request_received"}, {"request_id", request["id"]}});
                }
            });
            if (!queued && s.log) s.log("[es-requests] background queue full; OB notification dropped");
        }
        return json(Json{{"request", review_view(request)}}, 201);
    }));
    r.del("/api/v1/es-requests/:id", auth([&s](Request& req, Ctx& ctx) {
        const std::string id = req.param("id");
        const bool ok = is_uuid(id) && close_es_request_by_student(s.db, id, user_id(ctx), s.now());
        return ok ? json(Json{{"ok", true}}) : error("not_found_or_forbidden", 404);
    }));
    r.get("/es-requests", [&s](Request&, Ctx&) { return viewer_page(s, "es-requests-viewer", "es-requests viewer not found"); });

    // ---- ES 添削の Discord 仲介 (es-review) ----
    r.get("/api/v1/es-review/client.js", [&s](Request&, Ctx&) {
        auto script = read_file(s.root / "es-review-viewer" / "client.js");
        if (!script) throw std::runtime_error("ENOENT: es-review-viewer/client.js");  // Node 版も readFile の例外 = 500
        return Response::raw(*script, "text/javascript; charset=utf-8");
    });
    r.use("/api/v1/es-review/*", s.auth.middleware());
    r.post("/api/v1/es-review/:id/discord", [&s](Request& req, Ctx& ctx) {
        if (s.config.discord.bot_token.empty()) return error("discord_not_configured", 503);
        const std::string id = req.param("id");
        auto role = is_uuid(id) ? participant_role(s.db, id, user_id(ctx)) : std::nullopt;
        if (!role) return error("not_found_or_closed", 404);
        const std::string token = issue_pairing(s.db, id, *role, s.now());
        auto res = json(Json{{"command", s.config.discord.command_prefix + " es connect " + token}, {"expires_in_seconds", 600}});
        res.headers.set("Cache-Control", "no-store");
        return res;
    });
    r.post("/api/v1/es-review/:id/close", [&s](Request& req, Ctx& ctx) {
        const std::string id = req.param("id");
        const std::string uid = user_id(ctx);
        auto rows = is_uuid(id) ? s.db.query(
                                      "UPDATE ob_es_requests SET status = 'closed', updated_at = $1 WHERE id = $2 "
                                      "AND status <> 'closed' AND (student_cernere_user_id = $3 OR matched_ob_cernere_user_id = $3) "
                                      "RETURNING id",
                                      {iso_from_ms(s.now()), id, uid})
                                : db::Rows{};
        if (rows.empty()) return error("not_found_or_closed", 404);
        s.db.query("DELETE FROM es_discord_routes WHERE request_id = $1", {id});
        return json(Json{{"ok", true}});
    });
}

// ---- resources / analytics (認証なしの公開経路) ----

std::string detect_browser(const std::string& ua) {
    if (ua.empty()) return "Unknown";
    auto has = [&](const char* s) { return ua.find(s) != std::string::npos; };
    if (has("Edg/") || has("Edge/")) return "Edge";
    if (has("OPR/") || has("Opera/")) return "Opera";
    if (has("Firefox/")) return "Firefox";
    if (has("Chrome/") && !has("Chromium/")) return "Chrome";
    if (has("Chromium/")) return "Chromium";
    if (has("Safari/") && !has("Chrome/")) return "Safari";
    return "Other";
}

namespace {

Json read_data_json(const Services& s, const std::string& rel) {
    auto text = read_file(s.root / "data" / rel);
    if (!text) throw std::runtime_error("ENOENT: data/" + rel);  // readFileSync の例外 = 500 internal
    JsonLimits limits;
    limits.max_bytes = kMaxStaticBytes;
    limits.max_elements = 1'000'000;
    auto v = parse_json(*text, limits);
    if (!v) throw std::runtime_error("invalid JSON: data/" + rel);
    return *v;
}

bool has_example_url(const Json& src) {
    if (const Json* urls = member(src, "urls"); urls && urls->is_array()) {
        for (const auto& u : *urls) {
            if (u.is_string() && u.get<std::string>().find("example.com") != std::string::npos) return true;
        }
    }
    return false;
}

}  // namespace

void register_public_routes(http::Router& r, Services& s) {
    r.get("/api/v1/resources/reference-links", [&s](Request&, Ctx&) {
        const Json sources = read_data_json(s, "companies/listing-sources.json");
        const Json curated = read_data_json(s, "general/reference-links.json");
        Json active = Json::array(), planned = Json::array(), templ = Json::array();
        if (sources.is_array()) {
            for (const auto& src : sources) {
                const bool example = has_example_url(src);
                const bool enabled = src.is_object() && llm::js_truthy(src.value("enabled", Json(false)));
                if (enabled && !example) active.push_back(src);
                if (!enabled && !example) planned.push_back(src);
                if (example) templ.push_back(src);
            }
        }
        return json(Json{{"sources", {{"active", active}, {"planned", planned}, {"template", templ}}}, {"curated", curated}});
    });
    r.get("/api/v1/resources/ob-messages", [&s](Request&, Ctx&) {
        const Json curated = read_data_json(s, "general/ob-messages.json");
        Json messages = Json::array();
        for (const auto& e : list_student_messages(s.db)) {
            const std::string name = e["display_name"].get<std::string>();
            messages.push_back(Json{{"id", e["id"]},
                                    {"name", name.empty() ? std::string("卒業生") : name},
                                    {"year", 0},
                                    {"company", e["current_company"]},
                                    {"role", "general"},
                                    {"message", e["message_to_students"]},
                                    {"tags", Json::array()}});
        }
        if (curated.is_array()) {
            for (const auto& m : curated) messages.push_back(m);
        }
        return json(Json{{"messages", messages}});
    });

    // analytics: Postgres 方言 (Node 版の SQL は SQLite 専用だった)。件数は数値で返す (Node 既定 = SQLite と同じ)。
    r.post("/api/v1/analytics/event", [&s](Request& req, Ctx&) {
        auto body = read_json_body(req);
        if (!body) throw std::runtime_error("invalid JSON body");  // c.req.json() の例外 = 500 internal
        std::string ip = "unknown";
        if (auto xff = req.header("x-forwarded-for")) {
            ip = js_trim(split(*xff, ',').front());
        } else if (auto real = req.header("x-real-ip")) {
            ip = *real;
        }
        const std::string ua = req.header("user-agent").value_or("");
        auto field = [&](const char* k) {
            const Json* v = member(*body, k);
            return v ? param_from_json(*v) : db::Param(db::Null{});
        };
        const Json* referrer = member(*body, "referrer");
        s.db.query(
            "INSERT INTO analytics_events (event_type, path, entity_id, entity_name, ip, browser, user_agent, referrer) "
            "VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
            {field("event_type"), field("path"), field("entity_id"), field("entity_name"), ip, detect_browser(ua), ua,
             referrer && !referrer->is_null() ? param_from_json(*referrer) : db::Param(std::string())});
        return json(Json{{"ok", true}});
    });
    r.get("/api/v1/analytics/daily", [&s](Request& req, Ctx&) {
        const std::string date = req.query("date").value_or(date_from_ms(s.now()));
        const char* day = "(ts AT TIME ZONE 'UTC')::date = $1::date";
        auto totals = s.db.query(std::string("SELECT COUNT(*)::int AS total_events, COUNT(DISTINCT ip)::int AS unique_ips "
                                             "FROM analytics_events WHERE ") + day, {date});
        auto page_views = s.db.query(std::string("SELECT path, COUNT(*)::int AS views FROM analytics_events WHERE ") + day +
                                         " AND event_type = 'page_view' GROUP BY path ORDER BY views DESC",
                                     {date});
        auto top = s.db.query(std::string("SELECT entity_id, entity_name, COUNT(*)::int AS views FROM analytics_events WHERE ") +
                                  day + " AND event_type = 'company_view' AND entity_id IS NOT NULL "
                                        "GROUP BY entity_id, entity_name ORDER BY views DESC LIMIT 20",
                              {date});
        auto browsers = s.db.query(std::string("SELECT browser, COUNT(*)::int AS count FROM analytics_events WHERE ") + day +
                                       " GROUP BY browser ORDER BY count DESC",
                                   {date});
        return json(Json{{"date", date},
                         {"total_events", totals.empty() ? Json(0) : totals[0]["total_events"]},
                         {"unique_ips", totals.empty() ? Json(0) : totals[0]["unique_ips"]},
                         {"page_views", page_views},
                         {"top_companies", top},
                         {"browsers", browsers}});
    });
    r.get("/api/v1/analytics/trend", [&s](Request& req, Ctx&) {
        auto days = js_parse_int(req.query("days").value_or("14"));
        if (!days) return json(Json{{"trend", Json::array()}});  // NaN 日は SQLite では空になる
        const long long d = std::min<long long>(*days, 90);
        auto rows = s.db.query(
            "SELECT to_char((ts AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS date, COUNT(*)::int AS total, "
            "COUNT(DISTINCT ip)::int AS unique_ips FROM analytics_events WHERE ts >= now() - make_interval(days => $1::int) "
            "GROUP BY 1 ORDER BY date ASC",
            {static_cast<std::int64_t>(d)});
        return json(Json{{"trend", rows}});
    });
}

}  // namespace tr::app
