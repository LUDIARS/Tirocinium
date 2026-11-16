// Postgres の値の変換 (postgres.js の既定 parse と同じ) の単体テスト。DB 不要。
#include "check.hpp"
#include "db/pg_decode.hpp"
#include "db/pg_range.hpp"

#include <climits>
#include <utility>

using namespace tr;
using trtest::check;
using trtest::check_eq;

TEST_CASE("decode: array literal parser handles quotes, escapes and NULL") {
    auto v = db::parse_array_literal(R"({"a b","c\"d",NULL,plain})");
    check(v.has_value() && v->size() == 4, "4 items");
    check_eq(*(*v)[1], std::string("c\"d"), "escaped quote");
    check(!(*v)[2].has_value(), "NULL");
    check(db::parse_array_literal("{}").value().empty(), "empty array");
    check(!db::parse_array_literal("{\"unterminated}").has_value(), "broken literal");
    check(!db::parse_array_literal("{{1},{2}}").has_value(), "multi-dimensional rejected");
    check_eq(db::to_array_literal({"x", "y\"z"}), std::string(R"({"x","y\"z"})"), "encode");
}

TEST_CASE("decode: result budget rejects an oversized value") {
    lorica::input_budget budget({8, 10, 10, 4});
    trtest::check_throws([&] { (void)db::decode_value("0123456789", db::oid::kText, budget); }, "over budget");
}

TEST_CASE("decode: scalar conversions") {
    lorica::input_budget budget({1 << 20, 1000, 1000, 64});
    check(db::decode_value("t", db::oid::kBool, budget) == true, "bool");
    check(db::decode_value("42", db::oid::kInt4, budget) == 42, "int4");
    check(db::decode_value("1.5", db::oid::kFloat8, budget) == 1.5, "float8");
    check(db::decode_value("12345678901234567890", db::oid::kInt8, budget) == "12345678901234567890", "int8 string");
    check(db::decode_value("2026-10-29 12:00:00.123456+00", db::oid::kTimestamptz, budget) == "2026-10-29T12:00:00.123Z",
          "timestamptz");
    check(db::decode_value("infinity", db::oid::kTimestamptz, budget).is_null(), "Invalid Date → null");
    check(db::decode_value("{\"a\":[1,2]}", db::oid::kJsonb, budget)["a"][1] == 2, "jsonb");
    check(db::decode_value("{1,NULL,3}", db::oid::kInt4Array, budget) == Json::array({1, nullptr, 3}), "int4[]");
    check(db::decode_value("[1,5]", 3904, budget) == "[1,5]", "int4range stays text");
    trtest::check_throws([&] { (void)db::decode_value("{bad", db::oid::kJsonb, budget); }, "broken json");
}

TEST_CASE("encode: params follow postgres.js type inference") {
    auto b = db::encode_param(db::Param{true});
    check(b.text == "true" && b.type_oid == db::oid::kBool, "bool typed");
    auto s = db::encode_param(db::Param{std::string("x")});
    check(s.type_oid == 0, "string untyped");
    auto j = db::encode_param(db::Param{db::JsonParam{Json{{"k", 1}}}});
    check(j.text == R"({"k":1})" && j.type_oid == db::oid::kJsonb, "json typed jsonb");
    auto n = db::encode_param(db::Param{db::Null{}});
    check(n.is_null, "null");
}

TEST_CASE("int4range: half-open and closed bounds become a closed [lo, hi]") {
    using P = std::pair<int, int>;
    check(db::parse_int4range_closed("[1,4)") == P{1, 3}, "half-open upper bound is decremented");
    check(db::parse_int4range_closed("[1,4]") == P{1, 4}, "closed upper bound is kept");
    check(db::parse_int4range_closed("[3,4)") == P{3, 3}, "single turn");
    check(db::parse_int4range_closed("[-5,-2)") == P{-5, -3}, "negative bounds");
    check(db::parse_int4range_closed("[ 1, +4)") == P{1, 3}, "whitespace and '+' as sscanf %d accepted them");
    check(db::parse_int4range_closed("[1,4)trailing") == P{1, 4}, "text after the second int is not read (last char decides)");
}

TEST_CASE("int4range: int boundaries") {
    using P = std::pair<int, int>;
    check(db::parse_int4range_closed("[-2147483648,2147483647]") == P{INT_MIN, INT_MAX}, "full int range, closed");
    check(db::parse_int4range_closed("[0,2147483647)") == P{0, INT_MAX - 1}, "max upper, half-open");
    check(!db::parse_int4range_closed("[0,-2147483648)").has_value(), "decrementing INT_MIN overflows -> rejected");
    check(!db::parse_int4range_closed("[0,2147483648)").has_value(), "upper bound above INT_MAX");
    check(!db::parse_int4range_closed("[-2147483649,0)").has_value(), "lower bound below INT_MIN");
}

TEST_CASE("int4range: unreadable values are rejected") {
    check(!db::parse_int4range_closed("").has_value(), "empty string");
    check(!db::parse_int4range_closed("[").has_value(), "bracket only");
    check(!db::parse_int4range_closed("empty").has_value(), "PG empty range");
    check(!db::parse_int4range_closed("[1,)").has_value(), "unbounded upper");
    check(!db::parse_int4range_closed("(,4)").has_value(), "unbounded lower");
    check(!db::parse_int4range_closed("[1;4)").has_value(), "missing comma");
    check(!db::parse_int4range_closed("[a,4)").has_value(), "non-numeric lower");
    check(!db::parse_int4range_closed("[+-1,4)").has_value(), "sign after '+'");
}

TEST_MAIN()
