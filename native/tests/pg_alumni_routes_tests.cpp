// routes/{backdoor,es-requests,resources,analytics}.ts と es-review の結合テスト (一時 Postgres、合成データのみ)。
#include <fstream>
#include <random>

#include "check.hpp"
#include "support/app_fixture.hpp"
#include "app/alumni_repo.hpp"
#include "app/routes/alumni_routes.hpp"
#include "core/text.hpp"
#include "crypto/crypto.hpp"

using namespace tr;
using trtest::check;
using trtest::check_eq;
using trtest::kUserA;
using trtest::kUserB;

namespace {

std::filesystem::path synthetic_root() {
    static const auto root = [] {
        auto d = std::filesystem::temp_directory_path() / ("tr-root-" + std::to_string(std::random_device{}()));
        std::filesystem::create_directories(d / "data" / "companies");
        std::filesystem::create_directories(d / "data" / "general");
        std::filesystem::create_directories(d / "backdoor-viewer");
        std::ofstream(d / "data" / "companies" / "listing-sources.json")
            << R"([{"id":"a","kind":"html","tier":"1","urls":["https://a.test/"],"enabled":true},)"
            << R"({"id":"b","kind":"html","tier":"1","urls":["https://b.test/"],"enabled":false},)"
            << R"({"id":"t","kind":"html","tier":"1","urls":["https://example.com/x"],"enabled":true}])";
        std::ofstream(d / "data" / "general" / "reference-links.json") << R"([{"id":"c","name":"カテゴリ","links":[]}])";
        std::ofstream(d / "data" / "general" / "ob-messages.json")
            << R"([{"id":"m1","name":"合成","year":2020,"company":"X","role":"general","message":"hi","tags":[]}])";
        std::ofstream(d / "backdoor-viewer" / "index.html") << "<html>bd</html>";
        return d;
    }();
    return root;
}

trtest::AppFixture& fixture() {
    static trtest::AppFixture f;
    static bool registered = false;
    if (!registered) {
        f.services->root = synthetic_root();
        app::register_alumni_routes(f.router, *f.services);
        app::register_public_routes(f.router, *f.services);
        f.pool->query("INSERT INTO companies (name, normalized_name) VALUES ($1, $2)", {std::string("テスト株式会社"), std::string("テスト")});
        registered = true;
    }
    return f;
}

Json body(const http::Response& r) { return trtest::AppFixture::body_of(r); }

}  // namespace

TEST_CASE("backdoor: entry upsert with allow-listed fields, company resolution, delete") {
    auto& f = fixture();
    const auto ta = f.token_for(kUserA);
    check_eq(f.call("GET", "/api/v1/backdoor/me").status, 401, "auth required");
    check(body(f.call("GET", "/api/v1/backdoor/me", ta))["entry"].is_null(), "none yet");
    auto put = body(f.call("PUT", "/api/v1/backdoor/me", ta,
                           R"({"display_name":"OB A","current_company":"テスト株式会社","students_published":true,)"
                           R"("message_to_students":"がんばれ","cernere_user_id":"spoofed","industry_published":"yes"})"));
    const Json e = put["entry"];
    check(e["cernere_user_id"] == kUserA, "anchor is the authenticated sub (not the body)");
    check(e["current_company_id"].is_string(), "company resolved by normalized name");
    check(e["students_published"] == true && e["industry_published"] == false, "non-boolean ignored");
    check(e["updated_at"].get<std::string>().back() == 'Z', "ISO timestamp");
    auto again = body(f.call("PUT", "/api/v1/backdoor/me", ta, R"({"message_to_industry":"業界へ","industry_published":true})"));
    check(again["entry"]["display_name"] == "OB A" && again["entry"]["industry_published"] == true, "partial update keeps old values");
    auto industry = body(f.call("GET", "/api/v1/backdoor/industry", ta));
    check(industry["messages"].size() == 1 && industry["roster"][0]["current_company"] == "テスト株式会社", "industry view");
}

TEST_CASE("backdoor job postings: title required, owner-only update/delete, poster id never exposed") {
    auto& f = fixture();
    const auto ta = f.token_for(kUserA);
    const auto tb = f.token_for(kUserB);
    check_eq(f.call("POST", "/api/v1/backdoor/job-postings", ta, R"({"title":"   "})").status, 400, "title required");
    auto c = f.call("POST", "/api/v1/backdoor/job-postings", ta, R"({"title":"プランナー募集","company_name":"テスト株式会社"})");
    check_eq(c.status, 201, "created");
    const Json p = body(c)["posting"];
    check(!p.contains("posted_by_cernere_user_id") && p["is_active"] == true && p["company_id"].is_string(), "projection");
    const std::string id = p["id"];
    auto list = body(f.call("GET", "/api/v1/backdoor/job-postings", tb));
    check(list["postings"][0]["is_mine"] == false, "not mine for B");
    check_eq(f.call("PUT", "/api/v1/backdoor/job-postings/" + id, tb, R"({"title":"乗っ取り"})").status, 404, "other user cannot update");
    auto upd = body(f.call("PUT", "/api/v1/backdoor/job-postings/" + id, ta, R"({"is_active":false})"));
    check(upd["posting"]["is_active"] == false && upd["posting"]["title"] == "プランナー募集", "owner update");
    check_eq(f.call("DELETE", "/api/v1/backdoor/job-postings/" + id, tb).status, 404, "other user cannot delete");
    check_eq(f.call("DELETE", "/api/v1/backdoor/job-postings/" + id, ta).status, 200, "owner delete");
    check_eq(f.call("DELETE", "/api/v1/backdoor/job-postings/not-a-uuid", ta).status, 404, "invalid id");
}

TEST_CASE("es-requests → OB accept → Nuntius → Discord pairing → close") {
    auto& f = fixture();
    const auto student = f.token_for(kUserB);
    const auto ob = f.token_for(kUserA);  // A は「テスト株式会社」の OB (前のケースで登録済み)
    f.config.nuntius_url = "http://nuntius.test";
    check_eq(body(f.call("POST", "/api/v1/es-requests", student, R"({"target_company_name":"未登録社"})"))["error"],
             Json("registered_company_required"), "unknown company");
    check_eq(body(f.call("POST", "/api/v1/es-requests", student, R"({"target_company_name":"   "})"))["error"],
             Json("target_company_name_required"), "blank");
    auto c = f.call("POST", "/api/v1/es-requests", student, R"({"target_company_name":"テスト株式会社"})");
    check_eq(c.status, 201, "created");
    const Json view = body(c)["request"];
    check(!view.contains("student_cernere_user_id") && view["status"] == "pending", "public projection only");
    const std::string rid = view["id"];
    auto pending = body(f.call("GET", "/api/v1/backdoor/es-requests", ob));
    check(pending["requests"].size() == 1, "OB sees the pending request for its company");
    check_eq(f.call("POST", "/api/v1/backdoor/es-requests/" + rid + "/accept", student).status, 404, "student cannot accept own");
    check_eq(body(f.call("POST", "/api/v1/backdoor/es-requests/" + rid + "/accept", ob))["request"]["status"], Json("matched"), "accepted");
    f.background.join();
    bool notified = false;
    for (const auto& o : f.outbound) notified = notified || o.url == "http://nuntius.test/api/notifications";
    check(notified, "student notified through Nuntius");
    check_eq(body(f.call("POST", "/api/v1/es-review/" + rid + "/discord", ob))["error"], Json("discord_not_configured"), "no bot");
    f.config.discord.bot_token = "x";
    auto pair = f.call("POST", "/api/v1/es-review/" + rid + "/discord", ob);
    check_eq(*pair.headers.get("cache-control"), std::string("no-store"), "no-store");
    const std::string command = body(pair)["command"];
    const std::string token = command.substr(command.rfind(' ') + 1);
    check(is_lower_hex(token, 64), "64 hex token");
    auto stored = f.pool->query("SELECT token_hash FROM es_discord_routes WHERE request_id = $1", {rid});
    check(stored[0]["token_hash"] == crypto::sha256_hex(token), "only the hash is stored");
    auto route = app::consume_pairing(*f.pool, token, "dm-ob", now_ms());
    check(route && route->role == "ob", "pairing consumed");
    check(!app::consume_pairing(*f.pool, token, "dm-ob", now_ms()), "single use");
    f.config.discord.bot_token.clear();
    check_eq(f.call("POST", "/api/v1/es-review/" + rid + "/close", f.token_for("44444444-4444-4444-8444-444444444444")).status, 404,
             "third party cannot close");
    check_eq(f.call("POST", "/api/v1/es-review/" + rid + "/close", student).status, 200, "participant closes");
    check(f.pool->query("SELECT 1 FROM es_discord_routes WHERE request_id = $1", {rid}).empty(), "routes removed");
    check_eq(f.call("GET", "/api/v1/es-review/" + rid + "/x").status, 401, "es-review prefix requires auth");
}

TEST_CASE("resources: listing sources categorized; ob-messages = backdoor (live) + curated") {
    auto& f = fixture();
    auto links = body(f.call("GET", "/api/v1/resources/reference-links"));
    check(links["sources"]["active"].size() == 1 && links["sources"]["planned"].size() == 1 &&
              links["sources"]["template"].size() == 1,
          "categorized");
    check(links["curated"][0]["name"] == "カテゴリ", "curated passthrough");
    auto messages = body(f.call("GET", "/api/v1/resources/ob-messages"));
    check(messages["messages"].size() == 2 && messages["messages"][0]["name"] == "OB A" && messages["messages"][1]["id"] == "m1",
          "live first, then curated");
}

TEST_CASE("analytics: event insert, daily counts as numbers, trend, invalid body is 500") {
    auto& f = fixture();
    http::Request req;
    req.method = "POST";
    req.target = "/api/v1/analytics/event";
    req.path = req.target;
    req.body = R"({"event_type":"company_view","path":"/companies","entity_id":"c1","entity_name":"テスト"})";
    req.headers.set("x-forwarded-for", " 203.0.113.9 , 10.0.0.1");
    req.headers.set("user-agent", "Mozilla/5.0 Chrome/120 Safari/537");
    check_eq(app::handle_request(f.router, req, nullptr).status, 200, "insert");
    auto daily = body(f.call("GET", "/api/v1/analytics/daily"));
    check(daily["total_events"] == 1 && daily["total_events"].is_number(), "numeric count");
    check(daily["top_companies"][0]["entity_name"] == "テスト" && daily["browsers"][0]["browser"] == "Chrome", "aggregates");
    auto row = f.pool->query("SELECT ip FROM analytics_events LIMIT 1");
    check(row[0]["ip"] == "203.0.113.9", "first x-forwarded-for entry");
    check(body(f.call("GET", "/api/v1/analytics/trend?days=7"))["trend"].size() == 1, "trend");
    check_eq(f.call("POST", "/api/v1/analytics/event", "", "{bad").status, 500, "c.req.json() failure = 500");
    check_eq(app::detect_browser(""), std::string("Unknown"), "empty ua");
    check_eq(app::detect_browser("x Edg/1"), std::string("Edge"), "edge first");
}

TEST_CASE("viewer pages: static HTML served, missing viewer is 404 text") {
    auto& f = fixture();
    auto ok = f.call("GET", "/backdoor");
    check(ok.status == 200 && ok.body == "<html>bd</html>" && *ok.headers.get("content-type") == "text/html; charset=UTF-8", "html");
    auto missing = f.call("GET", "/ob-jobs");
    check(missing.status == 404 && missing.body == "ob-jobs viewer not found", "missing viewer");
}

TEST_MAIN()
