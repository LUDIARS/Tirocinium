#pragma once
// 時刻は Unix epoch のミリ秒 (JS の Date と同じ精度) で持つ。

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>

namespace tr {

using EpochMs = std::int64_t;

EpochMs now_ms();

// new Date(ms).toISOString() と同じ "YYYY-MM-DDTHH:MM:SS.mmmZ"。
std::string iso_from_ms(EpochMs ms);
// "YYYY-MM-DD" (UTC)。
std::string date_from_ms(EpochMs ms);

// ISO 8601 (JS の Date.parse が受ける形の範囲) と Postgres の timestamptz の出力
// ("YYYY-MM-DD HH:MM:SS[.ffffff][+HH[:MM]]") を読む。オフセットの無い日時は UTC とみなす。
// 小数秒はミリ秒に切り捨てる (V8 と同じ)。
std::optional<EpochMs> parse_iso_ms(std::string_view text);

// 暦の計算 (proleptic Gregorian)。
std::int64_t days_from_civil(std::int64_t y, unsigned m, unsigned d);
void civil_from_days(std::int64_t z, std::int64_t& y, unsigned& m, unsigned& d);

struct UtcFields {
    std::int64_t year;
    unsigned month, day, hour, minute, second, millisecond;
};
UtcFields utc_fields(EpochMs ms);
EpochMs ms_from_utc(std::int64_t year, unsigned month, unsigned day, unsigned hour, unsigned minute,
                    unsigned second, unsigned millisecond);

}  // namespace tr
