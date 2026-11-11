#include "app/routes/health.hpp"

namespace tr::app {

void register_health_routes(http::Router& router, std::string version, std::function<bool()> db_ping) {
    auto health = [version](http::Request&, http::Context&) {
        return http::Response::json(Json{{"ok", true}, {"service", "tirocinium"}, {"version", version}});
    };
    router.get("/api/health", health);
    // 移行期の alias (旧パスの監視・スクリプトが残っているため当面残す)。
    router.get("/health", health);
    router.get("/api/readiness", [version, db_ping = std::move(db_ping)](http::Request&, http::Context&) {
        bool ok = false;
        try {
            ok = db_ping && db_ping();
        } catch (...) {
            ok = false;
        }
        return http::Response::json(
            Json{{"ok", ok}, {"service", "tirocinium"}, {"version", version}, {"db", ok}}, ok ? 200 : 503);
    });
}

}  // namespace tr::app
