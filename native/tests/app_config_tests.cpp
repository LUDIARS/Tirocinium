// secrets/hydrate.test.ts (applyDiscordSecrets) と routes/health.test.ts の移植 + apply.ts の解釈規則。
#include "check.hpp"
#include "app/config.hpp"
#include "app/routes/health.hpp"
#include "app/version.hpp"

using namespace tr;
using trtest::check;
using trtest::check_eq;

TEST_CASE("applyDiscordSecrets: applies non-empty secrets to config.discord") {
    app::DiscordConfig d;
    auto applied = app::apply_discord_secrets(d, {{"TIROCINIUM_DISCORD_BOT_TOKEN", "bot_xyz"},
                                                  {"TIROCINIUM_DISCORD_GUILD_ID", "g1"},
                                                  {"TIROCINIUM_DISCORD_TEXT_CHANNEL_IDS", "c1, c2 , c3"},
                                                  {"TIROCINIUM_DISCORD_COMMAND_PREFIX", "!iv"}});
    check_eq(d.bot_token, std::string("bot_xyz"), "token");
    check_eq(d.guild_id, std::string("g1"), "guild");
    check(d.allowed_channel_ids == std::vector<std::string>{"c1", "c2", "c3"}, "channels trimmed");
    check_eq(d.command_prefix, std::string("!iv"), "prefix");
    check(std::find(applied.begin(), applied.end(), "TIROCINIUM_DISCORD_BOT_TOKEN") != applied.end(), "applied list");
}

TEST_CASE("applyDiscordSecrets: leaves existing values when secrets are absent/empty") {
    app::DiscordConfig d;
    d.bot_token = "from_env";
    auto applied = app::apply_discord_secrets(d, {{"TIROCINIUM_DISCORD_BOT_TOKEN", ""}});
    check_eq(d.bot_token, std::string("from_env"), "empty does not overwrite");
    check_eq(d.command_prefix, std::string("!tr"), "default prefix");
    check(applied.empty(), "nothing applied");
}

TEST_CASE("applyServerConfig: parseInt / bool / csv rules match the Node implementation") {
    app::Config c;
    auto applied = app::apply_server_config(c, {{"TIROCINIUM_PORT", " 9090xyz"},
                                               {"SLOT_CAPACITY", "abc"},
                                               {"TIROCINIUM_DEV_AUTH", "TRUE"},
                                               {"COMPANY_CRAWL_RESPECT_ROBOTS", ""},
                                               {"CERNERE_URL", "https://cr.example.test///"},
                                               {"COMPANY_CRAWL_ADMIN_IDS", "u1, ,u2"}});
    check_eq(c.port, 9090, "parseInt reads leading digits");
    check_eq(c.slot_capacity, 4, "NaN keeps default");
    check(c.dev_auth, "bool is case-insensitive true");
    check(!c.company_crawl.respect_robots, "empty string sets false (setBool applies when defined)");
    check_eq(c.cernere.url, std::string("https://cr.example.test"), "trailing slashes removed");
    check(c.company_crawl.admin_ids == std::vector<std::string>{"u1", "u2"}, "csv");
    check(std::find(applied.begin(), applied.end(), "SLOT_CAPACITY") == applied.end(), "NaN not reported");
}

TEST_CASE("applyServerConfig: invalid interviewer model stops startup") {
    app::Config c;
    trtest::check_throws([&] { app::apply_server_config(c, {{"TIROCINIUM_INTERVIEWER_MODEL", "gpt"}}); },
                         "invalid model");
}

TEST_CASE("isLoopbackHost mirrors auth/cernere.ts") {
    check(app::is_loopback_host("127.0.0.1"), "v4");
    check(app::is_loopback_host(" LocalHost "), "name");
    check(app::is_loopback_host("[::1]"), "v6 bracket");
    check(!app::is_loopback_host("0.0.0.0"), "any address is not loopback");
}

TEST_CASE("service runtime routes: health contract without database") {
    http::Router r;
    app::register_health_routes(r, "1.2.3", [] { return false; });
    http::Context ctx;
    http::Request req;
    req.method = "GET";
    req.path = "/api/health";
    auto res = r.dispatch(req, ctx);
    check_eq(res.status, 200, "status");
    check_eq(res.body, std::string(R"({"ok":true,"service":"tirocinium","version":"1.2.3"})"), "body");
    req.path = "/health";
    check_eq(r.dispatch(req, ctx).status, 200, "alias");
}

TEST_CASE("service runtime routes: reports an unavailable database as not ready") {
    http::Router r;
    app::register_health_routes(r, "v", [] { return false; });
    http::Context ctx;
    http::Request req;
    req.method = "GET";
    req.path = "/api/readiness";
    auto res = r.dispatch(req, ctx);
    check_eq(res.status, 503, "status");
    check_eq(res.body, std::string(R"({"ok":false,"service":"tirocinium","version":"v","db":false})"), "body");
}

TEST_CASE("serviceVersion resolution order") {
    auto env = [](std::map<std::string, std::string> m) {
        return [m](const std::string& k) -> std::optional<std::string> {
            auto it = m.find(k);
            if (it == m.end()) return std::nullopt;
            return it->second;
        };
    };
    check_eq(app::service_version(env({{"TIROCINIUM_SERVICE_VERSION", "b"}, {"EXCUBITOR_SERVICE_VERSION", "a"}})),
             std::string("a"), "excubitor first");
    check_eq(app::service_version(env({})), std::string("unknown"), "fallback");
}

TEST_MAIN()
