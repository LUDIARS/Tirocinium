#pragma once
// SSRF (CWE-918) の判定: companies/ssrf-guard.ts の BLOCKED_V4 / isBlockedV6 と同じ範囲を拒否する。
// Node 版は判定した後で fetch が名前を引き直していた (ssrf-guard.ts:147 の所見 = DNS rebinding の
// TOCTOU)。C++ 版の http_client は「解決した IP を判定 → その IP にそのまま接続」して閉じる。

#include <string>
#include <string_view>

namespace tr {

// 解析できない形式は安全側で true (拒否)。
bool is_blocked_ip(std::string_view address);

}  // namespace tr
