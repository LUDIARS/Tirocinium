#include "app/alumni_repo.hpp"

#include "app/interview_repo.hpp"
#include "core/domain/domain.hpp"
#include "core/encoding.hpp"
#include "core/llm/output.hpp"
#include "core/text.hpp"
#include "crypto/crypto.hpp"

namespace tr::app {

std::optional<std::string> resolve_company_id(db::Database& db, const std::string& company_name) {
    const std::string key = domain::normalize_name(company_name);
    if (key.empty()) return std::nullopt;
    auto rows = db.query("SELECT id FROM companies WHERE normalized_name = $1 LIMIT 1", {key});
    if (rows.empty()) return std::nullopt;
    return rows[0]["id"].get<std::string>();
}

namespace {

const char* kEntryCols =
    "id, cernere_user_id, display_name, current_company, current_company_id, message_to_students, message_to_industry, "
    "students_published, industry_published, updated_at";

std::string text_of(const Json& v) {
    if (v.is_string()) return v.get<std::string>();
    if (v.is_null()) return "null";
    return js_stringify(v);
}

Json map_entry(const Json& r) {
    return Json{{"id", r["id"]},
                {"cernere_user_id", r["cernere_user_id"]},
                {"display_name", r["display_name"]},
                {"current_company", r["current_company"]},
                {"current_company_id", r["current_company_id"].is_null() ? Json(nullptr) : r["current_company_id"]},
                {"message_to_students", r["message_to_students"]},
                {"message_to_industry", r["message_to_industry"]},
                {"students_published", llm::js_truthy(r["students_published"])},
                {"industry_published", llm::js_truthy(r["industry_published"])},
                {"updated_at", text_of(r["updated_at"])}};
}

// patch[k] ?? cur[k] ?? fallback
Json pick(const Json& patch, const std::optional<Json>& cur, const char* k, Json fallback) {
    if (const Json* v = member(patch, k); v && !v->is_null()) return *v;
    if (cur) {
        if (const Json* v = member(*cur, k); v && !v->is_null()) return *v;
    }
    return fallback;
}

const char* kPostingCols =
    "id, posted_by_cernere_user_id, title, role, description, company_name, company_id, location, employment_type, "
    "deadline, is_active, created_at, updated_at";

Json map_posting(const Json& r) {
    return Json{{"id", r["id"]},
                {"title", r["title"]},
                {"role", r["role"]},
                {"description", r["description"]},
                {"company_name", r["company_name"]},
                {"company_id", r["company_id"].is_null() ? Json(nullptr) : r["company_id"]},
                {"location", r["location"]},
                {"employment_type", r["employment_type"]},
                {"deadline", r["deadline"]},
                {"is_active", llm::js_truthy(r["is_active"])},
                {"created_at", text_of(r["created_at"])},
                {"updated_at", text_of(r["updated_at"])}};
}

const char* kRequestCols =
    "id, student_cernere_user_id, student_display_name, student_discord_handle, target_company_name, target_company_id, "
    "status, matched_ob_cernere_user_id, matched_ob_display_name, request_note, created_at, updated_at";

Json map_request(const Json& r) {
    return Json{{"id", r["id"]},
                {"student_cernere_user_id", r["student_cernere_user_id"]},
                {"student_display_name", r["student_display_name"]},
                {"student_discord_handle", r["student_discord_handle"]},
                {"target_company_name", r["target_company_name"]},
                {"target_company_id", r["target_company_id"].is_null() ? Json(nullptr) : r["target_company_id"]},
                {"status", r["status"]},
                {"matched_ob_cernere_user_id", r["matched_ob_cernere_user_id"].is_null() ? Json(nullptr) : r["matched_ob_cernere_user_id"]},
                {"matched_ob_display_name", r["matched_ob_display_name"].is_null() ? Json(nullptr) : r["matched_ob_display_name"]},
                {"request_note", r["request_note"]},
                {"created_at", text_of(r["created_at"])},
                {"updated_at", text_of(r["updated_at"])}};
}

db::Param company_param(const std::optional<std::string>& id) {
    return id ? db::Param(*id) : db::Param(db::Null{});
}

}  // namespace

std::optional<Json> get_entry(db::Database& db, const std::string& uid) {
    auto rows = db.query(std::string("SELECT ") + kEntryCols + " FROM backdoor_alumni WHERE cernere_user_id = $1", {uid});
    if (rows.empty()) return std::nullopt;
    return map_entry(rows[0]);
}

Json upsert_entry(db::Database& db, const std::string& uid, const std::string& fallback_display_name, const Json& patch,
                  EpochMs now) {
    const auto cur = get_entry(db, uid);
    const Json display_name = pick(patch, cur, "display_name", Json(fallback_display_name));
    const Json company = pick(patch, cur, "current_company", Json(""));
    const Json to_students = pick(patch, cur, "message_to_students", Json(""));
    const Json to_industry = pick(patch, cur, "message_to_industry", Json(""));
    const Json students_published = pick(patch, cur, "students_published", Json(false));
    const Json industry_published = pick(patch, cur, "industry_published", Json(false));
    std::optional<std::string> company_id;
    if (llm::js_truthy(company)) company_id = resolve_company_id(db, text_of(company));
    auto rows = db.query(
        std::string("INSERT INTO backdoor_alumni (cernere_user_id, display_name, current_company, current_company_id, "
                    "message_to_students, message_to_industry, students_published, industry_published, updated_at) "
                    "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) ON CONFLICT (cernere_user_id) DO UPDATE SET "
                    "display_name = excluded.display_name, current_company = excluded.current_company, "
                    "current_company_id = excluded.current_company_id, message_to_students = excluded.message_to_students, "
                    "message_to_industry = excluded.message_to_industry, students_published = excluded.students_published, "
                    "industry_published = excluded.industry_published, updated_at = excluded.updated_at RETURNING ") +
            kEntryCols,
        {uid, param_from_json(display_name), param_from_json(company), company_param(company_id),
         param_from_json(to_students), param_from_json(to_industry), param_from_json(students_published),
         param_from_json(industry_published), iso_from_ms(now)});
    if (rows.empty()) throw std::runtime_error("backdoor upsert returned no row");
    return map_entry(rows[0]);
}

void delete_entry(db::Database& db, const std::string& uid) {
    db.query("DELETE FROM backdoor_alumni WHERE cernere_user_id = $1", {uid});
}

std::vector<Json> list_student_messages(db::Database& db) {
    std::vector<Json> out;
    for (const auto& r : db.query(std::string("SELECT ") + kEntryCols +
                                  " FROM backdoor_alumni WHERE students_published = $1 AND message_to_students <> '' "
                                  "ORDER BY updated_at DESC",
                                  {true})) {
        out.push_back(map_entry(r));
    }
    return out;
}

std::vector<Json> list_industry_messages(db::Database& db) {
    std::vector<Json> out;
    for (const auto& r : db.query(std::string("SELECT ") + kEntryCols +
                                  " FROM backdoor_alumni WHERE industry_published = $1 AND message_to_industry <> '' "
                                  "ORDER BY updated_at DESC",
                                  {true})) {
        out.push_back(map_entry(r));
    }
    return out;
}

db::Rows list_obs_for_company(db::Database& db, const std::string& company_id) {
    return db.query("SELECT cernere_user_id, display_name FROM backdoor_alumni WHERE current_company_id = $1", {company_id});
}

Json insert_ob_job_posting(db::Database& db, const std::string& uid, const Json& patch, EpochMs now) {
    auto field = [&](const char* k) { return pick(patch, std::nullopt, k, Json("")); };
    const Json company = field("company_name");
    std::optional<std::string> company_id;
    if (llm::js_truthy(company)) company_id = resolve_company_id(db, text_of(company));
    const Json* active = member(patch, "is_active");
    const bool is_active = !(active && active->is_boolean() && !active->get<bool>());
    auto rows = db.query(
        std::string("INSERT INTO ob_job_postings (posted_by_cernere_user_id, title, role, description, company_name, "
                    "company_id, location, employment_type, deadline, is_active, updated_at) "
                    "VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING ") +
            kPostingCols,
        {uid, param_from_json(field("title")), param_from_json(field("role")), param_from_json(field("description")),
         param_from_json(company), company_param(company_id), param_from_json(field("location")),
         param_from_json(field("employment_type")), param_from_json(field("deadline")), is_active, iso_from_ms(now)});
    if (rows.empty()) throw std::runtime_error("ob_job_postings insert returned no row");
    return map_posting(rows[0]);
}

std::optional<Json> update_ob_job_posting(db::Database& db, const std::string& id, const std::string& uid, const Json& patch,
                                          EpochMs now) {
    auto cur = db.query(std::string("SELECT ") + kPostingCols + " FROM ob_job_postings WHERE id = $1", {id});
    if (cur.empty() || cur[0]["posted_by_cernere_user_id"] != uid) return std::nullopt;
    const std::optional<Json> c = cur[0];
    auto field = [&](const char* k) { return pick(patch, c, k, Json("")); };
    const Json company = field("company_name");
    const Json* active = member(patch, "is_active");
    const bool is_active = active && active->is_boolean() ? active->get<bool>() : llm::js_truthy(cur[0]["is_active"]);
    std::optional<std::string> company_id;
    if (llm::js_truthy(company)) company_id = resolve_company_id(db, text_of(company));
    auto rows = db.query(
        std::string("UPDATE ob_job_postings SET title = $1, role = $2, description = $3, company_name = $4, "
                    "company_id = $5, location = $6, employment_type = $7, deadline = $8, is_active = $9, "
                    "updated_at = $10 WHERE id = $11 RETURNING ") +
            kPostingCols,
        {param_from_json(field("title")), param_from_json(field("role")), param_from_json(field("description")),
         param_from_json(company), company_param(company_id), param_from_json(field("location")),
         param_from_json(field("employment_type")), param_from_json(field("deadline")), is_active, iso_from_ms(now), id});
    if (rows.empty()) return std::nullopt;
    return map_posting(rows[0]);
}

bool delete_ob_job_posting(db::Database& db, const std::string& id, const std::string& uid) {
    auto rows = db.query("SELECT posted_by_cernere_user_id FROM ob_job_postings WHERE id = $1", {id});
    if (rows.empty() || rows[0]["posted_by_cernere_user_id"] != uid) return false;
    db.query("DELETE FROM ob_job_postings WHERE id = $1", {id});
    return true;
}

std::vector<Json> list_ob_job_postings_for_ob(db::Database& db, const std::string& uid) {
    std::vector<Json> out;
    for (const auto& r : db.query(std::string("SELECT ") + kPostingCols +
                                  " FROM ob_job_postings WHERE is_active = $1 ORDER BY created_at DESC",
                                  {true})) {
        Json p = map_posting(r);
        p["is_mine"] = r["posted_by_cernere_user_id"] == uid;
        out.push_back(p);
    }
    return out;
}

std::vector<Json> list_my_ob_job_postings(db::Database& db, const std::string& uid) {
    std::vector<Json> out;
    for (const auto& r : db.query(std::string("SELECT ") + kPostingCols +
                                  " FROM ob_job_postings WHERE posted_by_cernere_user_id = $1 ORDER BY created_at DESC",
                                  {uid})) {
        Json p = map_posting(r);
        p["is_mine"] = true;
        out.push_back(p);
    }
    return out;
}

std::vector<Json> list_ob_job_postings_public(db::Database& db) {
    std::vector<Json> out;
    for (const auto& r : db.query(std::string("SELECT ") + kPostingCols +
                                  " FROM ob_job_postings WHERE is_active = $1 ORDER BY created_at DESC",
                                  {true})) {
        out.push_back(map_posting(r));
    }
    return out;
}

Json insert_es_request(db::Database& db, const std::string& student, const std::string& display_name,
                       const std::string& handle, const std::string& company_name, const std::string& note, EpochMs now) {
    std::optional<std::string> company_id;
    if (!company_name.empty()) company_id = resolve_company_id(db, company_name);
    auto rows = db.query(
        std::string("INSERT INTO ob_es_requests (student_cernere_user_id, student_display_name, student_discord_handle, "
                    "target_company_name, target_company_id, request_note, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7) "
                    "RETURNING ") +
            kRequestCols,
        {student, display_name, handle, company_name, company_param(company_id), note, iso_from_ms(now)});
    if (rows.empty()) throw std::runtime_error("ob_es_requests insert returned no row");
    return map_request(rows[0]);
}

std::vector<Json> list_pending_es_requests_for_ob(db::Database& db, const std::optional<std::string>& company_id,
                                                  const std::string& ob_user_id) {
    std::vector<Json> out;
    for (const auto& r : db.query(std::string("SELECT ") + kRequestCols +
                                  " FROM ob_es_requests WHERE (status = $1 AND target_company_id = $2 AND "
                                  "student_cernere_user_id <> $3) OR (status = 'matched' AND matched_ob_cernere_user_id = $3) "
                                  "ORDER BY created_at ASC",
                                  {std::string("pending"), company_param(company_id), ob_user_id})) {
        out.push_back(map_request(r));
    }
    return out;
}

std::optional<Json> accept_es_request(db::Database& db, const std::string& id, const std::string& ob_user,
                                      const std::string& ob_display_name, EpochMs now) {
    auto rows = db.query(
        std::string("UPDATE ob_es_requests SET status = $1, matched_ob_cernere_user_id = $2, matched_ob_display_name = $3, "
                    "updated_at = $4 WHERE id = $5 AND status = 'pending' AND student_cernere_user_id <> $2 "
                    "AND target_company_id IS NOT NULL AND EXISTS (SELECT 1 FROM backdoor_alumni ob "
                    "WHERE ob.cernere_user_id = $2 AND ob.current_company_id = ob_es_requests.target_company_id) RETURNING ") +
            kRequestCols,
        {std::string("matched"), ob_user, ob_display_name, iso_from_ms(now), id});
    if (rows.empty()) return std::nullopt;
    return map_request(rows[0]);
}

std::vector<Json> list_es_requests_by_student(db::Database& db, const std::string& student) {
    std::vector<Json> out;
    for (const auto& r : db.query(std::string("SELECT ") + kRequestCols +
                                  " FROM ob_es_requests WHERE student_cernere_user_id = $1 ORDER BY created_at DESC",
                                  {student})) {
        out.push_back(map_request(r));
    }
    return out;
}

bool close_es_request_by_student(db::Database& db, const std::string& id, const std::string& student, EpochMs now) {
    auto rows = db.query("SELECT student_cernere_user_id FROM ob_es_requests WHERE id = $1", {id});
    if (rows.empty() || rows[0]["student_cernere_user_id"] != student) return false;
    db.query("UPDATE ob_es_requests SET status = $1, updated_at = $2 WHERE id = $3", {std::string("closed"), iso_from_ms(now), id});
    return true;
}

Json review_view(const Json& r) {
    return Json{{"id", r["id"]},
                {"target_company_id", r["target_company_id"]},
                {"target_company_name", r["target_company_name"]},
                {"status", r["status"]},
                {"created_at", r["created_at"]},
                {"updated_at", r["updated_at"]}};
}

// ---- es-review routing ----

std::optional<std::string> participant_role(db::Database& db, const std::string& id, const std::string& uid) {
    auto rows = db.query(
        "SELECT student_cernere_user_id, matched_ob_cernere_user_id FROM ob_es_requests WHERE id = $1 AND status = 'matched'",
        {id});
    if (rows.empty()) return std::nullopt;
    if (rows[0]["student_cernere_user_id"] == uid) return std::string("student");
    if (rows[0]["matched_ob_cernere_user_id"] == uid) return std::string("ob");
    return std::nullopt;
}

std::string issue_pairing(db::Database& db, const std::string& id, const std::string& role, EpochMs now) {
    const std::string token = hex_encode(crypto::random_bytes(32));
    const std::string alias = hex_encode(crypto::random_bytes(8));
    const std::string expires = iso_from_ms(now + 10 * 60'000);
    const std::string hash = crypto::sha256_hex(token);
    db.query(
        "INSERT INTO es_discord_routes (request_id, role, alias, token_hash, expires_at, channel_id) "
        "VALUES ($1, $2, $3, $4, $5, NULL) ON CONFLICT (request_id, role) DO UPDATE SET alias = $3, "
        "token_hash = $4, expires_at = $5, channel_id = NULL",
        {id, role, alias, hash, expires});
    return token;
}

std::optional<ReviewRoute> consume_pairing(db::Database& db, const std::string& token, const std::string& channel_id,
                                           EpochMs now) {
    if (!is_lower_hex(token, 64)) return std::nullopt;
    auto rows = db.query(
        "UPDATE es_discord_routes SET channel_id = $1, token_hash = NULL WHERE token_hash = $2 AND expires_at > $3 "
        "AND EXISTS (SELECT 1 FROM ob_es_requests r WHERE r.id = es_discord_routes.request_id AND r.status = 'matched') "
        "AND NOT EXISTS (SELECT 1 FROM es_discord_routes other WHERE other.request_id = es_discord_routes.request_id "
        "AND other.role <> es_discord_routes.role AND other.channel_id = $1) "
        "RETURNING request_id, role, alias, channel_id",
        {channel_id, crypto::sha256_hex(token), iso_from_ms(now)});
    if (rows.empty()) return std::nullopt;
    return ReviewRoute{rows[0]["request_id"], rows[0]["role"], rows[0]["alias"], rows[0]["channel_id"]};
}

std::optional<ReviewRoute> relay_destination(db::Database& db, const std::string& alias, const std::string& channel_id) {
    auto rows = db.query(
        "SELECT sender.request_id, sender.role, recipient.channel_id, recipient.alias FROM es_discord_routes sender "
        "JOIN es_discord_routes recipient ON recipient.request_id = sender.request_id AND recipient.role <> sender.role "
        "JOIN ob_es_requests r ON r.id = sender.request_id "
        "WHERE sender.alias = $1 AND sender.channel_id = $2 AND recipient.channel_id IS NOT NULL AND r.status = 'matched'",
        {alias, channel_id});
    if (rows.empty()) return std::nullopt;
    return ReviewRoute{rows[0]["request_id"], rows[0]["role"], rows[0]["alias"], rows[0]["channel_id"]};
}

bool claim_delivery(db::Database& db, const std::string& message_id, const std::string& request_id, EpochMs now) {
    auto rows = db.query(
        "INSERT INTO es_discord_deliveries (message_id, request_id, state, created_at) VALUES ($1, $2, 'sending', $3) "
        "ON CONFLICT (message_id) DO NOTHING RETURNING message_id",
        {message_id, request_id, iso_from_ms(now)});
    return rows.size() == 1;
}

void finish_delivery(db::Database& db, const std::string& message_id, const std::string& state) {
    db.query("UPDATE es_discord_deliveries SET state = $1 WHERE message_id = $2", {state, message_id});
}

}  // namespace tr::app
