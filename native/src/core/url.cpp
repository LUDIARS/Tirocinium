#include "core/url.hpp"

#include <vector>

#include "core/text.hpp"

namespace tr {
namespace {

std::uint16_t default_port(const std::string& scheme) {
    return (scheme == "https" || scheme == "wss") ? 443 : 80;
}

bool valid_host_char(char c) {
    return (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-' || c == '.' || c == '_';
}

bool is_ipv6_literal(std::string_view s) {
    if (s.empty()) return false;
    for (char c : s) {
        if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || c == ':' || c == '.')) return false;
    }
    return s.find(':') != std::string_view::npos;
}

}  // namespace

std::optional<std::uint32_t> parse_whatwg_ipv4(std::string_view host) {
    if (host.empty()) return std::nullopt;
    if (host.back() == '.') host.remove_suffix(1);
    std::vector<std::string_view> parts;
    std::size_t start = 0;
    while (true) {
        const auto dot = host.find('.', start);
        parts.push_back(host.substr(start, dot == std::string_view::npos ? std::string_view::npos : dot - start));
        if (dot == std::string_view::npos) break;
        start = dot + 1;
    }
    if (parts.size() > 4) return std::nullopt;
    std::vector<std::uint64_t> nums;
    for (auto p : parts) {
        if (p.empty()) return std::nullopt;
        int base = 10;
        if (p.size() >= 2 && p[0] == '0' && (p[1] == 'x' || p[1] == 'X')) {
            base = 16;
            p.remove_prefix(2);
        } else if (p.size() >= 2 && p[0] == '0') {
            base = 8;
            p.remove_prefix(1);
        }
        std::uint64_t v = 0;
        for (char c : p) {
            int d = -1;
            if (c >= '0' && c <= '9') d = c - '0';
            else if (base == 16 && c >= 'a' && c <= 'f') d = c - 'a' + 10;
            else if (base == 16 && c >= 'A' && c <= 'F') d = c - 'A' + 10;
            if (d < 0 || d >= base) return std::nullopt;
            v = v * static_cast<std::uint64_t>(base) + static_cast<std::uint64_t>(d);
            if (v > 0xFFFFFFFFULL) return std::nullopt;
        }
        nums.push_back(v);
    }
    for (std::size_t i = 0; i + 1 < nums.size(); ++i) {
        if (nums[i] > 255) return std::nullopt;
    }
    const std::size_t rest_bytes = 5 - nums.size();
    if (nums.back() >= (1ULL << (8 * rest_bytes))) return std::nullopt;
    std::uint64_t ip = nums.back();
    for (std::size_t i = 0; i + 1 < nums.size(); ++i) ip += nums[i] << (8 * (3 - i));
    return static_cast<std::uint32_t>(ip);
}

std::string ipv4_to_string(std::uint32_t v) {
    return std::to_string((v >> 24) & 0xFF) + "." + std::to_string((v >> 16) & 0xFF) + "." +
           std::to_string((v >> 8) & 0xFF) + "." + std::to_string(v & 0xFF);
}

std::optional<Url> parse_url(std::string_view text) {
    text = std::string_view(text);
    const auto colon = text.find("://");
    if (colon == std::string_view::npos) return std::nullopt;
    Url u;
    u.scheme = ascii_lower(text.substr(0, colon));
    if (u.scheme != "http" && u.scheme != "https" && u.scheme != "ws" && u.scheme != "wss") return std::nullopt;
    std::string_view rest = text.substr(colon + 3);
    const auto end_auth = rest.find_first_of("/?#");
    std::string_view authority = rest.substr(0, end_auth);
    std::string_view tail = end_auth == std::string_view::npos ? std::string_view() : rest.substr(end_auth);
    if (authority.find('@') != std::string_view::npos) return std::nullopt;  // 認証情報は拒否
    std::string_view host_part = authority;
    std::string_view port_part;
    if (!authority.empty() && authority.front() == '[') {
        const auto close = authority.find(']');
        if (close == std::string_view::npos) return std::nullopt;
        host_part = authority.substr(1, close - 1);
        std::string_view after = authority.substr(close + 1);
        if (!after.empty()) {
            if (after.front() != ':') return std::nullopt;
            port_part = after.substr(1);
        }
        u.host = ascii_lower(host_part);
        if (!is_ipv6_literal(u.host)) return std::nullopt;
        u.host_is_ip = true;
    } else {
        const auto pc = authority.rfind(':');
        if (pc != std::string_view::npos) {
            host_part = authority.substr(0, pc);
            port_part = authority.substr(pc + 1);
        }
        u.host = ascii_lower(host_part);
        if (u.host.empty()) return std::nullopt;
        for (char c : u.host) {
            if (!valid_host_char(c)) return std::nullopt;
        }
        if (auto v4 = parse_whatwg_ipv4(u.host)) {
            u.host = ipv4_to_string(*v4);
            u.host_is_ip = true;
        } else {
            // WHATWG の "ends in a number": 最後のラベルが数字だけなら IPv4 として読めなかった時点で不正。
            auto labels = split(u.host, '.');
            if (labels.size() > 1 && labels.back().empty()) labels.pop_back();
            const std::string& last = labels.back();
            bool all_digits = !last.empty();
            for (char c : last) all_digits = all_digits && c >= '0' && c <= '9';
            if (all_digits) return std::nullopt;
        }
    }
    if (!port_part.empty()) {
        unsigned long p = 0;
        for (char c : port_part) {
            if (c < '0' || c > '9') return std::nullopt;
            p = p * 10 + static_cast<unsigned long>(c - '0');
            if (p > 65535) return std::nullopt;
        }
        u.port = static_cast<std::uint16_t>(p);
    } else {
        u.port = default_port(u.scheme);
    }
    const auto hash = tail.find('#');
    if (hash != std::string_view::npos) tail = tail.substr(0, hash);
    u.target = tail.empty() ? "/" : std::string(tail);
    if (u.target.front() == '?') u.target = "/" + u.target;
    for (char c : u.target) {
        if (static_cast<unsigned char>(c) <= 0x20 || c == 0x7F) return std::nullopt;  // 要求行に入れられない
    }
    return u;
}

std::string Url::host_header() const {
    std::string h = host.find(':') != std::string::npos ? "[" + host + "]" : host;
    if (port != default_port(scheme)) h += ":" + std::to_string(port);
    return h;
}

std::string Url::origin() const { return scheme + "://" + host_header(); }

std::string Url::to_string() const { return origin() + target; }

std::optional<Url> resolve_url(const Url& base, std::string_view ref) {
    if (ref.find("://") != std::string_view::npos) {
        // スキーム付き (http: 以外のスキームは parse_url が拒否する)
        const auto colon = ref.find("://");
        bool scheme_like = colon > 0;
        for (std::size_t i = 0; i < colon; ++i) {
            const char c = ref[i];
            if (!((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c == '+' || c == '-' || c == '.')) {
                scheme_like = false;
            }
        }
        if (scheme_like) return parse_url(ref);
    }
    if (starts_with(ref, "//")) return parse_url(base.scheme + ":" + std::string(ref));
    std::string path;
    if (!ref.empty() && ref.front() == '/') {
        path = std::string(ref);
    } else if (!ref.empty() && ref.front() == '?') {
        const auto q = base.target.find('?');
        path = base.target.substr(0, q) + std::string(ref);
    } else {
        const auto q = base.target.find('?');
        const std::string base_path = base.target.substr(0, q);
        const auto slash = base_path.rfind('/');
        path = base_path.substr(0, slash + 1) + std::string(ref);
    }
    // "." と ".." を畳む (クエリより前だけ)。
    const auto qpos = path.find_first_of("?#");
    std::string query = qpos == std::string::npos ? std::string() : path.substr(qpos);
    std::string p = path.substr(0, qpos);
    std::vector<std::string> segs;
    for (auto& s : split(p, '/')) {
        if (s == ".") continue;
        if (s == "..") {
            if (segs.size() > 1) segs.pop_back();
            continue;
        }
        segs.push_back(s);
    }
    std::string joined = join(segs, "/");
    if (joined.empty() || joined.front() != '/') joined = "/" + joined;
    if (!p.empty() && (ends_with(p, "/.") || ends_with(p, "/..")) && joined.back() != '/') joined.push_back('/');
    return parse_url(base.origin() + joined + query);
}

}  // namespace tr
