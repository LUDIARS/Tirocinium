#pragma once
// サービスが名乗る版 (AIFormat RULE_SRE.md §2、SPEC-SERVICE-RUNTIME-VERSION)。
// 解決順は Excubitor 注入 → サービス固有 env → npm の package version → 'unknown' (Node 版と同じ)。

#include <functional>
#include <optional>
#include <string>

namespace tr::app {

using EnvLookup = std::function<std::optional<std::string>(const std::string&)>;

EnvLookup process_env();
std::string service_version(const EnvLookup& env);

}  // namespace tr::app
