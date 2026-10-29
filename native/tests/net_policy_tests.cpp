// companies/ssrf-guard.test.ts の移植 (assertPublicUrl の判定部分) と URL 解析の境界。
#include "check.hpp"
#include "core/ip_policy.hpp"
#include "core/url.hpp"

using namespace tr;
using trtest::check;
using trtest::check_eq;

namespace {

// assertPublicUrl のリテラル IP 経路: URL として読めない / http(s) 以外 / 内部 IP は拒否。
bool literal_url_allowed(const std::string& raw) {
    auto u = parse_url(raw);
    if (!u || (u->scheme != "http" && u->scheme != "https")) return false;
    if (!u->host_is_ip) return true;  // 名前は解決後に検査 (http_client)
    return !is_blocked_ip(u->host);
}

}  // namespace

TEST_CASE("assertPublicUrl: blocks private/reserved v4") {
    for (const char* url : {"http://127.0.0.1/x", "http://127.1.2.3/x", "http://10.0.0.5/x", "http://172.16.5.5/x",
                            "http://172.31.255.255/x", "http://192.168.1.1/x", "http://169.254.169.254/latest/meta-data",
                            "http://100.64.0.1/x", "http://0.0.0.0/x", "http://224.0.0.1/x",
                            "http://255.255.255.255/x"}) {
        check(!literal_url_allowed(url), std::string("blocked: ") + url);
    }
}

TEST_CASE("assertPublicUrl: blocks private/reserved v6") {
    for (const char* url : {"http://[::1]/x", "http://[::]/x", "http://[fd00::1]/x", "http://[fe80::1]/x",
                            "http://[ff02::1]/x", "http://[::ffff:127.0.0.1]/x"}) {
        check(!literal_url_allowed(url), std::string("blocked: ") + url);
    }
}

TEST_CASE("assertPublicUrl: blocks non-http(s) protocols and malformed urls") {
    check(!literal_url_allowed("file:///etc/passwd"), "file");
    check(!literal_url_allowed("ftp://example.com/x"), "ftp");
    check(!literal_url_allowed("gopher://127.0.0.1/x"), "gopher");
    check(!literal_url_allowed("not a url"), "malformed");
}

TEST_CASE("assertPublicUrl: allows public literal IPs") {
    check(literal_url_allowed("http://8.8.8.8/x"), "8.8.8.8");
    check(literal_url_allowed("https://1.1.1.1/"), "1.1.1.1");
}

TEST_CASE("WHATWG IPv4 forms are normalized before the check (hex, octal, single number)") {
    check(!literal_url_allowed("http://0x7f000001/"), "hex");
    check(!literal_url_allowed("http://2130706433/"), "decimal");
    check(!literal_url_allowed("http://0177.0.0.1/"), "octal");
    check(!literal_url_allowed("http://127.1/"), "short form");
    check(!parse_url("http://1.2.3.256/").has_value(), "out of range number is invalid");
}

TEST_CASE("C++ only (stricter): NAT64 and 6to4 embedded private IPv4 are blocked") {
    check(is_blocked_ip("64:ff9b::7f00:1"), "nat64 loopback");
    check(is_blocked_ip("2002:c0a8:0101::1"), "6to4 192.168.1.1");
    check(!is_blocked_ip("2001:4860:4860::8888"), "public v6");
    check(is_blocked_ip("not-an-ip"), "unparseable is blocked");
}

TEST_CASE("url: credentials and IDN are rejected, redirects resolve") {
    check(!parse_url("http://user:pass@example.com/").has_value(), "userinfo");
    check(!parse_url("http://例え.jp/").has_value(), "non-ascii host");
    auto base = *parse_url("https://Example.COM:443/a/b?q=1#frag");
    check_eq(base.host, std::string("example.com"), "lowercase");
    check_eq(base.port, std::uint16_t{443}, "port");
    check_eq(base.target, std::string("/a/b?q=1"), "fragment dropped");
    check_eq(resolve_url(base, "../c")->to_string(), std::string("https://example.com/c"), "relative ..");
    check_eq(resolve_url(base, "/x?y")->to_string(), std::string("https://example.com/x?y"), "absolute path");
    check_eq(resolve_url(base, "//other.test/z")->to_string(), std::string("https://other.test/z"), "scheme-relative");
    check_eq(resolve_url(base, "http://127.0.0.1/")->host, std::string("127.0.0.1"), "absolute");
    check(!resolve_url(base, "javascript:alert(1)").has_value() ||
              resolve_url(base, "javascript:alert(1)")->host == "example.com",
          "non-http scheme is never followed to another host");
}

TEST_MAIN()
