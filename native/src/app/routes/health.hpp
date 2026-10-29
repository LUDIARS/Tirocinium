#pragma once
// routes/health.ts: 死活 (/api/health と移行期の alias /health) と依存の生死 (/api/readiness)。
// health は ok/service/version の 3 フィールド固定で DB に触らない。readiness は DB を確かめる。

#include <functional>
#include <string>

#include "http/router.hpp"

namespace tr::app {

void register_health_routes(http::Router& router, std::string version, std::function<bool()> db_ping);

}  // namespace tr::app
