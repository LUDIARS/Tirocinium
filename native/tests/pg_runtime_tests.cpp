// 常駐まわりの結合テスト (一時 Postgres、合成データのみ、外部サービスには接続しない):
// - /api/v1/companies (routes/companies.ts) と /api/v1/recommend (routes/recommend.ts)
//   企業 worker は約束だけを真似る偽物 (node の小さなスクリプト。node が無ければその部分は省く)
// - 予約の tick (reservation/tick.ts)
// - WebSocket の端から端まで: 本物の HTTP 受け口 + WsRoutes + 決定的な StubBrain
//   (ws/handler.ts, ws/call-handler.ts)
// - Discord の Bot: 偽の gateway (loopback の WS) と偽の REST (外向き HTTP を差し替え)
#include <condition_variable>
#include <fstream>
#include <random>
#include <thread>

#include <boost/asio/io_context.hpp>
#include <boost/asio/post.hpp>
#include <boost/asio/thread_pool.hpp>

#include "check.hpp"
#include "support/app_fixture.hpp"
#include "app/discord_bridge.hpp"
#include "app/interview_repo.hpp"
#include "app/recommend.hpp"
#include "app/reservation_tick.hpp"
#include "app/routes/companies_routes.hpp"
#include "app/routes/interview_routes.hpp"
#include "app/ws_routes.hpp"
#include "io/http_server.hpp"
#include "io/process.hpp"
#include "io/ws_client.hpp"
#include "io/ws_connection.hpp"

using namespace tr;
using trtest::check;
using trtest::check_eq;
using trtest::kUserA;
using trtest::kUserB;
namespace asio = boost::asio;

namespace {

std::string path_env() {
    for (const auto& [k, v] : io::current_environment()) {
        if (k == "PATH") return v;
    }
    return "";
}

std::filesystem::path synthetic_root() {
    static const auto root = [] {
        auto d = std::filesystem::temp_directory_path() / ("tr-rt-root-" + std::to_string(std::random_device{}()));
        std::filesystem::create_directories(d / "data" / "companies");
        std::filesystem::create_directories(d / "data" / "general" / "qa-seed");
        std::ofstream(d / "data" / "companies" / "listing-sources.json")
            << R"([{"id":"l1","kind":"html","urls":["https://l1.test/"],"enabled":true,"note":"合成"},)"
            << R"({"id":"l2","urls":["https://l2.test/","https://l2.test/b"],"enabled":false},{"id":"","urls":["https://x.test/"]}])";
        std::ofstream(d / "data" / "companies" / "news-sources.json")
            << R"([{"id":"n1","kind":"rss","urls":["https://n1.test/feed"],"enabled":false}])";
        std::ofstream(d / "data" / "companies" / "seeds.json")
            << R"([{"name":"種 A","url":"https://seed-a.test/"},{"name":"種 B","url":"ftp://seed-b.test/"},{"name":"種 C"}])";
        return d;
    }();
    return root;
}

const char* kFakeWorker = R"JS(
import { createInterface } from 'node:readline';
const reply = (m) => process.stdout.write('@@tr-worker@@ ' + JSON.stringify(m) + '\n');
const ok = (id, result) => reply({ id, ok: true, result });
const fail = (id, error) => reply({ id, ok: false, error });
createInterface({ input: process.stdin }).on('line', (line) => {
  const { id, op, args: a } = JSON.parse(line);
  switch (op) {
    case 'listing-crawl': return ok(id, { source: a.source ?? null, discovered: 2 });
    case 'job-news-crawl': return ok(id, { saved: 0 });
    case 'contribute': return a.companyId === 'missing' ? fail(id, 'company not found') : ok(id, { added: a.links.length });
    case 'enrich': return fail(id, 'enrich exploded');
    case 'merge-duplicates': return ok(id, { dryRun: a.dryRun });
    case 'ob-sync': return ok(id, { dryRun: a.dryRun });
    case 'crawl-queue-status': return ok(id, { enabled: true, running: true, from: 'worker' });
    case 'enrich-queue-status': return ok(id, { enabled: true, running: true, from: 'worker' });
    case 'map-markers': return ok(id, { enabled: true, markers: [], pendingLocations: a.max ?? 60 });
    case 'games-related': return ok(id, a.gameId === 'none' ? { game: null, direct: [], related: [] } : { game: { id: a.gameId }, direct: [], related: [], filters: a.filters });
    case 'by-tech': return ok(id, [{ id: 'x', tech: a.tech, smb: a.filters.smb }]);
    case 'ob-studios': return ok(id, [{ limit: a.limit ?? null }]);
    case 'ai-research': return ok(id, { status: 'mentions_found', checkedAt: 't', evidence: [], failures: [], checkedUrls: [a.companyUrl], scope: 'synthetic' });
    default: return fail(id, 'unknown_op');
  }
});
)JS";

std::unique_ptr<app::CompaniesWorker> make_worker() {
    if (io::find_in_path("node", path_env()).empty()) return nullptr;
    auto script = synthetic_root() / "fake-worker.mjs";
    std::ofstream(script) << kFakeWorker;
    app::CompaniesWorker::Options o;
    o.spec.file = "node";
    o.spec.args = {script.string()};
    o.spec.cwd = synthetic_root();
    o.spec.env = {{"PATH", path_env()}};
    auto w = std::make_unique<app::CompaniesWorker>(o, nullptr);
    w->start();
    for (int i = 0; i < 250 && !w->available(); ++i) std::this_thread::sleep_for(std::chrono::milliseconds(20));
    return w;
}

struct Runtime {
    trtest::AppFixture f;
    std::unique_ptr<app::CompaniesWorker> worker;
    http::Router no_worker;  // worker を持たない構成 (TIROCINIUM_COMPANIES_WORKER=0)
    app::LlmGateway gateway;
    app::EnvList brain_env{{"TIROCINIUM_BRAIN", "stub"}};
    Runtime() : gateway(f.config, {}, [](const io::HttpClientRequest&) { return io::HttpClientResponse{}; }) {
        f.services->root = synthetic_root();
        worker = make_worker();
        app::register_interview_routes(f.router, *f.services);
        app::register_companies_routes(f.router, *f.services, worker.get());
        app::register_recommend_routes(f.router, *f.services);
        app::register_companies_routes(no_worker, *f.services, nullptr);
    }
    std::shared_ptr<app::InterviewerBrain> brain() { return app::create_brain(gateway, brain_env); }
    http::Response call_no_worker(const std::string& method, const std::string& target) {
        http::Request req;
        req.method = method;
        req.target = target;
        http::split_target(target, req.path, req.raw_query);
        return app::handle_request(no_worker, req, nullptr);
    }
};

Runtime& rt() {
    static Runtime r;
    return r;
}

Json body(const http::Response& r) { return trtest::AppFixture::body_of(r); }

std::string seed_company(db::Database& db, const std::string& name, const std::vector<std::string>& roles,
                         const std::vector<std::string>& tags, const std::string& description) {
    auto rows = db.query(
        "INSERT INTO companies (name, normalized_name, description, roles, tags, source) VALUES ($1, $2, $3, $4, $5, 'synthetic') "
        "RETURNING id",
        {name, name, description, db::StringArray{roles}, db::StringArray{tags}});
    return rows.at(0)["id"];
}

TEST_CASE("companies: list/filter/total, detail 404s, configured sources, map config") {
    auto& r = rt();
    auto& db = *r.f.pool;
    const std::string a = seed_company(db, "合成ゲームス", {"programmer"}, {"Unity"}, "Unity のゲーム開発");
    seed_company(db, "合成デザイン", {"designer"}, {"UI"}, "UI デザイン");
    auto list = body(r.f.call("GET", "/api/v1/companies?role=programmer"));
    check(list["companies"].size() == 1 && list["total"] == 1 && list["companies"][0]["name"] == "合成ゲームス", "role filter");
    check(list["companies"][0]["article_count"] == 0, "counts are numbers");
    check_eq(body(r.f.call("GET", "/api/v1/companies?q=デザイン&limit=abc"))["total"], Json(1), "q filter, NaN limit = default");
    check_eq(body(r.f.call("GET", "/api/v1/companies"))["total"], Json(2), "total");
    check_eq(body(r.f.call("GET", "/api/v1/companies/" + a))["company"]["name"], Json("合成ゲームス"), "detail");
    check_eq(r.f.call("GET", "/api/v1/companies/crawl").status, 404, "non-uuid id is not_found");
    check_eq(r.f.call("GET", "/api/v1/companies/" + a + "/profile").status, 404, "no profile");
    check_eq(js_stringify(body(r.f.call("GET", "/api/v1/companies/" + a + "/ob"))),
             std::string(R"({"summary":{"total":0,"cells":0,"by_year":[],"by_role":[],"by_class":[]},"placements":[]})"), "ob summary");
    check_eq(js_stringify(body(r.f.call("GET", "/api/v1/companies/sources"))), std::string(R"({"sources":["manual","seed-file"]})"),
             "single crawl sources");
    check_eq(js_stringify(body(r.f.call("GET", "/api/v1/companies/listing-sources"))),
             std::string(R"({"sources":[{"id":"l1","kind":"html","urls":1,"active":true,"note":"合成"},)"
                         R"({"id":"l2","kind":"job-aggregator","urls":2,"active":false}]})"),
             "listing sources (invalid rows dropped)");
    check_eq(js_stringify(body(r.f.call("GET", "/api/v1/companies/job-sources"))),
             std::string(R"({"sources":[{"id":"n1","kind":"rss","urls":1,"active":false}]})"), "news sources");
    check_eq(js_stringify(body(r.f.call("GET", "/api/v1/companies/map-config"))), std::string(R"({"enabled":false,"apiKey":""})"),
             "map config without key");
    check_eq(js_stringify(body(r.f.call("GET", "/api/v1/companies/map-markers"))),
             std::string(R"({"enabled":false,"markers":[],"pendingLocations":0})"), "markers disabled without a key");
    check_eq(js_stringify(body(r.f.call("GET", "/api/v1/companies/games/search?q=%20"))), std::string(R"({"games":[]})"), "blank q");
    check_eq(js_stringify(body(r.f.call("GET", "/api/v1/companies/by-tech"))), std::string(R"({"companies":[]})"), "blank tech");
    check_eq(js_stringify(body(r.f.call("GET", "/api/v1/companies/job-postings"))), std::string(R"({"postings":[],"total":0})"),
             "job postings");
}

// companies/repo-quality.test.ts: quality=1 はゲームも求人も無い企業を除き、求人だけある企業は残す
TEST_CASE("companies: quality filter keeps a company with a job posting and drops one with neither") {
    auto& r = rt();
    auto& db = *r.f.pool;
    seed_company(db, "合成バレ会社", {}, {}, "");
    const std::string open = seed_company(db, "合成求人会社", {}, {}, "");
    db.query("INSERT INTO job_postings (source, kind, dedup_key, url, title, company_name, company_id) "
             "VALUES ('s', 'recruit-page', $1, 'http://x.test/1', '合成職種', '合成求人会社', $2)",
             {"k-" + open, open});
    auto names = [&](const std::string& q) {
        std::vector<std::string> out;
        const Json b = body(r.f.call("GET", "/api/v1/companies" + q));  // 一時オブジェクトの中を range-for で回さない
        for (const auto& c : b["companies"]) out.push_back(c["name"]);
        return out;
    };
    auto has = [](const std::vector<std::string>& v, const std::string& n) { return std::find(v.begin(), v.end(), n) != v.end(); };
    const auto q = names("?quality=1&limit=200");
    check(has(q, "合成求人会社") && !has(q, "合成バレ会社"), "quality filter");
    check(has(names("?limit=200"), "合成バレ会社"), "unfiltered keeps it");
    check_eq(body(r.f.call("GET", "/api/v1/companies/job-postings?source=s"))["total"], Json(1), "job posting counted");
}

TEST_CASE("companies: crawl enqueue (auth, allowlist, validation, dedupe, seed-file)") {
    auto& r = rt();
    const auto ta = r.f.token_for(kUserA);
    check_eq(r.f.call("POST", "/api/v1/companies/crawl", "", "{}").status, 401, "auth required");
    auto bad = r.f.call("POST", "/api/v1/companies/crawl", ta, R"({"source":"rss"})");
    check(bad.status == 400 && js_stringify(body(bad)) == R"({"error":"invalid_source","sources":["manual","seed-file"]})", "invalid source");
    check_eq(r.f.call("POST", "/api/v1/companies/crawl", ta, R"({"source":5})").status, 400, "non-string source");
    check_eq(body(r.f.call("POST", "/api/v1/companies/crawl", ta, R"({"urls":["ftp://x","  "]})"))["error"], Json("urls_required"),
             "http(s) only");
    auto first = r.f.call("POST", "/api/v1/companies/crawl", ta, R"({"urls":[" HTTPS://a.test/ ","https://b.test/",3],"maxPages":2})");
    check_eq(first.status, 202, "accepted");
    check(body(first)["enqueued"] == 2 && body(first)["deduped"] == 0 && body(first)["jobs"][0]["url"] == "HTTPS://a.test/" &&
              body(first)["jobs"][0]["status"] == "queued",
          "enqueued (trimmed)");
    auto again = body(r.f.call("POST", "/api/v1/companies/crawl", ta, R"({"urls":["https://b.test/"]})"));
    check(again["enqueued"] == 0 && again["deduped"] == 1, "deduped while queued");
    auto seed = body(r.f.call("POST", "/api/v1/companies/crawl", ta, R"({"source":"seed-file"})"));
    check(seed["enqueued"] == 1 && seed["jobs"][0]["url"] == "https://seed-a.test/", "seed-file: http(s) rows only");
    auto row = r.f.pool->query("SELECT name_hint, requested_by, max_pages FROM crawl_jobs WHERE url = 'https://seed-a.test/'");
    check(row.size() == 1 && row[0]["name_hint"] == "種 A" && row[0]["requested_by"] == kUserA, "name hint and requester");
    r.f.config.company_crawl.admin_ids = {kUserB};
    check_eq(r.f.call("POST", "/api/v1/companies/crawl", ta, R"({"urls":["https://c.test/"]})").status, 403, "allowlist");
    check_eq(r.f.call("POST", "/api/v1/companies/enrich", ta, "{}").status, 403, "allowlist on delegated ops");
    r.f.config.company_crawl.admin_ids.clear();
    auto status = body(r.call_no_worker("GET", "/api/v1/companies/crawl-queue/status"));
    check(status["running"] == false && status["counts"]["queued"] == 3 && status["recent"].size() == 3 &&
              status["disabledReason"] == "企業 worker が動いていません",
          "status from the DB without a worker");
}

TEST_CASE("companies: delegated operations map worker results and errors like Node") {
    auto& r = rt();
    const auto ta = r.f.token_for(kUserA);
    // worker なし: 書き込み系は Node 版の失敗と同じ形 (502)、読み出し系は 503
    auto none = r.call_no_worker("POST", "/api/v1/companies/crawl-job-news");
    check(none.status == 502 && body(none)["error"] == "job_news_crawl_failed", "no worker → 502 with the op error code");
    check_eq(r.call_no_worker("GET", "/api/v1/companies/ob/studios").status, 503, "read without worker → 503");
    check_eq(r.call_no_worker("GET", "/api/v1/companies/enrich-queue/status").status, 200, "status degrades to DB");
    if (!r.worker) {
        std::cout << "  (node not found: worker-backed checks skipped)\n";
        return;
    }
    check_eq(js_stringify(body(r.f.call("POST", "/api/v1/companies/crawl-listing", ta, R"({"source":"l1"})"))),
             std::string(R"({"summary":{"source":"l1","discovered":2}})"), "listing crawl");
    check_eq(r.f.call("POST", "/api/v1/companies/crawl-listing", "", "{}").status, 401, "listing crawl needs auth");
    check_eq(r.f.call("POST", "/api/v1/companies/crawl-job-news", "", "").status, 200, "job news is public (Node behaviour)");
    auto missing = r.f.call("POST", "/api/v1/companies/missing/contribute", ta, R"({"links":["https://x.test/"]})");
    check(missing.status == 404 && js_stringify(body(missing)) == R"({"error":"not_found","detail":"company not found"})", "404 mapping");
    check_eq(body(r.f.call("POST", "/api/v1/companies/c1/contribute", ta, R"({"links":["a",1,"b"]})"))["summary"]["added"], Json(2),
             "string links only");
    check_eq(body(r.f.call("POST", "/api/v1/companies/c1/contribute", ta, R"({"links":[]})"))["error"], Json("links_required"), "links");
    auto enrich = r.f.call("POST", "/api/v1/companies/enrich", ta, "{}");
    check(enrich.status == 502 && js_stringify(body(enrich)) == R"({"error":"enrich_failed","detail":"enrich exploded"})", "502 mapping");
    check_eq(body(r.f.call("POST", "/api/v1/companies/merge-duplicates", ta, R"({"dryRun":"yes"})"))["summary"]["dryRun"], Json(false),
             "dryRun === true only");
    check_eq(body(r.f.call("POST", "/api/v1/companies/ob/sync", ta, R"({"dryRun":true})"))["summary"]["dryRun"], Json(true), "ob sync");
    check_eq(body(r.f.call("GET", "/api/v1/companies/crawl-queue/status"))["from"], Json("worker"), "status from the worker");
    check_eq(r.f.call("GET", "/api/v1/companies/games/none/related").status, 404, "game not found");
    auto rel = body(r.f.call("GET", "/api/v1/companies/games/g1/related?smb=1&engine=Unity&limit=5"));
    check(rel["filters"]["smb"] == true && rel["filters"]["engine"] == "Unity" && rel["filters"]["limit"] == 5, "filters passed");
    check_eq(body(r.f.call("GET", "/api/v1/companies/by-tech?tech=%20Unreal%20&smb=true"))["companies"][0]["tech"], Json("Unreal"),
             "tech trimmed");
    check_eq(js_stringify(body(r.f.call("GET", "/api/v1/companies/ob/studios?limit=3"))), std::string(R"({"studios":[{"limit":3}]})"),
             "studios");
}

TEST_CASE("recommend: auth, heuristic ranking without LLM, ES text not stored, history") {
    auto& r = rt();
    auto& db = *r.f.pool;
    db.query("DELETE FROM companies");
    const std::string match = seed_company(db, "推薦 一致", {"programmer"}, {"Unity"}, "Unity ゲーム開発");
    seed_company(db, "推薦 部分", {"designer"}, {"Unity"}, "");
    seed_company(db, "推薦 無関係", {"designer"}, {}, "広告");
    const auto ta = r.f.token_for(kUserA);
    check_eq(r.f.call("POST", "/api/v1/recommend", "", "{}").status, 401, "auth");
    check_eq(r.f.call("GET", "/api/v1/recommend/x").status, 401, "prefix auth");
    auto res = r.f.call("POST", "/api/v1/recommend", ta,
                        R"({"target_role":"programmer","tags":[" Unity ",""],"es_text":"秘密の ES 本文 Unity ゲーム開発","topK":5})");
    check_eq(res.status, 201, "created");
    const Json b = body(res);
    check(b["method"] == "heuristic" && b["has_es_material"] == true, "heuristic without LLM");
    const Json& items = b["recommendation"]["items"];
    check(items.size() == 2 && items[0]["company_id"] == match && items[0]["name"] == "推薦 一致", "ranked");
    check(items[1]["concerns"][0] == "志望職種の募集有無を要確認", "concern when role unmatched");
    // jsonb はキーを並べ替えて返す (Node 版も同じ列を読むので同じ順になる)
    check_eq(js_stringify(b["recommendation"]["query"]), std::string(R"({"tags":["Unity"],"weak_axes":[],"target_role":"programmer"})"),
             "query (tags trimmed)");
    auto stored = db.query("SELECT query::text AS q, items::text AS i FROM company_recommendations");
    check(stored.size() == 1 && stored[0]["q"].get<std::string>().find("秘密") == std::string::npos &&
              stored[0]["i"].get<std::string>().find("秘密") == std::string::npos,
          "ES text is not stored");
    auto empty = body(r.f.call("POST", "/api/v1/recommend", ta, "{}"));
    check(empty["has_es_material"] == false && empty["recommendation"]["items"].empty(), "no material, no items");
    auto hist = body(r.f.call("GET", "/api/v1/recommend?limit=1", ta));
    check(hist["recommendations"].size() == 1, "limit");
    check_eq(body(r.f.call("GET", "/api/v1/recommend?limit=x", ta))["recommendations"].size(), std::size_t{2}, "NaN limit = 10");
    check(body(r.f.call("GET", "/api/v1/recommend", r.f.token_for(kUserB)))["recommendations"].empty(), "own history only");
    check_eq(app::js_slice_count(5, -1), std::size_t{4}, "slice(0,-1)");
    check_eq(app::js_slice_count(5, 2.9), std::size_t{2}, "slice truncates");
}

TEST_CASE("reservation tick: lead notification via Nuntius, no_show after the timeout") {
    auto& r = rt();
    auto& db = *r.f.pool;
    r.f.config.nuntius_url = "https://nuntius.test";
    const EpochMs now = now_ms();
    const EpochMs soon = now + 15 * 60'000;  // 通知は開始の 15±2 分前
    const EpochMs past = now - 10 * 60'000;
    const std::string kUserC = "33333333-3333-4333-8333-333333333333";
    app::ensure_user(db, kUserB);
    app::ensure_user(db, kUserC);
    db.query("DELETE FROM reservations");
    (void)app::reserve(db, kUserB, soon, 4);
    (void)app::reserve(db, kUserC, past, 4);
    const auto before = r.f.outbound.size();
    const auto counts = app::tick_now(*r.f.services, now);
    check_eq(counts.notified, 1, "lead notified");
    check_eq(counts.marked_no_show, 1, "no_show");
    check(r.f.outbound.size() > before && r.f.outbound.back().url.rfind("https://nuntius.test", 0) == 0, "Nuntius called");
    auto rows = db.query("SELECT status, notify_sent FROM reservations ORDER BY slot_start");
    check(rows[0]["status"] == "no_show" && rows[1]["notify_sent"] == true, "state stored");
    check_eq(app::tick_now(*r.f.services, now).notified, 0, "notified once");
    r.f.config.nuntius_url.clear();
}

// ---------------------------------------------------------------- WebSocket の端から端まで

struct Server {
    asio::io_context ioc;
    asio::thread_pool workers{4};
    std::unique_ptr<io::HttpServer> http;
    std::shared_ptr<app::WsRoutes> ws;
    app::VoiceConfig voice;
    std::vector<std::thread> threads;
    std::optional<asio::executor_work_guard<asio::io_context::executor_type>> guard;

    explicit Server(Runtime& r) {
        app::WsRouteDeps deps;
        deps.services = r.f.services.get();
        deps.voice = &voice;
        deps.brain_factory = [&r] { return r.brain(); };
        deps.research = [](const std::string&, const std::vector<std::string>&) { return app::unavailable_ai_research("t"); };
        deps.ioc = &ioc;
        deps.workers = &workers;
        ws = std::make_shared<app::WsRoutes>(deps);
        http = std::make_unique<io::HttpServer>(
            ioc, "127.0.0.1", 0, io::HttpServerOptions{},
            [this, &r](http::Request req, io::Responder respond) {
                asio::post(workers, [&r, req = std::move(req), respond = std::move(respond)]() mutable {
                    respond(app::handle_request(r.f.router, req, nullptr));
                });
            },
            [this](std::shared_ptr<io::PendingUpgrade> up) { ws->handle(up); });
        http->start();
        guard.emplace(asio::make_work_guard(ioc));
        for (int i = 0; i < 2; ++i) threads.emplace_back([this] { ioc.run(); });
    }
    ~Server() {
        http->stop();
        guard.reset();
        ioc.stop();
        for (auto& t : threads) t.join();
        workers.join();
    }
    std::string url(const std::string& path) const { return "ws://127.0.0.1:" + std::to_string(http->port()) + path; }
};

struct Probe {
    std::mutex mu;
    std::condition_variable cv;
    std::vector<Json> frames;
    bool opened = false, failed = false, closed = false;
    int code = 0;
    std::string reason;
    std::shared_ptr<io::WsClient> ws;

    void connect(asio::io_context& ioc, const std::string& url) {
        io::WsClientOptions o;
        ws = io::ws_connect(
            ioc, url, o,
            [this](bool ok, const std::string&) {
                std::lock_guard l(mu);
                (ok ? opened : failed) = true;
                cv.notify_all();
            },
            [this](std::string d, bool) {
                std::lock_guard l(mu);
                auto j = parse_json(d);
                frames.push_back(j ? *j : Json(d));
                cv.notify_all();
            },
            [this](int c, const std::string& r) {
                std::lock_guard l(mu);
                closed = true;
                code = c;
                reason = r;
                cv.notify_all();
            });
    }
    template <class P>
    bool wait(P pred, int ms = 10'000) {
        std::unique_lock l(mu);
        return cv.wait_for(l, std::chrono::milliseconds(ms), [&] { return pred(*this); });
    }
    int count(const std::string& kind) {
        int n = 0;
        for (const auto& f : frames) {
            if (f.is_object() && f.value("kind", std::string()) == kind) ++n;
        }
        return n;
    }
    std::string text() {
        std::lock_guard l(mu);
        std::string out;
        for (const auto& f : frames) {
            if (f.is_object() && f.value("kind", std::string()) == "response_token") out += f["token"].get<std::string>();
        }
        return out;
    }
};

std::string start_session(Runtime& r, const std::string& user) {
    const auto tok = r.f.token_for(user);
    r.f.call("POST", "/api/v1/personas/interviewers", tok,
             R"({"id":"ws-i","display_name":"合成面接官","stage":"hr","temperament":"穏やか","pressure":2,"bio":"架空","tics":[]})");
    auto res = r.f.call("POST", "/api/v1/sessions", tok, R"({"interviewer_id":"ws-i","target_role":"programmer"})");
    check_eq(res.status, 200, "session started");
    return body(res)["session_id"];
}

TEST_CASE("ws session: Bearer/?token auth, owner check, interview turns with the stub brain, end") {
    auto& r = rt();
    Server srv(r);
    const std::string sid = start_session(r, kUserA);
    Probe anon;
    anon.connect(srv.ioc, srv.url("/api/v1/ws/session/" + sid));
    check(anon.wait([](Probe& p) { return p.failed || p.opened; }) && anon.failed, "no token → rejected");
    Probe other;
    other.connect(srv.ioc, srv.url("/api/v1/ws/session/" + sid + "?token=" + r.f.token_for(kUserB)));
    check(other.wait([](Probe& p) { return p.failed || p.opened; }) && other.failed, "other user → rejected");
    Probe unknown;
    unknown.connect(srv.ioc, srv.url("/api/v1/ws/elsewhere"));
    check(unknown.wait([](Probe& p) { return p.failed || p.opened; }) && unknown.failed, "unknown upgrade path → rejected");

    Probe p;
    p.connect(srv.ioc, srv.url("/api/v1/ws/session/" + sid + "?token=" + r.f.token_for(kUserA)));
    check(p.wait([](Probe& x) { return x.count("session_ready") == 1; }), "session_ready");
    p.ws->send(R"({"kind":"start_interview"})");
    check(p.wait([](Probe& x) { return x.count("response_end") == 1; }), "first interviewer turn");
    check(!p.text().empty(), "interviewer text streamed");
    p.ws->send(R"({"kind":"stt_final","text":"合成の回答です。"})");
    check(p.wait([](Probe& x) { return x.count("response_end") == 2; }), "second interviewer turn");
    p.ws->send(R"({"kind":"bogus"})");
    check(p.wait([](Probe& x) {
              for (const auto& f : x.frames) {
                  if (f.value("message", std::string()) == "unknown frame kind") return true;
              }
              return false;
          }),
          "unknown frame kind reported");
    p.ws->send(R"({"kind":"end_session"})");
    check(p.wait([](Probe& x) { return x.closed; }), "closed after end");
    {
        std::lock_guard l(p.mu);
        bool closing = false;
        for (const auto& f : p.frames) closing |= f.value("code", std::string()) == "closing";
        check(closing, "system closing frame");
    }
    auto row = r.f.pool->query("SELECT status FROM sessions WHERE id = $1", {sid});
    check_eq(row[0]["status"], Json("ended"), "session ended");
    auto turns = r.f.pool->query("SELECT role, stt_text FROM session_turns WHERE session_id = $1 ORDER BY turn_no", {sid});
    check(turns.size() >= 3 && turns[1]["role"] == "user" && turns[1]["stt_text"] == "合成の回答です。", "turns persisted");
}

TEST_CASE("ws call: one-time ticket, one connection per session, text frames only, cleanup ends the session") {
    auto& r = rt();
    Server srv(r);
    const auto tok = r.f.token_for(kUserA);
    const std::string sid = start_session(r, kUserA);
    auto ticket = [&] { return body(r.f.call("POST", "/api/v1/sessions/" + sid + "/call-ticket", tok))["ticket"].get<std::string>(); };
    Probe bad;
    bad.connect(srv.ioc, srv.url("/api/v1/ws/call/" + sid));
    check(bad.wait([](Probe& p) { return p.opened; }), "upgrade accepted before the ticket");
    bad.ws->send(R"({"ticket":"forged"})");
    check(bad.wait([](Probe& p) { return p.closed; }) && bad.code == 1008, "forged ticket → 1008");

    Probe a;
    a.connect(srv.ioc, srv.url("/api/v1/ws/call/" + sid));
    check(a.wait([](Probe& p) { return p.opened; }), "open");
    a.ws->send(js_stringify(Json{{"ticket", ticket()}}));
    check(a.wait([](Probe& p) { return p.count("session_ready") == 1; }), "ready after the ticket");
    Probe b;
    b.connect(srv.ioc, srv.url("/api/v1/ws/call/" + sid));
    check(b.wait([](Probe& p) { return p.opened; }), "second open");
    b.ws->send(js_stringify(Json{{"ticket", ticket()}}));
    check(b.wait([](Probe& p) { return p.closed; }) && b.code == 1008, "second connection for the session is refused");
    check_eq(r.f.pool->query("SELECT status FROM sessions WHERE id = $1", {sid})[0]["status"], Json("active"),
             "refused duplicate does not end the owner's session");
    a.ws->send("binary", true);
    check(a.wait([](Probe& p) { return p.closed; }) && a.code == 1008 && a.reason == "call_failed", "binary frame closes the call");
    bool ended = false;
    for (int i = 0; i < 100 && !ended; ++i) {
        ended = r.f.pool->query("SELECT status FROM sessions WHERE id = $1", {sid})[0]["status"] == "ended";
        if (!ended) std::this_thread::sleep_for(std::chrono::milliseconds(20));
    }
    check(ended, "owner disconnect ends the session");
}


// auth/cernere-composite-ws-relay.test.ts
TEST_CASE("cernere composite relay: ticket parsing, upstream URL, both directions relayed, 503 without CERNERE_URL") {
    const std::string ticket = "3f2b8c1e-0d4a-4b7e-9c55-1a2b3c4d5e6f";
    check(!app::WsRoutes::relay_ticket("/api/v1/ws/session/x"), "other paths are not ours");
    check(app::WsRoutes::relay_ticket("/api/auth/cernere/ws?ticket=" + ticket) == std::optional<std::string>(ticket), "ticket");
    check(app::WsRoutes::relay_ticket("/api/auth/cernere/ws") == std::optional<std::string>(""), "missing → invalid");
    check(app::WsRoutes::relay_ticket("/api/auth/cernere/ws?ticket=a/../b") == std::optional<std::string>(""), "shape → invalid");
    check(app::WsRoutes::upstream_url("http://127.0.0.2:8080", ticket) ==
              std::optional<std::string>("ws://127.0.0.2:8080/auth/composite-ws?ticket=" + ticket),
          "http → ws");
    check(app::WsRoutes::upstream_url("https://cr.example.test", ticket) ==
              std::optional<std::string>("wss://cr.example.test/auth/composite-ws?ticket=" + ticket),
          "https → wss");

    auto& r = rt();
    // Cernere 役: 接続したら state を送り、届いたものを echo で返す
    asio::io_context cioc;
    std::mutex mu;
    std::vector<std::string> seen_paths;
    io::HttpServer cernere(
        cioc, "127.0.0.1", 0, io::HttpServerOptions{}, [](http::Request, io::Responder respond) { respond(http::Response::text("x", 404)); },
        [&](std::shared_ptr<io::PendingUpgrade> up) {
            {
                std::lock_guard l(mu);
                seen_paths.push_back(up->request().target);
            }
            up->accept(io::WsAcceptOptions{}, [](std::shared_ptr<io::WsConnection> conn) {
                std::weak_ptr<io::WsConnection> weak = conn;
                conn->start(
                    [weak](std::string d, bool) {
                        if (auto c = weak.lock()) c->send_text(js_stringify(Json{{"echo", parse_json(d).value_or(Json(nullptr))}}));
                    },
                    [] {});
                conn->send_text(R"({"type":"state","state":"pending_device"})");
            });
        });
    cernere.start();
    auto cguard = asio::make_work_guard(cioc);
    std::thread ct([&] { cioc.run(); });
    r.f.config.cernere.url = "http://127.0.0.1:" + std::to_string(cernere.port());
    {
        Server srv(r);
        Probe p;
        p.connect(srv.ioc, srv.url("/api/auth/cernere/ws?ticket=" + ticket));
        check(p.wait([](Probe& x) { return x.frames.size() >= 1; }), "state relayed to the browser");
        p.ws->send(R"({"type":"device","payload":{}})");
        check(p.wait([](Probe& x) { return x.frames.size() >= 2; }), "echo relayed back");
        {
            std::lock_guard l(p.mu);
            check_eq(js_stringify(p.frames[0]), std::string(R"({"type":"state","state":"pending_device"})"), "first");
            check_eq(js_stringify(p.frames[1]), std::string(R"({"echo":{"type":"device","payload":{}}})"), "second");
        }
        p.ws->close(1000, "");
        {
            std::lock_guard l(mu);
            check(seen_paths == std::vector<std::string>{"/auth/composite-ws?ticket=" + ticket}, "upstream path");
        }
        r.f.config.cernere.url.clear();
        Probe off;
        off.connect(srv.ioc, srv.url("/api/auth/cernere/ws?ticket=" + ticket));
        check(off.wait([](Probe& x) { return x.failed || x.opened; }) && off.failed, "no CERNERE_URL → refused (503)");
    }
    cernere.stop();
    cguard.reset();
    cioc.stop();
    ct.join();
}

// ---------------------------------------------------------------- Discord (偽の gateway と REST)

struct FakeGateway {
    asio::io_context ioc;
    std::unique_ptr<io::HttpServer> http;
    std::vector<std::thread> threads;
    std::optional<asio::executor_work_guard<asio::io_context::executor_type>> guard;
    std::mutex mu;
    std::condition_variable cv;
    std::vector<std::shared_ptr<io::WsConnection>> conns;
    std::vector<Json> received;

    FakeGateway() {
        http = std::make_unique<io::HttpServer>(
            ioc, "127.0.0.1", 0, io::HttpServerOptions{}, [](http::Request, io::Responder respond) { respond(http::Response::text("x", 404)); },
            [this](std::shared_ptr<io::PendingUpgrade> up) {
                up->accept(io::WsAcceptOptions{}, [this](std::shared_ptr<io::WsConnection> conn) {
                    {
                        std::lock_guard l(mu);
                        conns.push_back(conn);
                    }
                    conn->start(
                        [this](std::string d, bool) {
                            std::lock_guard l(mu);
                            received.push_back(parse_json(d).value_or(Json(nullptr)));
                            cv.notify_all();
                        },
                        [] {});
                    conn->send_text(R"({"op":10,"d":{"heartbeat_interval":45000}})");
                    cv.notify_all();
                });
            });
        http->start();
        guard.emplace(asio::make_work_guard(ioc));
        threads.emplace_back([this] { ioc.run(); });
    }
    ~FakeGateway() {
        http->stop();
        guard.reset();
        ioc.stop();
        for (auto& t : threads) t.join();
    }
    template <class P>
    bool wait(P pred, int ms = 10'000) {
        std::unique_lock l(mu);
        return cv.wait_for(l, std::chrono::milliseconds(ms), [&] { return pred(); });
    }
    void dispatch(int seq, const std::string& t, const Json& d) {
        std::shared_ptr<io::WsConnection> c;
        {
            std::lock_guard l(mu);
            c = conns.back();
        }
        c->send_text(js_stringify(Json{{"op", 0}, {"s", seq}, {"t", t}, {"d", d}}));
    }
    int ops(int op) {
        int n = 0;
        for (const auto& j : received) {
            if (j.is_object() && j.value("op", -1) == op) ++n;
        }
        return n;
    }
};

std::vector<std::pair<std::string, std::string>> discord_posts(trtest::AppFixture& f) {
    std::lock_guard l(f.fetch_mu);
    std::vector<std::pair<std::string, std::string>> out;
    for (const auto& req : f.outbound) {
        if (req.url.rfind("https://discord.test/api/v10/channels/", 0) != 0) continue;
        auto j = parse_json(req.body);
        out.emplace_back(req.url, j ? j->value("content", std::string()) : std::string());
    }
    return out;
}

bool posted_containing(trtest::AppFixture& f, const std::string& needle) {
    for (const auto& [u, c] : discord_posts(f)) {
        if (c.find(needle) != std::string::npos) return true;
    }
    return false;
}

TEST_CASE("discord bridge: identify, help, text interview start/answer/end, voice falls back to text, resume and fatal close") {
    auto& r = rt();
    FakeGateway gw;
    asio::io_context ioc;
    auto guard = asio::make_work_guard(ioc);
    std::thread io_thread([&] { ioc.run(); });
    asio::thread_pool workers(2);
    r.f.config.discord.bot_token = "synthetic-bot-token";
    r.f.config.discord.allowed_channel_ids = {"100", "200"};
    r.f.services->slot_duration_env = 30;
    r.f.call("POST", "/api/v1/personas/interviewers", r.f.token_for(kUserA),
             R"({"id":"ws-i","display_name":"合成面接官","stage":"hr","temperament":"穏やか","pressure":2,"bio":"架空","tics":[]})");
    app::VoiceConfig voice;
    app::DiscordBridgeDeps d;
    d.services = r.f.services.get();
    d.ioc = &ioc;
    d.workers = &workers;
    d.brain_factory = [&r] { return r.brain(); };
    d.research = [](const std::string&, const std::vector<std::string>&) { return app::unavailable_ai_research("t"); };
    d.voice = &voice;
    d.gateway_url = "ws://127.0.0.1:" + std::to_string(gw.http->port()) + "/?v=10&encoding=json";
    d.api_base = "https://discord.test/api/v10";
    d.public_only = false;
    d.reconnect_delay = std::chrono::milliseconds(100);
    auto bridge = std::make_shared<app::DiscordBridge>(d);
    bridge->start();

    check(gw.wait([&] { return gw.ops(2) == 1; }), "identify sent after hello");
    {
        std::lock_guard l(gw.mu);
        for (const auto& j : gw.received) {
            if (j.value("op", -1) != 2) continue;
            check(j["d"]["token"] == "synthetic-bot-token" && j["d"]["intents"] == (1 | 128 | 512 | 4096 | 32768), "identify payload");
        }
    }
    gw.dispatch(1, "READY", Json{{"session_id", "sess-1"}, {"user", Json{{"id", "9"}}}, {"resume_gateway_url", "wss://evil.example/"}});
    for (int i = 0; i < 100 && !bridge->ready(); ++i) std::this_thread::sleep_for(std::chrono::milliseconds(20));
    check(bridge->ready(), "ready");

    auto msg = [](const std::string& id, const std::string& ch, const std::string& content) {
        return Json{{"id", id}, {"channel_id", ch}, {"guild_id", "1"}, {"content", content}, {"author", Json{{"id", "5"}}}};
    };
    auto wait_post = [&](const std::string& needle) {
        for (int i = 0; i < 500; ++i) {
            if (posted_containing(r.f, needle)) return true;
            std::this_thread::sleep_for(std::chrono::milliseconds(20));
        }
        return false;
    };
    gw.dispatch(2, "MESSAGE_CREATE", msg("m1", "100", "!tr help"));
    check(wait_post("Tr Discord interview commands:"), "help posted");
    gw.dispatch(3, "MESSAGE_CREATE", msg("m2", "300", "!tr help"));
    gw.dispatch(4, "MESSAGE_CREATE", Json{{"id", "m3"}, {"channel_id", "100"}, {"content", "!tr help"}, {"author", Json{{"id", "6"}, {"bot", true}}}});
    gw.dispatch(5, "MESSAGE_CREATE", msg("m4", "100", "!tr text programmer"));
    check(wait_post("Started Tr text interview"), "text interview started");
    check(wait_post("Tr will ask first"), "start notice");
    for (int i = 0; i < 500 && discord_posts(r.f).size() < 3; ++i) std::this_thread::sleep_for(std::chrono::milliseconds(20));
    const auto n_before = discord_posts(r.f).size();
    check(n_before >= 3, "interviewer question posted");
    gw.dispatch(6, "MESSAGE_CREATE", msg("m5", "100", "合成の回答です"));
    for (int i = 0; i < 500 && discord_posts(r.f).size() <= n_before; ++i) std::this_thread::sleep_for(std::chrono::milliseconds(20));
    check(discord_posts(r.f).size() > n_before, "answer produced the next question");
    gw.dispatch(7, "MESSAGE_CREATE", msg("m6", "100", "!tr end"));
    check(wait_post("Tr interview ended."), "ended");
    for (const auto& [u, c] : discord_posts(r.f)) check(u.find("/channels/300/") == std::string::npos, "disallowed channel ignored");
    gw.dispatch(8, "MESSAGE_CREATE", msg("m7", "200", "!tr voice"));
    check(wait_post("Voice mode is not available"), "voice falls back to text with a notice");
    gw.dispatch(9, "MESSAGE_CREATE", msg("m8", "200", "!tr end"));
    for (int i = 0; i < 200 && bridge->active_sessions() > 0; ++i) std::this_thread::sleep_for(std::chrono::milliseconds(20));
    check_eq(bridge->active_sessions(), std::size_t{0}, "sessions closed");
    {
        std::lock_guard l(r.f.fetch_mu);
        for (const auto& req : r.f.outbound) {
            if (req.url.rfind("https://discord.test/", 0) != 0) continue;
            bool auth = false;
            for (const auto& [k, v] : req.headers) auth |= k == "authorization" && v == "Bot synthetic-bot-token";
            check(auth && req.body.find("\"allowed_mentions\":{\"parse\":[]}") != std::string::npos, "bot auth, no mentions");
        }
    }

    // 普通の切断 → 同じ URL (evil な resume URL は採らない) へ再接続して resume
    {
        std::lock_guard l(gw.mu);
        gw.conns.back()->close(1001, "going away");
    }
    check(gw.wait([&] { return gw.ops(6) == 1; }), "resume after reconnect");
    {
        std::lock_guard l(gw.mu);
        for (const auto& j : gw.received) {
            if (j.value("op", -1) == 6) check(j["d"]["session_id"] == "sess-1" && j["d"]["seq"] == 9, "resume payload");
        }
    }
    // 認証失敗 (4004) は再接続しない
    std::size_t conns_before = 0;
    {
        std::lock_guard l(gw.mu);
        conns_before = gw.conns.size();
        gw.conns.back()->close(4004, "auth failed");
    }
    std::this_thread::sleep_for(std::chrono::milliseconds(600));
    {
        std::lock_guard l(gw.mu);
        check_eq(gw.conns.size(), conns_before, "no reconnect after 4004");
    }
    bridge->stop();
    workers.join();
    guard.reset();
    ioc.stop();
    io_thread.join();
    r.f.config.discord = {};
}

}  // namespace

TEST_MAIN()
