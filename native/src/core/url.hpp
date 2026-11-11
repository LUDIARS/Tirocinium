#pragma once
// 外向きの HTTP で使う URL の分解 (http / https / ws / wss のみ)。WHATWG URL の全規則は持たず、
// 必要な範囲 (小文字化・既定ポート・IPv6 の角括弧・WHATWG の IPv4 数値表記) だけを扱う。
// 認証情報 (user:pass@) は受け付けない。ASCII 以外のホスト名 (IDN) は受け付けない。

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>

namespace tr {

struct Url {
    std::string scheme;  // 小文字 ("http" | "https" | "ws" | "wss")
    std::string host;    // 小文字。IPv6 は角括弧なし
    std::uint16_t port = 0;
    std::string target;  // path + ("?" + query)。空なら "/"
    bool host_is_ip = false;

    [[nodiscard]] bool tls() const { return scheme == "https" || scheme == "wss"; }
    // "host[:port]" (既定ポートなら省略。IPv6 は角括弧付き)
    [[nodiscard]] std::string host_header() const;
    [[nodiscard]] std::string origin() const;
    [[nodiscard]] std::string to_string() const;
};

std::optional<Url> parse_url(std::string_view text);
// base を基準に Location 等の参照を解決する (絶対 / スキーム相対 / 絶対パス / 相対パス)。フラグメントは捨てる。
std::optional<Url> resolve_url(const Url& base, std::string_view reference);

// WHATWG URL の IPv4 解析 (10 進・0x 16 進・先頭 0 の 8 進、4 つ未満の部分も可)。IPv4 でなければ nullopt。
std::optional<std::uint32_t> parse_whatwg_ipv4(std::string_view host);
std::string ipv4_to_string(std::uint32_t v);

}  // namespace tr
