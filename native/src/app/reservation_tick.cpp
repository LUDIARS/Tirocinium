#include "app/reservation_tick.hpp"

#include "core/domain/domain.hpp"

namespace tr::app {

TickCounts tick_now(Services& s, EpochMs now) {
    const EpochMs horizon = 24LL * 60 * 60'000;
    auto rows = s.db.query(
        "SELECT id, user_id, slot_start, status, notify_sent FROM reservations WHERE status = 'held' AND slot_start BETWEEN $1 AND $2",
        {iso_from_ms(now - horizon), iso_from_ms(now + horizon)});
    TickCounts c;
    for (const auto& r : rows) {
        domain::ReservationRow row;
        row.id = r["id"];
        row.user_id = r["user_id"];
        row.slot_start = parse_iso_ms(r["slot_start"].get<std::string>()).value_or(0);
        row.status = r["status"];
        row.notify_sent = r["notify_sent"].get<bool>();
        const Json data{{"reservation_id", row.id}, {"slot_start", iso_from_ms(row.slot_start)}};
        for (const auto& a : domain::decide_actions_for(row, now, s.config.no_show_timeout_min, s.config.notify_lead_min,
                                                         s.slot_duration_env)) {
            if (a.kind == "notify_lead") {
                auto res = push_notification(s, row.user_id, "Tirocinium 面接の開始時刻が近づいています",
                                             std::to_string(a.lead_min) + " 分後に開始予定の面接 slot です。 開始ボタンの準備を。", data);
                if (res.ok) {
                    s.db.query("UPDATE reservations SET notify_sent = true WHERE id = $1", {row.id});
                    ++c.notified;
                }
            } else if (a.kind == "mark_no_show") {
                s.db.transaction([&](db::Database& tx) {
                    tx.query("UPDATE reservations SET status = 'no_show' WHERE id = $1 AND status = 'held'", {row.id});
                    tx.query("UPDATE reservation_slots SET used = GREATEST(used - 1, 0), updated_at = now() WHERE slot_start = $1",
                             {iso_from_ms(row.slot_start)});
                });
                ++c.marked_no_show;
            } else if (a.kind == "ready_to_start") {
                ++c.ready_to_start;
                (void)push_notification(s, row.user_id, "Tirocinium 面接の時間です",
                                        "予約 slot が開始しました。 5 分以内に開始ボタンを押してください。", data);
            }
        }
    }
    return c;
}

}  // namespace tr::app
