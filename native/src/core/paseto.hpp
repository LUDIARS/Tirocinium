#pragma once
// PASETO v4.public の分解・PAE・claim の検査 (paseto 3.1.4 の lib/help/{consume,pae,assert_payload}.js と同じ規則)。
// 署名の検証そのものは crypto (OpenSSL の Ed25519) が行う。

#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "core/json.hpp"
#include "core/time.hpp"

namespace tr::paseto {

inline constexpr std::string_view kV4PublicHeader = "v4.public.";

struct V4PublicParts {
    std::string message;    // JSON の payload (署名の前)
    std::string signature;  // 64 バイト
    std::string footer;     // 無ければ空
};

// "v4.public.<base64url(m||sig)>[.<base64url(footer)>]" を分ける。形が違えば nullopt。
// base64url は厳密に読む (Node は寛容だが、同じトークンの別表記を受け入れない方が安全)。
std::optional<V4PublicParts> split_v4_public(std::string_view token);

// PAE(pieces) = LE64(count) || (LE64(len) || piece)*
std::string pae(const std::vector<std::string_view>& pieces);

// 署名対象 m2 = PAE(h, m, f, i)。i (implicit assertion) は使わないので空。
std::string signing_input(const V4PublicParts& parts);

// payload を JSON object として読む (オブジェクト以外は nullopt)。
std::optional<Json> parse_payload(std::string_view message);

// assert_payload(options={audience}, payload)。問題があれば理由 (paseto のメッセージと同じ文言)、無ければ nullopt。
std::optional<std::string> assert_payload(const Json& payload, const std::optional<std::string>& audience, EpochMs now);

}  // namespace tr::paseto
