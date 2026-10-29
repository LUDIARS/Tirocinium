#include "core/encoding.hpp"

#include <array>
#include <cstdint>

namespace tr {
namespace {

constexpr char kStd[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
constexpr char kUrl[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

std::string encode(std::string_view bytes, const char* table, bool pad) {
    std::string out;
    out.reserve((bytes.size() + 2) / 3 * 4);
    std::size_t i = 0;
    while (i + 3 <= bytes.size()) {
        const std::uint32_t n = (static_cast<std::uint8_t>(bytes[i]) << 16) |
                                (static_cast<std::uint8_t>(bytes[i + 1]) << 8) | static_cast<std::uint8_t>(bytes[i + 2]);
        out.push_back(table[(n >> 18) & 63]);
        out.push_back(table[(n >> 12) & 63]);
        out.push_back(table[(n >> 6) & 63]);
        out.push_back(table[n & 63]);
        i += 3;
    }
    const std::size_t rest = bytes.size() - i;
    if (rest == 1) {
        const std::uint32_t n = static_cast<std::uint8_t>(bytes[i]) << 16;
        out.push_back(table[(n >> 18) & 63]);
        out.push_back(table[(n >> 12) & 63]);
        if (pad) out += "==";
    } else if (rest == 2) {
        const std::uint32_t n = (static_cast<std::uint8_t>(bytes[i]) << 16) | (static_cast<std::uint8_t>(bytes[i + 1]) << 8);
        out.push_back(table[(n >> 18) & 63]);
        out.push_back(table[(n >> 12) & 63]);
        out.push_back(table[(n >> 6) & 63]);
        if (pad) out.push_back('=');
    }
    return out;
}

int value_of(char c, bool url) {
    if (c >= 'A' && c <= 'Z') return c - 'A';
    if (c >= 'a' && c <= 'z') return c - 'a' + 26;
    if (c >= '0' && c <= '9') return c - '0' + 52;
    if (url) {
        if (c == '-') return 62;
        if (c == '_') return 63;
    } else {
        if (c == '+') return 62;
        if (c == '/') return 63;
    }
    return -1;
}

// 末尾の余りビットが 0 であること (同じバイト列に別表記を許さない) まで検査する。
std::optional<std::string> decode_strict(std::string_view text, bool url) {
    if (text.size() % 4 == 1) return std::nullopt;
    std::string out;
    out.reserve(text.size() * 3 / 4);
    std::uint32_t acc = 0;
    int bits = 0;
    for (char c : text) {
        const int v = value_of(c, url);
        if (v < 0) return std::nullopt;
        acc = (acc << 6) | static_cast<std::uint32_t>(v);
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            out.push_back(static_cast<char>((acc >> bits) & 0xFF));
        }
    }
    if (bits > 0 && (acc & ((1u << bits) - 1)) != 0) return std::nullopt;
    return out;
}

}  // namespace

std::string base64_encode(std::string_view bytes) { return encode(bytes, kStd, true); }
std::string base64url_encode(std::string_view bytes) { return encode(bytes, kUrl, false); }

std::optional<std::string> base64url_decode_strict(std::string_view text) { return decode_strict(text, true); }

std::optional<std::string> base64_decode_strict(std::string_view text) {
    std::size_t pad = 0;
    while (!text.empty() && text.back() == '=' && pad < 2) {
        text.remove_suffix(1);
        ++pad;
    }
    if (pad > 0 && (text.size() + pad) % 4 != 0) return std::nullopt;
    return decode_strict(text, false);
}

std::string base64_decode_lenient(std::string_view text) {
    std::string out;
    std::uint32_t acc = 0;
    int bits = 0;
    for (char c : text) {
        if (c == '=') break;
        int v = value_of(c, false);
        if (v < 0) v = value_of(c, true);
        if (v < 0) continue;
        acc = (acc << 6) | static_cast<std::uint32_t>(v);
        bits += 6;
        if (bits >= 8) {
            bits -= 8;
            out.push_back(static_cast<char>((acc >> bits) & 0xFF));
        }
    }
    return out;
}

std::string hex_encode(std::string_view bytes) {
    static constexpr char hex[] = "0123456789abcdef";
    std::string out;
    out.reserve(bytes.size() * 2);
    for (unsigned char c : bytes) {
        out.push_back(hex[c >> 4]);
        out.push_back(hex[c & 0xF]);
    }
    return out;
}

}  // namespace tr
