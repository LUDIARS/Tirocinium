#include "core/paseto.hpp"

#include <cstdint>

#include "core/encoding.hpp"
#include "core/text.hpp"

namespace tr::paseto {
namespace {

void append_le64(std::string& out, std::uint64_t n) {
    n &= 0x7FFFFFFFFFFFFFFFULL;  // 仕様どおり最上位ビットを落とす
    for (int i = 0; i < 8; ++i) {
        out.push_back(static_cast<char>(n & 0xFF));
        n >>= 8;
    }
}

}  // namespace

std::optional<V4PublicParts> split_v4_public(std::string_view token) {
    if (!starts_with(token, kV4PublicHeader)) return std::nullopt;
    std::string_view rest = token.substr(kV4PublicHeader.size());
    std::string_view body = rest;
    std::string_view footer;
    if (const auto dot = rest.find('.'); dot != std::string_view::npos) {
        body = rest.substr(0, dot);
        footer = rest.substr(dot + 1);
        if (footer.find('.') != std::string_view::npos) return std::nullopt;  // split('.') が 3 個以上
    }
    auto raw = base64url_decode_strict(body);
    if (!raw || raw->size() < 64) return std::nullopt;
    auto f = base64url_decode_strict(footer);
    if (!f) return std::nullopt;
    V4PublicParts parts;
    parts.message = raw->substr(0, raw->size() - 64);
    parts.signature = raw->substr(raw->size() - 64);
    parts.footer = std::move(*f);
    return parts;
}

std::string pae(const std::vector<std::string_view>& pieces) {
    std::string out;
    append_le64(out, pieces.size());
    for (auto p : pieces) {
        append_le64(out, p.size());
        out.append(p);
    }
    return out;
}

std::string signing_input(const V4PublicParts& parts) {
    return pae({kV4PublicHeader, parts.message, parts.footer, std::string_view()});
}

std::optional<Json> parse_payload(std::string_view message) {
    JsonLimits limits;
    limits.max_bytes = 64 * 1024;
    limits.max_elements = 4096;
    limits.max_depth = 16;
    auto v = parse_json(message, limits);
    if (!v || !v->is_object()) return std::nullopt;
    return v;
}

namespace {

// new Date(x).getTime() が NaN か 0 なら paseto は "must be a valid ISO8601 string" にする (!iat の判定)。
std::optional<EpochMs> claim_time(const Json& v) {
    auto t = parse_iso_ms(v.get<std::string>());
    if (!t || *t == 0) return std::nullopt;
    return t;
}

}  // namespace

std::optional<std::string> assert_payload(const Json& payload, const std::optional<std::string>& audience, EpochMs now) {
    auto has = [&](const char* k) { return payload.contains(k); };
    if (has("iss") && !payload["iss"].is_string()) return "payload.iss must be a string";
    if (has("sub") && !payload["sub"].is_string()) return "payload.sub must be a string";
    if (has("aud") && !payload["aud"].is_string()) return "payload.aud must be a string";
    if (audience) {
        if (!has("aud") || payload["aud"].get<std::string>() != *audience) return "audience mismatch";
    }
    if (has("iat")) {
        if (!payload["iat"].is_string()) return "payload.iat must be a string";
        auto iat = claim_time(payload["iat"]);
        if (!iat) return "payload.iat must be a valid ISO8601 string";
        if (*iat > now) return "token issued in the future";
    }
    if (has("nbf")) {
        if (!payload["nbf"].is_string()) return "payload.nbf must be a string";
        auto nbf = claim_time(payload["nbf"]);
        if (!nbf) return "payload.nbf must be a valid ISO8601 string";
        if (*nbf > now) return "token is not active yet";
    }
    if (has("exp")) {
        if (!payload["exp"].is_string()) return "payload.exp must be a string";
        auto exp = claim_time(payload["exp"]);
        if (!exp) return "payload.exp must be a valid ISO8601 string";
        if (*exp <= now) return "token is expired";
    }
    return std::nullopt;
}

}  // namespace tr::paseto
