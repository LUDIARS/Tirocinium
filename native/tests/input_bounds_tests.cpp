// 外から入る入力の上限 (Lorica) の境界テスト: 上限ちょうど・上限 + 1・壊れた入力・巨大な入力。
// 対象: ファイルの読み込み、HTTP の要求ごとの予算と本文の JSON、JSON の上限の桁あふれ、WAV の走査、
// SSRF の名前解決結果の検査、正規表現を置き換えた走査の線形性。データはすべて合成。
#include <chrono>
#include <cstdint>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <limits>
#include <string>

#include <unistd.h>

#include "check.hpp"
#include "app/discord_bridge.hpp"
#include "app/services.hpp"
#include "app/voice.hpp"
#include "core/domain/domain.hpp"
#include "core/ip_policy.hpp"
#include "core/json.hpp"
#include "core/llm/output.hpp"
#include "http/request_budget.hpp"
#include "io/file_read.hpp"

using namespace tr;
using trtest::check;
using trtest::check_eq;
namespace fs = std::filesystem;

namespace {

struct TempFile {
    fs::path path;
    explicit TempFile(const std::string& content) {
        path = fs::temp_directory_path() / ("tr-bounds-" + std::to_string(::getpid()) + "-" + std::to_string(std::rand()));
        std::ofstream(path, std::ios::binary) << content;
    }
    ~TempFile() {
        std::error_code ec;
        fs::remove_all(path, ec);
    }
};

std::string le32(std::uint32_t v) {
    std::string s(4, '\0');
    for (int i = 0; i < 4; ++i) s[static_cast<std::size_t>(i)] = static_cast<char>((v >> (8 * i)) & 0xFF);
    return s;
}

std::string riff(const std::string& chunks) { return "RIFF" + le32(static_cast<std::uint32_t>(4 + chunks.size())) + "WAVE" + chunks; }

template <class F>
double seconds(F&& f) {
    const auto t0 = std::chrono::steady_clock::now();
    f();
    return std::chrono::duration<double>(std::chrono::steady_clock::now() - t0).count();
}

http::Request request_with_body(std::string body, std::size_t body_limit = 2 * 1024 * 1024) {
    http::Request r;
    r.method = "POST";
    r.body = std::move(body);
    auto limits = http::request_budget_limits({16 * 1024, body_limit});
    r.budget.emplace(*limits);
    if (!http::charge_body(*r.budget, r.body)) r.body_too_large = true;
    return r;
}

}  // namespace

// ---- ファイル ----------------------------------------------------------------------------------

TEST_CASE("file: exactly at the limit is read, limit + 1 is too_large, missing and directories are not_found") {
    TempFile at(std::string(1000, 'x'));
    auto r = io::read_file_bounded(at.path, 1000);
    check(r.status == io::FileReadStatus::ok && r.data.size() == 1000, "at limit");
    TempFile over(std::string(1001, 'x'));
    r = io::read_file_bounded(over.path, 1000);
    check(r.status == io::FileReadStatus::too_large && r.data.empty(), "limit + 1 (nothing returned)");
    check(io::read_file_bounded(at.path.string() + ".missing", 1000).status == io::FileReadStatus::not_found, "missing");
    check(io::read_file_bounded(fs::temp_directory_path(), 1000).status == io::FileReadStatus::not_found, "directory");
    TempFile empty("");
    r = io::read_file_bounded(empty.path, 0);
    check(r.status == io::FileReadStatus::ok && r.data.empty(), "empty file with zero limit");
}

TEST_CASE("file: a large file stops at the limit (more than one read chunk), shared budget is honoured") {
    TempFile big(std::string(3 * 1024 * 1024, 'y'));
    check(io::read_file_bounded(big.path, 1024 * 1024).status == io::FileReadStatus::too_large, "3 MiB vs 1 MiB");
    lorica::input_budget budget({1500, 0, 2, 0});
    TempFile a(std::string(1000, 'a'));
    check(io::read_file_bounded(a.path, 1000, budget).status == io::FileReadStatus::ok, "first file fits");
    check(io::read_file_bounded(a.path, 1000, budget).status == io::FileReadStatus::too_large, "budget exhausted");
}

// ---- HTTP の要求ごとの予算 --------------------------------------------------------------------

TEST_CASE("request budget: limits derive from the route limit with checked arithmetic (overflow refuses)") {
    auto l = http::request_budget_limits({16 * 1024, 2 * 1024 * 1024});
    check(l.has_value(), "normal");
    check_eq(l->bytes, std::size_t{16 * 1024 + 3 * 2 * 1024 * 1024 + 64 * 1024}, "bytes = header + 3 x body + 64 KiB");
    check_eq(l->depth, std::size_t{64}, "depth");
    check(!http::request_budget_limits({16 * 1024, std::numeric_limits<std::size_t>::max() / 2}).has_value(), "overflow");
}

TEST_CASE("request budget: header fields at the cap pass, cap + 1 is refused") {
    auto limits = http::request_budget_limits({16 * 1024, 1024});
    std::vector<std::pair<std::string, std::string>> fields(http::kMaxHeaderFields, {"x", "1"});
    lorica::input_budget b1(*limits);
    check(http::charge_headers(b1, fields), "1024 fields");
    fields.emplace_back("x", "1");
    lorica::input_budget b2(*limits);
    check(!http::charge_headers(b2, fields), "1025 fields");
    // 回帰: 同じ名前のフィールドは http::Headers で 1 件に畳まれるので、受け口は受信したままの数で課金する。
    http::Headers merged;
    for (const auto& [n, v] : fields) merged.append(n, v);
    check_eq(merged.items().size(), std::size_t{1}, "Headers folds repeated names (why the raw count is used)");
    lorica::input_budget b3(*limits);
    check(!http::charge_header_block(b3, fields.size(), 0), "raw count 1025 is refused");
    lorica::input_budget b4(*limits);
    check(http::charge_header_block(b4, http::kMaxHeaderFields, 0), "raw count 1024 passes");
    std::size_t total = std::numeric_limits<std::size_t>::max() - 3;
    check(!http::add_header_line(total, 0, 0), "line length overflow is refused");
}

TEST_CASE("request body JSON: within bytes but over the element budget is refused (400), at the budget is read") {
    // 要素の予算 = JSON 200,000 + ヘッダ 1,024 (この要求はヘッダを課金していないので全部が JSON に使える)。
    const std::size_t cap = http::request_budget_limits({})->elements;
    check_eq(cap, std::size_t{201'024}, "element budget");
    auto array_of = [](std::size_t values) {
        std::string s = "[";
        for (std::size_t i = 0; i < values; ++i) s += i ? ",0" : "0";
        return s + "]";
    };
    auto at = request_with_body(array_of(cap - 1));  // 配列そのもの 1 + 値 cap - 1
    check(!at.body_too_large, "under the byte limit");
    check(app::read_json_body(at).has_value(), "exactly the element budget");
    auto over = request_with_body(array_of(cap));
    check(!app::read_json_body(over).has_value(), "element budget + 1");
}

TEST_CASE("request body JSON: body over the route limit is flagged before parsing; broken and deep JSON refused") {
    auto big = request_with_body(std::string(1025, ' '), 1024);
    // 予算は本文上限の 3 倍あるので、受け口の 413 は経路の上限 (Content-Length / Beast) が決める。予算はその後ろの守り。
    check(!big.body_too_large, "budget alone keeps headroom for parsing");
    auto broken = request_with_body("{\"a\":");
    check(!app::read_json_body(broken).has_value(), "broken");
    // 深さの数え方は core_json_tests と同じ (nlohmann の callback の depth、最上位 = 0、上限 64)。
    // 64 重の配列の中の値は深さ 64 (ちょうど)、65 重なら深さ 65 (+1)。空の配列は一番内側の配列が最も深い。
    auto ok_deep = request_with_body(std::string(64, '[') + "0" + std::string(64, ']'));
    check(app::read_json_body(ok_deep).has_value(), "value at depth 64 (exactly the limit)");
    auto deep = request_with_body(std::string(65, '[') + "0" + std::string(65, ']'));
    check(!app::read_json_body(deep).has_value(), "value at depth 65 (limit + 1)");
    auto ok_empty = request_with_body(std::string(65, '[') + std::string(65, ']'));
    check(app::read_json_body(ok_empty).has_value(), "innermost empty array at depth 64");
    auto deep_empty = request_with_body(std::string(66, '[') + std::string(66, ']'));
    check(!app::read_json_body(deep_empty).has_value(), "innermost empty array at depth 65");
    http::Request no_budget;  // 受け口を通らない要求 (単体テスト) でも予算を作って読む
    no_budget.body = R"({"a":1})";
    check(app::read_json_body(no_budget).has_value(), "lazy budget");
}

TEST_CASE("json limits: max_bytes near SIZE_MAX does not wrap the budget (refused instead)") {
    JsonLimits l;
    l.max_bytes = std::numeric_limits<std::size_t>::max();
    check(!parse_json("{}", l).has_value(), "overflowing limit refuses");
    l.max_bytes = 2;
    check(parse_json("{}", l).has_value(), "exactly at max_bytes");
    check(!parse_json("{ }", l).has_value(), "max_bytes + 1");
}

// ---- WAV (VOICEVOX の応答) ----------------------------------------------------------------------

TEST_CASE("wav: data chunk exactly fills the buffer; declared length beyond the buffer is clipped") {
    check_eq(app::extract_wav_data(riff("data" + le32(4) + "abcd")), std::string("abcd"), "exact");
    check_eq(app::extract_wav_data(riff("data" + le32(100) + "ab")), std::string("ab"), "clipped like subarray");
    check_eq(app::extract_wav_data(riff("data" + le32(0))), std::string(), "empty data at the end");
}

TEST_CASE("wav: odd chunk padding, huge chunk length and truncated headers are rejected without overrun") {
    check_eq(app::extract_wav_data(riff("junk" + le32(3) + "abc" + std::string(1, '\0') + "data" + le32(2) + "xy")),
             std::string("xy"), "padding skipped");
    trtest::check_throws([] { (void)app::extract_wav_data(riff("LIST" + le32(0xFFFFFFFFu) + "xx")); }, "huge length");
    trtest::check_throws([] { (void)app::extract_wav_data(riff("junk" + le32(3) + "abc")); }, "padding byte missing");
    trtest::check_throws([] { (void)app::extract_wav_data("RIFF" + le32(0) + "WAVEda"); }, "truncated chunk header");
    trtest::check_throws([] { (void)app::extract_wav_data("RIFF"); }, "too short");
    trtest::check_throws([] { (void)app::extract_wav_data(std::string(12, 'x')); }, "not RIFF");
}

// ---- SSRF (名前解決の結果で接続先を固定する) ------------------------------------------------------

TEST_CASE("ssrf: every resolved address is vetted; one internal address rejects the whole name") {
    const std::vector<std::string> pub = {"93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"};
    auto ok = vet_resolved_addresses(pub, true);
    check(ok.has_value() && *ok == pub, "the vetted list is exactly what is connected to");
    check(!vet_resolved_addresses({"93.184.216.34", "127.0.0.1"}, true).has_value(), "mixed public + loopback");
    check(!vet_resolved_addresses({"93.184.216.34", "::ffff:10.0.0.1"}, true).has_value(), "mapped private");
    check(!vet_resolved_addresses({}, true).has_value(), "empty answer");
    check(vet_resolved_addresses({"127.0.0.1"}, false).has_value(), "internal allowed when public_only is off");
    check(is_blocked_ip("::7f00:1"), "IPv4-compatible ::127.0.0.1 (deprecated form) is blocked");
    check(is_blocked_ip("::a00:1"), "IPv4-compatible ::10.0.0.1 is blocked");
    check(!is_blocked_ip("::5db8:d822"), "IPv4-compatible public stays allowed");
}

// ---- 正規表現の二乗時間 (前進走査の線形性) ----------------------------------------------------------

TEST_CASE("linear scans: 2 MB adversarial inputs finish quickly (no quadratic backtracking)") {
    const std::string ticks(2'000'000, '`');
    double t = seconds([&] {
        try {
            (void)llm::extract_json_block(ticks);
        } catch (const std::runtime_error&) {
        }
    });
    check(t < 2.0, "``` without a close");
    std::string braces(1'000'000, '{');
    t = seconds([&] {
        try {
            (void)llm::extract_json_block(braces);
        } catch (const std::runtime_error&) {
        }
    });
    check(t < 2.0, "only opening braces");
    t = seconds([&] { (void)domain::normalize_name(std::string(1'000'000, '(')); });
    check(t < 2.0, "unclosed parentheses");
    t = seconds([&] { (void)domain::normalize_name("co." + std::string(1'000'000, ' ')); });
    check(t < 2.0, "co. followed by spaces");
    std::string dashes;
    for (int i = 0; i < 300'000; ++i) dashes += "12-";
    t = seconds([&] { (void)app::review_body_has_contact(dashes); });
    check(t < 2.0, "phone-like near misses");
}

TEST_MAIN()
