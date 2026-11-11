// fuzz の入口: URL の分解・リダイレクト先の解決・SSRF の IP 判定 (外向き通信の前に必ず通る)。
#include <cstddef>
#include <cstdint>
#include <string_view>

#include "core/ip_policy.hpp"
#include "core/url.hpp"

extern "C" int LLVMFuzzerTestOneInput(const std::uint8_t* data, std::size_t size) {
    const std::string_view text(reinterpret_cast<const char*>(data), size);
    (void)tr::is_blocked_ip(text);
    (void)tr::parse_whatwg_ipv4(text);
    if (auto u = tr::parse_url(text)) {
        (void)u->to_string();
        (void)tr::resolve_url(*u, text);
        (void)tr::is_blocked_ip(u->host);
    }
    return 0;
}
