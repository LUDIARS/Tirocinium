#pragma once
// 裏口 (卒業生) の DB 操作: companies/backdoor-repo.ts, ob-job-postings-repo.ts, ob-es-requests-repo.ts,
// es-review/routing.ts。時刻の列は ISO 8601 の文字列で返す (Node 版の既定 = SQLite と同じ見え方)。

#include <optional>
#include <string>
#include <vector>

#include "core/json.hpp"
#include "core/time.hpp"
#include "db/database.hpp"

namespace tr::app {

std::optional<std::string> resolve_company_id(db::Database& db, const std::string& company_name);

// ---- backdoor_alumni ----
std::optional<Json> get_entry(db::Database& db, const std::string& cernere_user_id);
Json upsert_entry(db::Database& db, const std::string& cernere_user_id, const std::string& fallback_display_name,
                  const Json& patch, EpochMs now);
void delete_entry(db::Database& db, const std::string& cernere_user_id);
std::vector<Json> list_student_messages(db::Database& db);
std::vector<Json> list_industry_messages(db::Database& db);
db::Rows list_obs_for_company(db::Database& db, const std::string& company_id);

// ---- ob_job_postings (投稿者 ID は応答に出さない) ----
Json insert_ob_job_posting(db::Database& db, const std::string& uid, const Json& patch, EpochMs now);
std::optional<Json> update_ob_job_posting(db::Database& db, const std::string& id, const std::string& uid, const Json& patch,
                                          EpochMs now);
bool delete_ob_job_posting(db::Database& db, const std::string& id, const std::string& uid);
std::vector<Json> list_ob_job_postings_for_ob(db::Database& db, const std::string& uid);
std::vector<Json> list_my_ob_job_postings(db::Database& db, const std::string& uid);
std::vector<Json> list_ob_job_postings_public(db::Database& db);

// ---- ob_es_requests ----
Json insert_es_request(db::Database& db, const std::string& student, const std::string& display_name,
                       const std::string& handle, const std::string& company_name, const std::string& note, EpochMs now);
std::vector<Json> list_pending_es_requests_for_ob(db::Database& db, const std::optional<std::string>& company_id,
                                                  const std::string& ob_user_id);
std::optional<Json> accept_es_request(db::Database& db, const std::string& id, const std::string& ob_user,
                                      const std::string& ob_display_name, EpochMs now);
std::vector<Json> list_es_requests_by_student(db::Database& db, const std::string& student);
bool close_es_request_by_student(db::Database& db, const std::string& id, const std::string& student, EpochMs now);
// es-review/view.ts reviewView: 参加者の識別子を API に出さない射影。
Json review_view(const Json& request);

// ---- es-review/routing.ts (Discord の仲介。本文は保存しない) ----
std::optional<std::string> participant_role(db::Database& db, const std::string& id, const std::string& uid);
std::string issue_pairing(db::Database& db, const std::string& id, const std::string& role, EpochMs now);
struct ReviewRoute {
    std::string request_id;
    std::string role;
    std::string alias;
    std::string channel_id;
};
std::optional<ReviewRoute> consume_pairing(db::Database& db, const std::string& token, const std::string& channel_id,
                                           EpochMs now);
std::optional<ReviewRoute> relay_destination(db::Database& db, const std::string& alias, const std::string& channel_id);
bool claim_delivery(db::Database& db, const std::string& message_id, const std::string& request_id, EpochMs now);
void finish_delivery(db::Database& db, const std::string& message_id, const std::string& state);

}  // namespace tr::app
