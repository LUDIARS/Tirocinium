#pragma once
// reservation/tick.ts: 直近 ±24 時間の held 予約を 1 分ごとに検査し、15 分前通知・no_show 確定・開始通知を行う。

#include "app/services.hpp"

namespace tr::app {

struct TickCounts {
    int notified = 0;
    int marked_no_show = 0;
    int ready_to_start = 0;
};

TickCounts tick_now(Services& s, EpochMs now);

}  // namespace tr::app
