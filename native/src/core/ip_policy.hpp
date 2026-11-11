#pragma once
// SSRF (CWE-918) の判定: companies/ssrf-guard.ts の BLOCKED_V4 / isBlockedV6 と同じ範囲を拒否する。
// Node 版は判定した後で fetch が名前を引き直していた (ssrf-guard.ts:147 の所見 = DNS rebinding の
// TOCTOU)。C++ 版の http_client は「解決した IP を判定 → その IP にそのまま接続」して閉じる。

#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace tr {

// 解析できない形式は安全側で true (拒否)。
bool is_blocked_ip(std::string_view address);

// 名前解決の結果 (全アドレス) を検査する。public_only なら 1 つでも内部アドレスがあれば名前ごと拒否 (nullopt)。
// 空の結果も nullopt。返す一覧が、そのまま接続に使う一覧 (http_client / ws_client は名前を引き直さない)。
std::optional<std::vector<std::string>> vet_resolved_addresses(const std::vector<std::string>& addresses,
                                                               bool public_only);

}  // namespace tr
