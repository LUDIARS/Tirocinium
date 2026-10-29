#include "app/interview_repo.hpp"

#include <cmath>
#include <stdexcept>

#include "core/domain/domain.hpp"
#include "core/llm/engine.hpp"
#include "core/text.hpp"

namespace tr::app {

bool is_uuid(const std::string& s) {
    if (s.size() != 36) return false;
    for (std::size_t i = 0; i < s.size(); ++i) {
        const char c = s[i];
        if (i == 8 || i == 13 || i == 18 || i == 23) {
            if (c != '-') return false;
        } else if (!std::isxdigit(static_cast<unsigned char>(c))) {
            return false;
        }
    }
    return true;
}

db::Param param_from_json(const Json& v) {
    switch (v.type()) {
        case Json::value_t::null:
        case Json::value_t::discarded:
            return db::Null{};
        case Json::value_t::string:
            return v.get<std::string>();
        case Json::value_t::boolean:
            return v.get<bool>();
        case Json::value_t::number_integer:
            return v.get<std::int64_t>();
        case Json::value_t::number_unsigned:
            return static_cast<std::int64_t>(v.get<std::uint64_t>());
        case Json::value_t::number_float:
            return v.get<double>();
        case Json::value_t::array: {
            bool all_strings = true;
            for (const auto& x : v) all_strings = all_strings && x.is_string();
            if (all_strings) {
                db::StringArray a;
                for (const auto& x : v) a.items.push_back(x.get<std::string>());
                return a;
            }
            return db::JsonParam{v};
        }
        default:
            return db::JsonParam{v};
    }
}

// ---- reservations ----

namespace {

void ensure_slot_exists(db::Database& db, EpochMs slot_start, int capacity) {
    db.query("INSERT INTO reservation_slots (slot_start, capacity) VALUES ($1, $2) ON CONFLICT (slot_start) DO NOTHING",
             {iso_from_ms(slot_start), std::int64_t{capacity}});
}

std::optional<EpochMs> find_first_free_slot(db::Database& db, EpochMs from, int capacity, int slot_minutes) {
    // 直近 48 時間の slot を先に確保しておく
    EpochMs cur = domain::current_slot_start(from, slot_minutes);
    const EpochMs max = from + 48LL * 3600 * 1000;
    while (cur <= max) {
        ensure_slot_exists(db, cur, capacity);
        cur = domain::next_slot_start(cur, slot_minutes);
    }
    auto rows = db.query(
        "SELECT slot_start FROM reservation_slots WHERE slot_start >= $1 AND used < capacity ORDER BY slot_start ASC LIMIT 1",
        {iso_from_ms(from)});
    if (rows.empty() || !rows[0]["slot_start"].is_string()) return std::nullopt;
    return parse_iso_ms(rows[0]["slot_start"].get<std::string>());
}

double server_load(db::Database& db, int capacity) {
    auto rows = db.query("SELECT COUNT(*)::int AS count FROM sessions WHERE status = 'active'");
    const double active = rows.empty() ? 0 : rows[0]["count"].get<double>();
    return std::min(1.0, active / (static_cast<double>(capacity) * 2));
}

}  // namespace

StartDecision try_start(db::Database& db, const std::string& user_id, EpochMs now, int capacity, int slot_minutes) {
    if (server_load(db, capacity) > 0.95) return {"denied", "", 0, "saturated"};
    const EpochMs slot = domain::current_slot_start(now, slot_minutes);
    ensure_slot_exists(db, slot, capacity);
    bool taken = false;
    db.transaction([&](db::Database& tx) {
        auto row = tx.query("SELECT used, capacity FROM reservation_slots WHERE slot_start = $1 FOR UPDATE", {iso_from_ms(slot)});
        if (row.empty()) return;
        if (row[0]["used"].get<int>() >= row[0]["capacity"].get<int>()) return;
        tx.query("UPDATE reservation_slots SET used = used + 1, updated_at = now() WHERE slot_start = $1", {iso_from_ms(slot)});
        taken = true;
    });
    if (taken) {
        // session_seed はここで 1 回だけ採番して永続化する (同 seed 同プラン)。
        auto rows = db.query(
            "INSERT INTO sessions (user_id, mode, status, llm_profile, metadata) "
            "VALUES ($1, 'server', 'active', '{}'::jsonb, $2) RETURNING id",
            {user_id, db::JsonParam{Json{{"session_seed", llm::new_session_seed()}}}});
        return {"start", rows.at(0)["id"].get<std::string>(), 0, ""};
    }
    auto next = find_first_free_slot(db, domain::next_slot_start(slot, slot_minutes), capacity, slot_minutes);
    if (!next) return {"denied", "", 0, "no_future_slot"};
    return {"offer", "", *next, ""};
}

std::string reserve(db::Database& db, const std::string& user_id, EpochMs slot_start, int capacity) {
    std::string id;
    db.transaction([&](db::Database& tx) {
        const std::string s = iso_from_ms(slot_start);
        tx.query("INSERT INTO reservation_slots (slot_start, capacity) VALUES ($1, $2) ON CONFLICT (slot_start) DO NOTHING",
                 {s, std::int64_t{capacity}});
        auto slot = tx.query("SELECT used, capacity FROM reservation_slots WHERE slot_start = $1 FOR UPDATE", {s});
        if (slot.empty() || slot[0]["used"].get<int>() >= slot[0]["capacity"].get<int>()) {
            throw std::runtime_error("slot_full");
        }
        auto res = tx.query("INSERT INTO reservations (user_id, slot_start, status) VALUES ($1, $2, 'held') RETURNING id",
                            {user_id, s});
        tx.query("UPDATE reservation_slots SET used = used + 1, updated_at = now() WHERE slot_start = $1", {s});
        id = res.at(0)["id"].get<std::string>();
    });
    return id;
}

void cancel_reservation(db::Database& db, const std::string& reservation_id, const std::string& user_id) {
    db.transaction([&](db::Database& tx) {
        auto row = tx.query("SELECT slot_start, status FROM reservations WHERE id = $1 AND user_id = $2 FOR UPDATE",
                            {reservation_id, user_id});
        if (row.empty()) throw std::runtime_error("not_found");
        if (row[0]["status"] != "held") throw std::runtime_error("cannot_cancel");
        tx.query("UPDATE reservations SET status = 'canceled' WHERE id = $1", {reservation_id});
        tx.query("UPDATE reservation_slots SET used = GREATEST(used - 1, 0), updated_at = now() WHERE slot_start = $1",
                 {row[0]["slot_start"].get<std::string>()});
    });
}

db::Rows list_slots(db::Database& db, EpochMs from, int hours) {
    const EpochMs max = from + static_cast<EpochMs>(hours) * 3600 * 1000;
    return db.query(
        "SELECT slot_start, capacity, used FROM reservation_slots WHERE slot_start >= $1 AND slot_start <= $2 "
        "ORDER BY slot_start ASC",
        {iso_from_ms(from), iso_from_ms(max)});
}

db::Rows list_my_reservations(db::Database& db, const std::string& user_id) {
    return db.query("SELECT id, slot_start, status FROM reservations WHERE user_id = $1 ORDER BY slot_start DESC LIMIT 50",
                    {user_id});
}

// ---- session metadata ----

Json as_object(const Json& v) {
    Json obj = v;
    if (v.is_string()) {
        auto p = parse_json(v.get<std::string>());
        if (!p) throw std::runtime_error("invalid metadata json");
        obj = *p;
    }
    return obj.is_object() ? obj : Json::object();
}

void patch_session_metadata(db::Database& db, const std::string& session_id, const Json& patch) {
    auto rows = db.query("SELECT metadata FROM sessions WHERE id = $1", {session_id});
    Json merged = rows.empty() ? Json::object() : as_object(rows[0]["metadata"]);
    for (auto it = patch.begin(); it != patch.end(); ++it) merged[it.key()] = it.value();
    db.query("UPDATE sessions SET metadata = $1 WHERE id = $2", {db::JsonParam{merged}, session_id});
}

// ---- weakness ----

Json load_weakness_profile(db::Database& db, const std::string& user_id) {
    auto rows = db.query(
        "SELECT axes_ema, axes_variance, weak_top3, hint_history, session_count FROM weakness_profiles WHERE user_id = $1",
        {user_id});
    const Json init = domain::initial_weakness_snapshot();
    if (rows.empty()) return init;
    const Json& r = rows[0];
    auto pick = [&](const char* k, const Json& fallback) { return r[k].is_null() ? fallback : r[k]; };
    return Json{{"axes_ema", pick("axes_ema", init["axes_ema"])},
                {"axes_variance", pick("axes_variance", init["axes_variance"])},
                {"weak_top3", pick("weak_top3", Json::array())},
                {"hint_history", pick("hint_history", Json::array())},
                {"session_count", pick("session_count", Json(0))}};
}

Json apply_evaluation(db::Database& db, const std::string& user_id, const Json& axes, const std::vector<std::string>& hints) {
    const Json cur = load_weakness_profile(db, user_id);
    const Json next = domain::apply_evaluation_to_profile(cur, axes, hints);
    db::StringArray weak;
    for (const auto& x : next["weak_top3"]) weak.items.push_back(x.get<std::string>());
    db.query(
        "INSERT INTO weakness_profiles (user_id, axes_ema, axes_variance, weak_top3, hint_history, session_count, updated_at) "
        "VALUES ($1, $2, $3, $4, $5, $6, now()) "
        "ON CONFLICT (user_id) DO UPDATE SET axes_ema = EXCLUDED.axes_ema, axes_variance = EXCLUDED.axes_variance, "
        "weak_top3 = EXCLUDED.weak_top3, hint_history = EXCLUDED.hint_history, session_count = EXCLUDED.session_count, "
        "updated_at = now()",
        {user_id, db::JsonParam{next["axes_ema"]}, db::JsonParam{next["axes_variance"]}, weak,
         db::JsonParam{next["hint_history"]}, param_from_json(next["session_count"])});
    return next;
}

// ---- personas ----

db::Rows list_interviewers(db::Database& db, const std::optional<std::string>& stage,
                           const std::optional<std::string>& role_lens, const std::optional<std::string>& temperament) {
    std::vector<std::string> conds;
    db::Params vals;
    // 空文字は「未指定」(Node 版の if (f.stage) と同じ)
    if (stage && !stage->empty()) {
        vals.emplace_back(*stage);
        conds.push_back("stage = $" + std::to_string(vals.size()));
    }
    if (role_lens && !role_lens->empty()) {
        vals.emplace_back(*role_lens);
        conds.push_back("role_lens = $" + std::to_string(vals.size()));
    }
    if (temperament && !temperament->empty()) {
        vals.emplace_back(*temperament);
        conds.push_back("temperament = $" + std::to_string(vals.size()));
    }
    const std::string where = conds.empty() ? "" : "WHERE " + join(conds, " AND ");
    return db.query("SELECT * FROM interviewer_personas " + where + " ORDER BY stage, pressure, id", vals);
}

std::optional<Json> get_interviewer(db::Database& db, const std::string& id) {
    auto rows = db.query("SELECT * FROM interviewer_personas WHERE id = $1", {id});
    if (rows.empty()) return std::nullopt;
    return rows[0];
}

db::Rows list_examinees(db::Database& db, const std::optional<std::string>& target_role) {
    if (target_role && !target_role->empty()) {
        return db.query("SELECT * FROM examinee_personas WHERE target_role = $1 ORDER BY id", {*target_role});
    }
    return db.query("SELECT * FROM examinee_personas ORDER BY id");
}

std::optional<Json> get_examinee(db::Database& db, const std::string& id) {
    auto rows = db.query("SELECT * FROM examinee_personas WHERE id = $1", {id});
    if (rows.empty()) return std::nullopt;
    return rows[0];
}

// ---- summary ----

std::optional<Json> get_summary(db::Database& db, const std::string& session_id) {
    auto rows = db.query("SELECT * FROM interview_summaries WHERE session_id = $1", {session_id});
    if (rows.empty()) return std::nullopt;
    return rows[0];
}

Json upsert_summary(db::Database& db, const std::string& session_id, const Json& doc, const std::string& model) {
    auto field = [&](const char* k) { return doc.contains(k) ? doc[k] : Json(nullptr); };
    auto rows = db.query(
        "INSERT INTO interview_summaries (session_id, headline, highlights, axes_summary, growth_points, carry_over, "
        "interviewer_note, model) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) "
        "ON CONFLICT (session_id) DO UPDATE SET headline = EXCLUDED.headline, highlights = EXCLUDED.highlights, "
        "axes_summary = EXCLUDED.axes_summary, growth_points = EXCLUDED.growth_points, carry_over = EXCLUDED.carry_over, "
        "interviewer_note = EXCLUDED.interviewer_note, model = EXCLUDED.model, generated_at = now() RETURNING *",
        {session_id, param_from_json(field("headline")), db::JsonParam{field("highlights")},
         db::JsonParam{field("axes_summary")}, db::JsonParam{field("growth_points")}, db::JsonParam{field("carry_over")},
         param_from_json(field("interviewer_note")), model});
    return rows.at(0);
}

// ---- brief ----

std::optional<StoredBrief> get_brief(db::Database& db, const std::string& session_id) {
    auto rows = db.query("SELECT body_md, source_meta, seed FROM interview_briefs WHERE session_id = $1", {session_id});
    if (rows.empty()) return std::nullopt;
    StoredBrief b;
    b.body_md = rows[0]["body_md"].get<std::string>();
    b.source_meta = as_object(rows[0]["source_meta"]);
    const Json& seed = rows[0]["seed"];  // BIGINT = 文字列
    const double v = seed.is_string() ? std::stod(seed.get<std::string>()) : seed.get<double>();
    b.seed = static_cast<std::uint32_t>(static_cast<std::int64_t>(v));
    return b;
}

StoredBrief save_brief_if_absent(db::Database& db, const std::string& session_id, const std::string& body_md,
                                 const Json& source_meta, std::uint32_t seed) {
    if (auto existing = get_brief(db, session_id)) return *existing;
    db.query(
        "INSERT INTO interview_briefs (session_id, body_md, source_meta, seed) VALUES ($1, $2, $3, $4) "
        "ON CONFLICT (session_id) DO NOTHING",
        {session_id, body_md, db::JsonParam{source_meta}, static_cast<std::int64_t>(seed)});
    auto stored = get_brief(db, session_id);
    if (!stored) throw std::runtime_error("interview_briefs の保存に失敗 (session=" + session_id + ")");
    return *stored;
}

}  // namespace tr::app
