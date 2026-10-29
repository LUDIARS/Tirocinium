#include "core/time.hpp"

#include <chrono>
#include <cstdio>

namespace tr {

EpochMs now_ms() {
    using namespace std::chrono;
    return duration_cast<milliseconds>(system_clock::now().time_since_epoch()).count();
}

std::int64_t days_from_civil(std::int64_t y, unsigned m, unsigned d) {
    y -= m <= 2;
    const std::int64_t era = (y >= 0 ? y : y - 399) / 400;
    const auto yoe = static_cast<unsigned>(y - era * 400);
    const unsigned doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1;
    const unsigned doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    return era * 146097 + static_cast<std::int64_t>(doe) - 719468;
}

void civil_from_days(std::int64_t z, std::int64_t& y, unsigned& m, unsigned& d) {
    z += 719468;
    const std::int64_t era = (z >= 0 ? z : z - 146096) / 146097;
    const auto doe = static_cast<unsigned>(z - era * 146097);
    const unsigned yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    y = static_cast<std::int64_t>(yoe) + era * 400;
    const unsigned doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    const unsigned mp = (5 * doy + 2) / 153;
    d = doy - (153 * mp + 2) / 5 + 1;
    m = mp < 10 ? mp + 3 : mp - 9;
    y += m <= 2;
}

UtcFields utc_fields(EpochMs ms) {
    std::int64_t days = ms / 86'400'000;
    std::int64_t rem = ms % 86'400'000;
    if (rem < 0) {
        rem += 86'400'000;
        --days;
    }
    UtcFields f{};
    civil_from_days(days, f.year, f.month, f.day);
    f.hour = static_cast<unsigned>(rem / 3'600'000);
    f.minute = static_cast<unsigned>((rem / 60'000) % 60);
    f.second = static_cast<unsigned>((rem / 1000) % 60);
    f.millisecond = static_cast<unsigned>(rem % 1000);
    return f;
}

EpochMs ms_from_utc(std::int64_t year, unsigned month, unsigned day, unsigned hour, unsigned minute,
                    unsigned second, unsigned millisecond) {
    return days_from_civil(year, month, day) * 86'400'000 + static_cast<EpochMs>(hour) * 3'600'000 +
           static_cast<EpochMs>(minute) * 60'000 + static_cast<EpochMs>(second) * 1000 + millisecond;
}

std::string iso_from_ms(EpochMs ms) {
    const UtcFields f = utc_fields(ms);
    char buf[64];
    if (f.year >= 0 && f.year <= 9999) {
        std::snprintf(buf, sizeof buf, "%04lld-%02u-%02uT%02u:%02u:%02u.%03uZ", static_cast<long long>(f.year), f.month,
                      f.day, f.hour, f.minute, f.second, f.millisecond);
    } else {
        // 拡張年 (JS は ±YYYYYY)。
        std::snprintf(buf, sizeof buf, "%c%06lld-%02u-%02uT%02u:%02u:%02u.%03uZ", f.year < 0 ? '-' : '+',
                      static_cast<long long>(f.year < 0 ? -f.year : f.year), f.month, f.day, f.hour, f.minute,
                      f.second, f.millisecond);
    }
    return buf;
}

std::string date_from_ms(EpochMs ms) { return iso_from_ms(ms).substr(0, 10); }

namespace {

bool digits(std::string_view s, std::size_t pos, std::size_t n, unsigned& out) {
    if (pos + n > s.size()) return false;
    unsigned v = 0;
    for (std::size_t i = 0; i < n; ++i) {
        const char c = s[pos + i];
        if (c < '0' || c > '9') return false;
        v = v * 10 + static_cast<unsigned>(c - '0');
    }
    out = v;
    return true;
}

unsigned days_in_month(std::int64_t y, unsigned m) {
    static constexpr unsigned table[] = {31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31};
    if (m == 2) {
        const bool leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
        return leap ? 29 : 28;
    }
    return table[m - 1];
}

}  // namespace

std::optional<EpochMs> parse_iso_ms(std::string_view s) {
    // trim
    while (!s.empty() && (s.front() == ' ' || s.front() == '\t')) s.remove_prefix(1);
    while (!s.empty() && (s.back() == ' ' || s.back() == '\t')) s.remove_suffix(1);
    unsigned year = 0, month = 1, day = 1, hour = 0, minute = 0, second = 0, ms = 0;
    std::size_t p = 0;
    if (!digits(s, 0, 4, year)) return std::nullopt;
    p = 4;
    if (p < s.size() && s[p] == '-') {
        if (!digits(s, p + 1, 2, month)) return std::nullopt;
        p += 3;
        if (p < s.size() && s[p] == '-') {
            if (!digits(s, p + 1, 2, day)) return std::nullopt;
            p += 3;
        }
    }
    if (month < 1 || month > 12 || day < 1 || day > days_in_month(year, month)) return std::nullopt;
    int offset_min = 0;
    if (p < s.size() && (s[p] == 'T' || s[p] == 't' || s[p] == ' ')) {
        ++p;
        if (!digits(s, p, 2, hour) || p + 2 >= s.size() || s[p + 2] != ':' || !digits(s, p + 3, 2, minute))
            return std::nullopt;
        p += 5;
        if (p < s.size() && s[p] == ':') {
            if (!digits(s, p + 1, 2, second)) return std::nullopt;
            p += 3;
            if (p < s.size() && (s[p] == '.' || s[p] == ',')) {
                ++p;
                std::size_t n = 0;
                unsigned frac = 0;
                while (p < s.size() && s[p] >= '0' && s[p] <= '9') {
                    if (n < 3) frac = frac * 10 + static_cast<unsigned>(s[p] - '0');
                    ++n;
                    ++p;
                }
                if (n == 0) return std::nullopt;
                while (n < 3) {
                    frac *= 10;
                    ++n;
                }
                ms = frac;
            }
        }
        if (hour > 24 || minute > 59 || second > 59) return std::nullopt;
        if (hour == 24 && (minute || second || ms)) return std::nullopt;
        if (p < s.size()) {
            if (s[p] == 'Z' || s[p] == 'z') {
                ++p;
            } else if (s[p] == '+' || s[p] == '-') {
                const int sign = s[p] == '-' ? -1 : 1;
                unsigned oh = 0, om = 0;
                if (!digits(s, p + 1, 2, oh)) return std::nullopt;
                p += 3;
                if (p < s.size() && s[p] == ':') {
                    if (!digits(s, p + 1, 2, om)) return std::nullopt;
                    p += 3;
                } else if (p + 1 < s.size() && s[p] >= '0' && s[p] <= '9') {
                    if (!digits(s, p, 2, om)) return std::nullopt;
                    p += 2;
                }
                if (oh > 23 || om > 59) return std::nullopt;
                offset_min = sign * static_cast<int>(oh * 60 + om);
            }
        }
    }
    if (p != s.size()) return std::nullopt;
    return ms_from_utc(year, month, day, hour, minute, second, ms) - static_cast<EpochMs>(offset_min) * 60'000;
}

}  // namespace tr
