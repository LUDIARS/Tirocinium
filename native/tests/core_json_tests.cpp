#include "check.hpp"
#include "core/json.hpp"

using tr::Json;
using trtest::check;
using trtest::check_eq;

TEST_CASE("js_stringify: numbers follow Number.prototype.toString") {
    check_eq(tr::js_number_to_string(3.0), std::string("3"), "integral double");
    check_eq(tr::js_number_to_string(2.1), std::string("2.1"), "shortest");
    check_eq(tr::js_number_to_string(0.1 + 0.2), std::string("0.30000000000000004"), "roundtrip digits");
    check_eq(tr::js_number_to_string(1e21), std::string("1e+21"), "exponent at 1e21");
    check_eq(tr::js_number_to_string(1e20), std::string("100000000000000000000"), "plain below 1e21");
    check_eq(tr::js_number_to_string(1e-7), std::string("1e-7"), "small exponent");
    check_eq(tr::js_number_to_string(0.000001), std::string("0.000001"), "1e-6 is plain");
    check_eq(tr::js_number_to_string(-2.5e-8), std::string("-2.5e-8"), "negative exponent form");
    check_eq(tr::js_number_to_string(-0.0), std::string("0"), "negative zero");
    check_eq(tr::js_number_to_string(123456789.125), std::string("123456789.125"), "fraction");
}

TEST_CASE("js_stringify: escapes like JSON.stringify and keeps insertion order") {
    Json v;
    v["z"] = "a\"b\\c\n\t\x01/é";
    v["a"] = Json::array({1, 2.5, true, nullptr});
    v["m"] = Json::object();
    check_eq(tr::js_stringify(v), std::string(R"({"z":"a\"b\\c\n\t\u0001/é","a":[1,2.5,true,null],"m":{}})"),
             "escape set and key order");
    check_eq(tr::js_stringify(Json(3.0)), std::string("3"), "float that is integral");
    check_eq(tr::js_stringify(Json(std::string("\xff"))), std::string("\"\xEF\xBF\xBD\""), "invalid utf-8 → U+FFFD");
}

TEST_CASE("parse_json: valid input and duplicate keys keep first position, last value") {
    auto v = tr::parse_json(R"({"a":1,"b":2,"a":3})");
    check(v.has_value(), "parsed");
    check_eq(tr::js_stringify(*v), std::string(R"({"a":3,"b":2})"), "duplicate key semantics of JSON.parse");
}

TEST_CASE("parse_json: depth limit exactly at the limit is accepted, limit+1 rejected") {
    tr::JsonLimits limits;
    limits.max_depth = 4;
    // depth の数え方は nlohmann の callback と同じ (最上位 = 0)。
    check(tr::parse_json("[[[[1]]]]", limits).has_value(), "4 nested arrays allowed");
    check(!tr::parse_json("[[[[[1]]]]]", limits).has_value(), "5 nested arrays rejected");
}

TEST_CASE("parse_json: size and element limits") {
    tr::JsonLimits limits;
    limits.max_bytes = 16;
    check(tr::parse_json(R"({"k":"01234567"})", limits).has_value(), "exactly 16 bytes ok");
    check(!tr::parse_json(R"({"k":"012345678"})", limits).has_value(), "17 bytes rejected");
    tr::JsonLimits elements;
    elements.max_elements = 5;
    check(tr::parse_json("[1,2,3]", elements).has_value(), "array + 3 values = 4 elements");
    check(!tr::parse_json("[1,2,3,4,5,6]", elements).has_value(), "7 elements rejected");
}

TEST_CASE("parse_json: broken and huge inputs are rejected without crashing") {
    check(!tr::parse_json("{").has_value(), "truncated");
    check(!tr::parse_json("").has_value(), "empty");
    check(!tr::parse_json("{\"a\":\"\x01\"}").has_value(), "raw control char");
    std::string deep(100000, '[');
    check(!tr::parse_json(deep).has_value(), "very deep nesting rejected by depth budget");
    std::string big = "[" + std::string(3 * 1024 * 1024, ' ') + "]";
    check(!tr::parse_json(big).has_value(), "over default 2 MiB rejected");
}

TEST_CASE("helpers: string_or / optional_string mirror typeof checks") {
    auto v = *tr::parse_json(R"({"s":"x","n":1})");
    check_eq(tr::string_or(v, "s"), std::string("x"), "string");
    check_eq(tr::string_or(v, "n", "fb"), std::string("fb"), "non-string falls back");
    check(!tr::optional_string(v, "missing").has_value(), "missing");
}

TEST_MAIN()
