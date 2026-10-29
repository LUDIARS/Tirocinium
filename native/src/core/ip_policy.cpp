#include "core/ip_policy.hpp"

#include <array>
#include <cstdio>
#include <cstdint>
#include <optional>
#include <vector>

#include "core/text.hpp"

namespace tr {
namespace {

std::optional<std::uint32_t> strict_v4(std::string_view ip) {
    auto parts = split(ip, '.');
    if (parts.size() != 4) return std::nullopt;
    std::uint32_t n = 0;
    for (const auto& p : parts) {
        if (p.empty() || p.size() > 3) return std::nullopt;
        unsigned o = 0;
        for (char c : p) {
            if (c < '0' || c > '9') return std::nullopt;
            o = o * 10 + static_cast<unsigned>(c - '0');
        }
        if (o > 255) return std::nullopt;
        n = (n << 8) | o;
    }
    return n;
}

bool blocked_v4(std::uint32_t ip) {
    struct Range {
        std::uint32_t net;
        int bits;
    };
    static constexpr std::array<Range, 14> ranges = {{
        {0x00000000, 8},   // "this" network
        {0x0A000000, 8},   // private
        {0x64400000, 10},  // CGNAT
        {0x7F000000, 8},   // loopback
        {0xA9FE0000, 16},  // link-local
        {0xAC100000, 12},  // private
        {0xC0000000, 24},  // IETF protocol assignments
        {0xC0000200, 24},  // TEST-NET-1
        {0xC0A80000, 16},  // private
        {0xC6120000, 15},  // benchmarking
        {0xC6336400, 24},  // TEST-NET-2
        {0xCB007100, 24},  // TEST-NET-3
        {0xE0000000, 4},   // multicast
        {0xF0000000, 4},   // reserved (incl. 255.255.255.255)
    }};
    for (const auto& r : ranges) {
        const std::uint32_t mask = r.bits == 0 ? 0 : (0xFFFFFFFFu << (32 - r.bits));
        if ((ip & mask) == (r.net & mask)) return true;
    }
    return false;
}

std::optional<std::array<std::uint16_t, 8>> expand_v6(std::string_view addr) {
    std::string a = ascii_lower(addr);
    if (const auto z = a.find('%'); z != std::string::npos) a = a.substr(0, z);  // zone id
    // 末尾 IPv4 記法
    const auto last_colon = a.rfind(':');
    if (last_colon != std::string::npos && a.find('.', last_colon) != std::string::npos) {
        auto v4 = strict_v4(std::string_view(a).substr(last_colon + 1));
        if (!v4) return std::nullopt;
        char buf[16];
        std::snprintf(buf, sizeof buf, "%x:%x", (*v4 >> 16) & 0xFFFF, *v4 & 0xFFFF);
        a = a.substr(0, last_colon + 1) + buf;
    }
    std::vector<std::string> head;
    std::vector<std::string> tail;
    const auto dbl = a.find("::");
    if (dbl != std::string::npos && a.find("::", dbl + 1) != std::string::npos) return std::nullopt;
    auto parse_group = [](const std::string& s, std::vector<std::string>& out) {
        if (s.empty()) return;
        for (auto& g : split(s, ':')) out.push_back(g);
    };
    if (dbl == std::string::npos) {
        parse_group(a, head);
        if (head.size() != 8) return std::nullopt;
    } else {
        parse_group(a.substr(0, dbl), head);
        parse_group(a.substr(dbl + 2), tail);
        if (head.size() + tail.size() > 7) return std::nullopt;
    }
    std::array<std::uint16_t, 8> words{};
    auto to_word = [](const std::string& g) -> std::optional<std::uint16_t> {
        if (g.empty() || g.size() > 4) return std::nullopt;
        unsigned v = 0;
        for (char c : g) {
            int d = -1;
            if (c >= '0' && c <= '9') d = c - '0';
            else if (c >= 'a' && c <= 'f') d = c - 'a' + 10;
            if (d < 0) return std::nullopt;
            v = v * 16 + static_cast<unsigned>(d);
        }
        return static_cast<std::uint16_t>(v);
    };
    std::size_t i = 0;
    for (const auto& g : head) {
        auto w = to_word(g);
        if (!w) return std::nullopt;
        words[i++] = *w;
    }
    i = 8 - tail.size();
    for (const auto& g : tail) {
        auto w = to_word(g);
        if (!w) return std::nullopt;
        words[i++] = *w;
    }
    return words;
}

bool blocked_v6(std::string_view ip) {
    auto w = expand_v6(ip);
    if (!w) return true;
    const auto& x = *w;
    bool zero7 = true;
    for (int i = 0; i < 7; ++i) zero7 = zero7 && x[i] == 0;
    if (zero7 && (x[7] == 0 || x[7] == 1)) return true;  // :: / ::1
    if ((x[0] & 0xFE00) == 0xFC00) return true;           // fc00::/7 ULA
    if ((x[0] & 0xFFC0) == 0xFE80) return true;           // fe80::/10 link-local
    if ((x[0] & 0xFF00) == 0xFF00) return true;           // ff00::/8 multicast
    if (x[0] == 0 && x[1] == 0 && x[2] == 0 && x[3] == 0 && x[4] == 0 && x[5] == 0xFFFF) {
        return blocked_v4((static_cast<std::uint32_t>(x[6]) << 16) | x[7]);  // IPv4-mapped
    }
    // Node 版より締める: NAT64 (64:ff9b::/96) と 6to4 (2002::/16) に埋め込まれた IPv4 も検査する。
    if (x[0] == 0x0064 && x[1] == 0xFF9B && x[2] == 0 && x[3] == 0 && x[4] == 0 && x[5] == 0) {
        return blocked_v4((static_cast<std::uint32_t>(x[6]) << 16) | x[7]);
    }
    if (x[0] == 0x2002) return blocked_v4((static_cast<std::uint32_t>(x[1]) << 16) | x[2]);
    return false;
}

}  // namespace

bool is_blocked_ip(std::string_view address) {
    if (address.find(':') != std::string_view::npos) return blocked_v6(address);
    auto v4 = strict_v4(address);
    if (!v4) return true;
    return blocked_v4(*v4);
}

}  // namespace tr
