#include "check.hpp"
#include "core/text.hpp"
#include "core/time.hpp"

using trtest::check;
using trtest::check_eq;

TEST_CASE("utf16 length and slice match JS string semantics") {
    check_eq(tr::utf16_length("abc"), std::size_t{3}, "ascii");
    check_eq(tr::utf16_length("面接"), std::size_t{2}, "BMP CJK");
    check_eq(tr::utf16_length("😀"), std::size_t{2}, "astral = surrogate pair");
    check_eq(tr::utf16_slice("面接練習", 1, 3), std::string("接練"), "slice by units");
    check_eq(tr::utf16_slice("a😀b", 0, 2), std::string("a"), "never splits a pair");
    check_eq(tr::utf16_slice("a😀b", 1, 3), std::string("😀"), "pair kept whole");
}

TEST_CASE("js_trim removes JS whitespace including ideographic space") {
    check_eq(tr::js_trim(" \t　面接 \n"), std::string("面接"), "trim");
    check_eq(tr::js_trim("   "), std::string(""), "all space");
}

TEST_CASE("js_to_lower covers ASCII, full-width and Cyrillic") {
    check_eq(tr::js_to_lower("ABC Ａｂ Привет"), std::string("abc ａｂ привет"), "lowercase");
}

TEST_CASE("split_trim_nonempty mirrors split(',').map(trim).filter(Boolean)") {
    auto v = tr::split_trim_nonempty("c1, c2 , ,c3", ',');
    check_eq(v.size(), std::size_t{3}, "count");
    check_eq(v[1], std::string("c2"), "trimmed");
}

TEST_CASE("iso_from_ms equals Date.prototype.toISOString") {
    check_eq(tr::iso_from_ms(0), std::string("1970-01-01T00:00:00.000Z"), "epoch");
    check_eq(tr::iso_from_ms(1793232000123), std::string("2026-10-29T00:00:00.123Z"), "ms");
    check_eq(tr::iso_from_ms(-1), std::string("1969-12-31T23:59:59.999Z"), "negative");
}

TEST_CASE("parse_iso_ms reads ISO 8601 and Postgres timestamptz output") {
    check_eq(*tr::parse_iso_ms("2026-10-29T00:00:00.123Z"), tr::EpochMs{1793232000123}, "Z");
    check_eq(*tr::parse_iso_ms("2026-10-29T09:00:00+09:00"), tr::EpochMs{1793232000000}, "offset");
    check_eq(*tr::parse_iso_ms("2026-10-29 00:00:00.123456+00"), tr::EpochMs{1793232000123}, "pg micro truncated");
    check_eq(*tr::parse_iso_ms("2026-10-29"), tr::EpochMs{1793232000000}, "date only = UTC");
    check(!tr::parse_iso_ms("2026-02-30").has_value(), "invalid day");
    check(!tr::parse_iso_ms("not a date").has_value(), "garbage");
    check(!tr::parse_iso_ms("2026-10-29T25:00:00Z").has_value(), "hour out of range");
}

TEST_MAIN()
