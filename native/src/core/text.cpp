#include "core/text.hpp"

#include <algorithm>

namespace tr {
namespace {

constexpr char32_t kReplacement = 0xFFFD;

// 1 コードポイントを読む。不正なら kReplacement を返し、消費バイト数を 1 にする (WHATWG の置換規則に近い)。
char32_t next_cp(std::string_view s, std::size_t& i) {
    const auto b0 = static_cast<unsigned char>(s[i]);
    if (b0 < 0x80) {
        ++i;
        return b0;
    }
    auto cont = [&](std::size_t k) -> int {
        if (i + k >= s.size()) return -1;
        const auto b = static_cast<unsigned char>(s[i + k]);
        return (b & 0xC0) == 0x80 ? (b & 0x3F) : -1;
    };
    if (b0 >= 0xC2 && b0 <= 0xDF) {
        const int c1 = cont(1);
        if (c1 < 0) { ++i; return kReplacement; }
        i += 2;
        return (static_cast<char32_t>(b0 & 0x1F) << 6) | static_cast<char32_t>(c1);
    }
    if (b0 >= 0xE0 && b0 <= 0xEF) {
        const int c1 = cont(1);
        if (c1 < 0) { ++i; return kReplacement; }
        const char32_t partial = (static_cast<char32_t>(b0 & 0x0F) << 12) | (static_cast<char32_t>(c1) << 6);
        if (partial < 0x800 || (partial >= 0xD800 && partial <= 0xDFFF)) { ++i; return kReplacement; }
        const int c2 = cont(2);
        if (c2 < 0) { i += 2; return kReplacement; }
        i += 3;
        return partial | static_cast<char32_t>(c2);
    }
    if (b0 >= 0xF0 && b0 <= 0xF4) {
        const int c1 = cont(1);
        if (c1 < 0) { ++i; return kReplacement; }
        const char32_t p1 = (static_cast<char32_t>(b0 & 0x07) << 18) | (static_cast<char32_t>(c1) << 12);
        if (p1 < 0x10000 || p1 > 0x10FFFF) { ++i; return kReplacement; }
        const int c2 = cont(2);
        if (c2 < 0) { i += 2; return kReplacement; }
        const int c3 = cont(3);
        if (c3 < 0) { i += 3; return kReplacement; }
        i += 4;
        return p1 | (static_cast<char32_t>(c2) << 6) | static_cast<char32_t>(c3);
    }
    ++i;
    return kReplacement;
}

char32_t lower_cp(char32_t c) {
    if (c < 0x80) return (c >= 'A' && c <= 'Z') ? c + 0x20 : c;
    if (c >= 0xC0 && c <= 0xDE && c != 0xD7) return c + 0x20;
    if (c >= 0x100 && c <= 0x17F) {
        if (c == 0x130) return 0x69;  // 'İ' → 'i' (JS はさらに U+0307 を付けるが社名の照合では無視できる)
        if (c == 0x178) return 0xFF;
        if ((c >= 0x100 && c <= 0x12F) || (c >= 0x132 && c <= 0x137) || (c >= 0x14A && c <= 0x177))
            return (c % 2 == 0) ? c + 1 : c;
        if ((c >= 0x139 && c <= 0x148) || (c >= 0x179 && c <= 0x17E)) return (c % 2 == 1) ? c + 1 : c;
        return c;
    }
    if (c >= 0x391 && c <= 0x3A9 && c != 0x3A2) return c + 0x20;
    if (c == 0x386) return 0x3AC;
    if (c >= 0x388 && c <= 0x38A) return c + 37;
    if (c == 0x38C) return 0x3CC;
    if (c == 0x38E || c == 0x38F) return c + 63;
    if (c >= 0x410 && c <= 0x42F) return c + 0x20;
    if (c >= 0x400 && c <= 0x40F) return c + 0x50;
    if (c >= 0x2160 && c <= 0x216F) return c + 0x10;
    if (c >= 0x24B6 && c <= 0x24CF) return c + 26;
    if (c >= 0xFF21 && c <= 0xFF3A) return c + 0x20;
    return c;
}

}  // namespace

std::string sanitize_utf8(std::string_view s) {
    if (is_valid_utf8(s)) return std::string(s);
    std::string out;
    out.reserve(s.size() + 8);
    std::size_t i = 0;
    while (i < s.size()) append_utf8(out, next_cp(s, i));
    return out;
}

bool is_valid_utf8(std::string_view s) {
    std::size_t i = 0;
    while (i < s.size()) {
        if (static_cast<unsigned char>(s[i]) < 0x80) {
            ++i;
            continue;
        }
        const std::size_t before = i;
        const char32_t cp = next_cp(s, i);
        if (cp == kReplacement) {
            // 本物の U+FFFD (EF BF BD) は正しい列。
            if (!(i - before == 3 && static_cast<unsigned char>(s[before]) == 0xEF &&
                  static_cast<unsigned char>(s[before + 1]) == 0xBF &&
                  static_cast<unsigned char>(s[before + 2]) == 0xBD))
                return false;
        }
    }
    return true;
}

std::vector<char32_t> decode_utf8(std::string_view s) {
    std::vector<char32_t> out;
    out.reserve(s.size());
    std::size_t i = 0;
    while (i < s.size()) out.push_back(next_cp(s, i));
    return out;
}

void append_utf8(std::string& out, char32_t cp) {
    if (cp < 0x80) {
        out.push_back(static_cast<char>(cp));
    } else if (cp < 0x800) {
        out.push_back(static_cast<char>(0xC0 | (cp >> 6)));
        out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
    } else if (cp < 0x10000) {
        if (cp >= 0xD800 && cp <= 0xDFFF) cp = kReplacement;
        out.push_back(static_cast<char>(0xE0 | (cp >> 12)));
        out.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3F)));
        out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
    } else if (cp <= 0x10FFFF) {
        out.push_back(static_cast<char>(0xF0 | (cp >> 18)));
        out.push_back(static_cast<char>(0x80 | ((cp >> 12) & 0x3F)));
        out.push_back(static_cast<char>(0x80 | ((cp >> 6) & 0x3F)));
        out.push_back(static_cast<char>(0x80 | (cp & 0x3F)));
    } else {
        append_utf8(out, kReplacement);
    }
}

std::string encode_utf8(const std::vector<char32_t>& cps) {
    std::string out;
    out.reserve(cps.size());
    for (char32_t cp : cps) append_utf8(out, cp);
    return out;
}

std::size_t utf16_length(std::string_view s) {
    std::size_t n = 0;
    std::size_t i = 0;
    while (i < s.size()) n += next_cp(s, i) >= 0x10000 ? 2 : 1;
    return n;
}

std::string utf16_slice(std::string_view s, std::size_t start, std::size_t end) {
    std::string out;
    if (end <= start) return out;
    std::size_t unit = 0;
    std::size_t i = 0;
    while (i < s.size() && unit < end) {
        const char32_t cp = next_cp(s, i);
        const std::size_t width = cp >= 0x10000 ? 2 : 1;
        if (unit >= start && unit + width <= end) append_utf8(out, cp);
        unit += width;
    }
    return out;
}

bool is_js_space(char32_t c) {
    return (c >= 0x09 && c <= 0x0D) || c == 0x20 || c == 0xA0 || c == 0x1680 || (c >= 0x2000 && c <= 0x200A) ||
           c == 0x2028 || c == 0x2029 || c == 0x202F || c == 0x205F || c == 0x3000 || c == 0xFEFF;
}

std::string js_trim_start(std::string_view s) {
    std::size_t i = 0;
    while (i < s.size()) {
        std::size_t j = i;
        if (!is_js_space(next_cp(s, j))) break;
        i = j;
    }
    return std::string(s.substr(i));
}

std::string js_trim_end(std::string_view s) {
    // 末尾から: コードポイントの境界を前から数えて最後の非空白の終わりを探す。
    std::size_t i = 0;
    std::size_t last_end = 0;
    while (i < s.size()) {
        const char32_t cp = next_cp(s, i);
        if (!is_js_space(cp)) last_end = i;
    }
    return std::string(s.substr(0, last_end));
}

std::string js_trim(std::string_view s) { return js_trim_end(js_trim_start(s)); }

std::string js_to_lower(std::string_view s) {
    std::string out;
    out.reserve(s.size());
    std::size_t i = 0;
    while (i < s.size()) append_utf8(out, lower_cp(next_cp(s, i)));
    return out;
}

std::string ascii_lower(std::string_view s) {
    std::string out(s);
    for (auto& c : out) {
        if (c >= 'A' && c <= 'Z') c = static_cast<char>(c + 0x20);
    }
    return out;
}

bool starts_with(std::string_view s, std::string_view prefix) {
    return s.size() >= prefix.size() && s.compare(0, prefix.size(), prefix) == 0;
}

bool ends_with(std::string_view s, std::string_view suffix) {
    return s.size() >= suffix.size() && s.compare(s.size() - suffix.size(), suffix.size(), suffix) == 0;
}

std::vector<std::string> split(std::string_view s, char sep) {
    std::vector<std::string> out;
    std::size_t start = 0;
    while (true) {
        const auto pos = s.find(sep, start);
        if (pos == std::string_view::npos) {
            out.emplace_back(s.substr(start));
            break;
        }
        out.emplace_back(s.substr(start, pos - start));
        start = pos + 1;
    }
    return out;
}

std::vector<std::string> split_trim_nonempty(std::string_view s, char sep) {
    std::vector<std::string> out;
    for (auto& part : split(s, sep)) {
        auto t = js_trim(part);
        if (!t.empty()) out.push_back(std::move(t));
    }
    return out;
}

std::string join(const std::vector<std::string>& parts, std::string_view sep) {
    std::string out;
    for (std::size_t i = 0; i < parts.size(); ++i) {
        if (i) out += sep;
        out += parts[i];
    }
    return out;
}

bool is_lower_hex(std::string_view s, std::size_t length) {
    if (s.size() != length) return false;
    return std::all_of(s.begin(), s.end(), [](char c) { return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'); });
}

bool all_of_chars(std::string_view s, std::string_view allowed_extra, bool alnum) {
    return std::all_of(s.begin(), s.end(), [&](char c) {
        if (alnum && ((c >= '0' && c <= '9') || (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z'))) return true;
        return allowed_extra.find(c) != std::string_view::npos;
    });
}

}  // namespace tr
