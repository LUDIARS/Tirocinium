#pragma once
// 面接まわりの DB 操作 (reservation/coordinator.ts, db/session-metadata.ts, persona/repo.ts,
// feedback/*.ts, summary/repo.ts, training/repo.ts, ft_loop/repo.ts, brief/repo.ts)。SQL は Node 版と同じ。

#include <optional>
#include <string>
#include <vector>

#include "core/json.hpp"
#include "core/time.hpp"
#include "db/database.hpp"

namespace tr::app {

// UUID の形 (8-4-4-4-12 の 16 進)。Postgres の uuid 列に形の違う値を渡すと 500 になるため、
// 経路の :id は先に検査して「見つからない」と同じ応答にする (Node 版の既定 = SQLite と同じ見え方)。
bool is_uuid(const std::string& s);

// ---- reservation/coordinator.ts ----
struct StartDecision {
    std::string kind;  // start | offer | denied
    std::string session_id;
    EpochMs slot_start = 0;
    std::string reason;
};
StartDecision try_start(db::Database& db, const std::string& user_id, EpochMs now, int slot_capacity, int slot_minutes);
// 例外 slot_full。
std::string reserve(db::Database& db, const std::string& user_id, EpochMs slot_start, int slot_capacity);
// 例外 not_found / cannot_cancel。
void cancel_reservation(db::Database& db, const std::string& reservation_id, const std::string& user_id);
db::Rows list_slots(db::Database& db, EpochMs from, int hours);
db::Rows list_my_reservations(db::Database& db, const std::string& user_id);

// ---- db/session-metadata.ts ----
Json as_object(const Json& v);
void patch_session_metadata(db::Database& db, const std::string& session_id, const Json& patch);

// ---- weakness profile (feedback/weakness-updater.ts) ----
Json load_weakness_profile(db::Database& db, const std::string& user_id);
Json apply_evaluation(db::Database& db, const std::string& user_id, const Json& axes, const std::vector<std::string>& hints);

// ---- persona/repo.ts ----
db::Rows list_interviewers(db::Database& db, const std::optional<std::string>& stage,
                           const std::optional<std::string>& role_lens, const std::optional<std::string>& temperament);
std::optional<Json> get_interviewer(db::Database& db, const std::string& id);
db::Rows list_examinees(db::Database& db, const std::optional<std::string>& target_role);
std::optional<Json> get_examinee(db::Database& db, const std::string& id);

// ---- summary ----
std::optional<Json> get_summary(db::Database& db, const std::string& session_id);
Json upsert_summary(db::Database& db, const std::string& session_id, const Json& doc, const std::string& model);

// ---- brief/repo.ts ----
struct StoredBrief {
    std::string body_md;
    Json source_meta;
    std::uint32_t seed = 0;
};
std::optional<StoredBrief> get_brief(db::Database& db, const std::string& session_id);
StoredBrief save_brief_if_absent(db::Database& db, const std::string& session_id, const std::string& body_md,
                                 const Json& source_meta, std::uint32_t seed);

// db::Param を Json から作る (postgres.js の値の送り方と同じ: 文字列・数値は型なし、配列は text[]、
// object は jsonb)。
db::Param param_from_json(const Json& v);

}  // namespace tr::app
