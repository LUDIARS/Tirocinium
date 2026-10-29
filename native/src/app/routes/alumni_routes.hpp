#pragma once
// routes/backdoor.ts, routes/es-requests.ts, es-review/routes.ts, routes/resources.ts, routes/analytics.ts の移植と、
// ブラウザの画面 (backdoor-viewer 等) の配信 (固定のファイルを読んで返すだけ。画面そのものは移行しない)。

#include "app/services.hpp"
#include "http/router.hpp"

namespace tr::app {

void register_alumni_routes(http::Router& router, Services& services);
void register_public_routes(http::Router& router, Services& services);

// analytics/store.ts detectBrowser
std::string detect_browser(const std::string& ua);

}  // namespace tr::app
