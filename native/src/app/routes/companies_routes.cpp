#include "app/routes/companies_routes.hpp"

#include <algorithm>

#include "app/companies_repo.hpp"
#include "app/alumni_repo.hpp"
#include "core/domain/domain.hpp"
#include "core/text.hpp"

namespace tr::app {

namespace {

using http::Request;
using http::Response;
using Ctx = http::Context;

Response json(const Json& v, int status = 200) { return Response::json(v, status); }

Json array_of(const std::vector<Json>& v) {
    Json a = Json::array();
    for (const auto& x : v) a.push_back(x);
    return a;
}

bool truthy_flag(const Request& req, const char* key) {
    const auto v = req.query(key);
    return v && (*v == "1" || *v == "true");
}

// q['x'] ? parseInt : undefined (NaN は未指定と同じに扱う。Node 版では DB エラーになっていた)。
std::optional<long long> int_query(const Request& req, const char* key) {
    const auto v = req.query(key);
    if (!v || v->empty()) return std::nullopt;
    return js_parse_int(*v);
}

std::optional<std::string> nonempty_query(const Request& req, const char* key) {
    auto v = req.query(key);
    if (!v || v->empty()) return std::nullopt;
    return v;
}

Json body_or_null(Request& req) {
    auto b = read_json_body(req);
    return b ? *b : Json(nullptr);
}

const Json* body_field(const Json& body, const char* key) { return body.is_object() ? member(body, key) : nullptr; }

bool can_crawl(const Services& s, const std::string& uid) {
    const auto& ids = s.config.company_crawl.admin_ids;
    return ids.empty() || std::find(ids.begin(), ids.end(), uid) != ids.end();
}

bool is_http_url(const std::string& u) {
    const std::string l = ascii_lower(u.substr(0, 8));
    return l.rfind("http://", 0) == 0 || l.rfind("https://", 0) == 0;
}

// 書き込み系の委託: 失敗は Node 版と同じ {error: code, detail} 502。
Response delegate_summary(CompaniesWorker* worker, const std::string& op, const Json& args, const std::string& error_code) {
    if (!worker) return json(Json{{"error", error_code}, {"detail", "companies worker unavailable"}}, 502);
    try {
        return json(Json{{"summary", worker->call(op, args, companies_op_timeout(op))}});
    } catch (const WorkerError& e) {
        return json(Json{{"error", error_code}, {"detail", std::string(e.what())}}, 502);
    }
}

// 読み出し系の委託: worker が使えなければ 503。
std::optional<Json> delegate_read(CompaniesWorker* worker, const std::string& op, const Json& args, Response& failure) {
    if (!worker) {
        failure = json(Json{{"error", "companies_worker_unavailable"}}, 503);
        return std::nullopt;
    }
    try {
        return worker->call(op, args, companies_op_timeout(op));
    } catch (const WorkerError& e) {
        failure = json(Json{{"error", "companies_worker_unavailable"}, {"detail", e.code()}}, 503);
        return std::nullopt;
    }
}

}  // namespace

std::chrono::milliseconds companies_op_timeout(const std::string& op) {
    using std::chrono::milliseconds;
    if (op == "ai-research") return milliseconds(20'000);  // worker 側で 8 秒の全体期限がある
    if (op == "crawl-queue-status" || op == "enrich-queue-status" || op == "ob-studios") return milliseconds(60'000);
    return milliseconds(30 * 60'000);  // クロール・enrich・同期
}

void register_companies_routes(http::Router& r, Services& s, CompaniesWorker* worker) {
    const std::string base = "/api/v1/companies";
    auto auth_mw = s.auth.middleware();

    r.get(base, [&s](Request& req, Ctx&) {
        CompanyFilter f;
        f.role = req.query("role");
        f.tag = req.query("tag");
        f.industry = req.query("industry");
        f.q = req.query("q");
        f.quality = truthy_flag(req, "quality");
        f.summarized = truthy_flag(req, "summarized");
        f.newgrad = truthy_flag(req, "newgrad");
        f.opening = truthy_flag(req, "opening");
        f.limit = int_query(req, "limit");
        f.offset = int_query(req, "offset");
        Json rows = array_of(list_companies(s.db, f));
        return json(Json{{"companies", rows}, {"total", count_companies(s.db, f)}});
    });

    r.get(base + "/sources", [](Request&, Ctx&) {
        Json ids = Json::array();
        for (const auto& id : domain::list_source_ids()) ids.push_back(id);
        return json(Json{{"sources", ids}});
    });

    auto source_list = [](const std::vector<Json>& all, const std::function<bool(const Json&)>& active) {
        Json out = Json::array();
        for (const auto& src : all) {
            Json o{{"id", src["id"]}, {"kind", src["kind"]}, {"urls", src["urls"].size()}, {"active", active(src)}};
            if (src.contains("note")) o["note"] = src["note"];
            out.push_back(o);
        }
        return Json{{"sources", out}};
    };

    r.get(base + "/listing-sources", [&s, source_list](Request&, Ctx&) {
        return json(source_list(load_listing_sources(s.root), [&s](const Json& x) { return listing_source_active(x, s.config); }));
    });

    r.get(base + "/ob-jobs", [&s](Request&, Ctx&) { return json(Json{{"postings", array_of(list_ob_job_postings_public(s.db))}}); });

    r.get(base + "/job-postings", [&s](Request& req, Ctx&) {
        const auto source = nonempty_query(req, "source");
        const auto limit = int_query(req, "limit");
        Json rows = array_of(list_job_postings(s.db, source, limit));
        return json(Json{{"postings", rows}, {"total", count_job_postings(s.db, source)}});
    });

    r.get(base + "/job-sources", [&s, source_list](Request&, Ctx&) {
        return json(source_list(load_news_sources(s.root), [&s](const Json& x) { return news_source_active(x, s.config); }));
    });

    r.get(base + "/games/search", [&s](Request& req, Ctx&) {
        const std::string q = js_trim(req.query("q").value_or(""));
        if (q.empty()) return json(Json{{"games", Json::array()}});
        return json(Json{{"games", array_of(search_games(s.db, q, int_query(req, "limit").value_or(20)))}});
    });

    r.get(base + "/games/:gameId/related", [&s](Request& req, Ctx&) {
        RelatedFilters f;
        f.smb = truthy_flag(req, "smb");
        f.newgrad = truthy_flag(req, "newgrad");
        f.opening = truthy_flag(req, "opening");
        f.social = truthy_flag(req, "social");
        f.engine = nonempty_query(req, "engine");
        f.limit = int_query(req, "limit");
        const Json result = related_companies_by_game(s.db, req.param("gameId"), f);
        return result["game"].is_null() ? json(Json{{"error", "not_found"}}, 404) : json(result);
    });

    r.get(base + "/by-tech", [&s](Request& req, Ctx&) {
        const std::string tech = js_trim(req.query("tech").value_or(""));
        if (tech.empty()) return json(Json{{"companies", Json::array()}});
        return json(Json{{"companies", array_of(companies_by_tech(s.db, tech, truthy_flag(req, "smb"), truthy_flag(req, "social"),
                                                                  int_query(req, "limit")))}});
    });

    // Google Maps の JS API キーは referrer 制限を前提に公開する設計 (Node 版と同じ)。
    r.get(base + "/map-config", [&s](Request&, Ctx&) {
        const std::string& key = s.config.google_maps_api_key;
        return json(Json{{"enabled", !key.empty()}, {"apiKey", key}});
    });

    // 未 geocode の所在地は 1 回に最大 max 件 (既定 60)。Node 版に無い全体の期限 60 秒を過ぎたら残りは次回に回す。
    r.get(base + "/map-markers", [&s](Request& req, Ctx&) {
        return json(build_map_markers(s.db, s.fetch, s.config.google_maps_api_key, int_query(req, "max").value_or(60),
                                      std::chrono::seconds(60)));
    });

    r.get(base + "/enrich-queue/status", [&s, worker](Request&, Ctx&) {
        if (worker && worker->available()) {
            try {
                return json(worker->call("enrich-queue-status", Json::object(), companies_op_timeout("enrich-queue-status")));
            } catch (const WorkerError&) {
            }
        }
        const Json stats = auto_enrich_stats(s.db);
        return json(Json{{"enabled", s.config.enrich_queue.enabled},
                         {"running", false},
                         {"intervalMs", s.config.enrich_queue.interval_ms},
                         {"disabledReason", "企業 worker が動いていません"},
                         {"processed", 0},
                         {"enrichedOk", 0},
                         {"lastCompany", ""},
                         {"lastDetail", ""},
                         {"pending", stats.value("pending", Json(0))},
                         {"attempted", stats.value("attempted", Json(0))}});
    });

    r.get(base + "/ob/top", [&s](Request& req, Ctx&) {
        return json(Json{{"companies", array_of(top_companies_by_ob(s.db, int_query(req, "limit").value_or(30)))}});
    });

    r.get(base + "/ob/studios", [worker](Request& req, Ctx&) {
        Json args = Json::object();
        if (auto l = int_query(req, "limit")) args["limit"] = *l;
        if (auto g = int_query(req, "games")) args["games"] = *g;
        Response failure;
        auto result = delegate_read(worker, "ob-studios", args, failure);
        if (!result) return failure;
        return json(Json{{"studios", *result}});
    });

    r.get(base + "/:id/ob", [&s](Request& req, Ctx&) {
        const auto placements = get_ob_placements(s.db, req.param("id"));
        return json(Json{{"summary", build_ob_summary(placements)}, {"placements", array_of(placements)}});
    });

    r.get(base + "/:id/profile", [&s](Request& req, Ctx&) {
        auto p = get_profile(s.db, req.param("id"));
        return p ? json(Json{{"profile", *p}}) : json(Json{{"error", "not_found"}}, 404);
    });

    r.get(base + "/:id/newgrad", [&s](Request& req, Ctx&) {
        return json(Json{{"roles", array_of(get_newgrad_role_images(s.db, req.param("id")))}});
    });

    r.get(base + "/:id/games", [&s](Request& req, Ctx&) {
        return json(Json{{"games", array_of(get_games_by_company(s.db, req.param("id")))}});
    });

    r.get(base + "/:id/articles", [&s](Request& req, Ctx&) {
        return json(Json{{"articles", array_of(list_interview_articles(s.db, req.param("id"), 50))}});
    });

    r.get(base + "/:id", [&s](Request& req, Ctx&) {
        auto c = get_company(s.db, req.param("id"));
        return c ? json(Json{{"company", *c}}) : json(Json{{"error", "not_found"}}, 404);
    });

    r.add_with("POST", base + "/crawl", auth_mw, [&s](Request& req, Ctx& ctx) {
        const std::string& uid = user_id(ctx);
        if (!can_crawl(s, uid)) return json(Json{{"error", "forbidden"}}, 403);
        const Json body = body_or_null(req);
        const Json* src = body_field(body, "source");
        const auto& ids = domain::list_source_ids();
        std::string source = "manual";
        bool valid = true;
        if (src && !src->is_null()) {
            valid = src->is_string() && std::find(ids.begin(), ids.end(), src->get<std::string>()) != ids.end();
            if (valid) source = src->get<std::string>();
        }
        if (!valid) {
            Json list = Json::array();
            for (const auto& id : ids) list.push_back(id);
            return json(Json{{"error", "invalid_source"}, {"sources", list}}, 400);
        }
        struct Item {
            std::string url;
            std::string name_hint;
        };
        std::vector<Item> items;
        if (source == "seed-file") {
            for (const auto& rec : load_seed_records(s.root)) {
                const std::string url = string_or(rec, "url");
                if (!url.empty() && is_http_url(url)) items.push_back({url, string_or(rec, "name")});
            }
        } else if (const Json* urls = body_field(body, "urls"); urls && urls->is_array()) {
            for (const auto& u : *urls) {
                if (!u.is_string()) continue;
                const std::string t = js_trim(u.get<std::string>());
                if (is_http_url(t)) items.push_back({t, ""});
            }
        }
        if (items.empty()) {
            return json(Json{{"error", "urls_required"}, {"detail", "http(s) で始まる URL を 1 件以上指定してください"}}, 400);
        }
        std::optional<Json> max_pages;
        if (const Json* m = body_field(body, "maxPages"); m && !m->is_null()) max_pages = *m;
        int enqueued = 0;
        Json jobs = Json::array();
        for (const auto& it : items) {
            auto res = enqueue_crawl(s.db, it.url, it.name_hint, source, max_pages, uid);
            if (!res.deduped) ++enqueued;
            jobs.push_back(Json{{"id", res.job.value("id", Json(nullptr))},
                                {"url", res.job.value("url", Json(nullptr))},
                                {"status", res.job.value("status", Json(nullptr))}});
        }
        return json(Json{{"enqueued", enqueued}, {"deduped", static_cast<int>(items.size()) - enqueued}, {"jobs", jobs}}, 202);
    });

    r.get(base + "/crawl-queue/status", [&s, worker](Request&, Ctx&) {
        if (worker && worker->available()) {
            try {
                return json(worker->call("crawl-queue-status", Json::object(), companies_op_timeout("crawl-queue-status")));
            } catch (const WorkerError&) {
            }
        }
        return json(Json{{"enabled", s.config.crawl_queue.enabled},
                         {"running", false},
                         {"intervalMs", s.config.crawl_queue.interval_ms},
                         {"disabledReason", "企業 worker が動いていません"},
                         {"processed", 0},
                         {"upsertedOk", 0},
                         {"lastUrl", ""},
                         {"lastDetail", ""},
                         {"counts", crawl_queue_counts(s.db)},
                         {"recent", array_of(recent_crawl_jobs(s.db))}});
    });

    r.add_with("POST", base + "/crawl-listing", auth_mw, [&s, worker](Request& req, Ctx& ctx) {
        if (!can_crawl(s, user_id(ctx))) return json(Json{{"error", "forbidden"}}, 403);
        const Json body = body_or_null(req);
        Json args = Json::object();
        if (const Json* src = body_field(body, "source")) args["source"] = *src;
        return delegate_summary(worker, "listing-crawl", args, "listing_crawl_failed");
    });

    // 求人取得は公開操作 (Node 版と同じく認証なし)。取得先は news-sources.json の有効ソースに限られる。
    r.post(base + "/crawl-job-news", [worker](Request& req, Ctx&) {
        const Json body = body_or_null(req);
        Json args = Json::object();
        if (const Json* src = body_field(body, "source")) args["source"] = *src;
        return delegate_summary(worker, "job-news-crawl", args, "job_news_crawl_failed");
    });

    r.add_with("POST", base + "/:id/contribute", auth_mw, [&s, worker](Request& req, Ctx& ctx) {
        if (!can_crawl(s, user_id(ctx))) return json(Json{{"error", "forbidden"}}, 403);
        const Json body = body_or_null(req);
        Json links = Json::array();
        if (const Json* l = body_field(body, "links"); l && l->is_array()) {
            for (const auto& x : *l) {
                if (x.is_string()) links.push_back(x);
            }
        }
        if (links.empty()) return json(Json{{"error", "links_required"}}, 400);
        if (!worker) return json(Json{{"error", "contribute_failed"}, {"detail", "companies worker unavailable"}}, 502);
        try {
            const Json summary =
                worker->call("contribute", Json{{"companyId", req.param("id")}, {"links", links}}, companies_op_timeout("contribute"));
            return json(Json{{"summary", summary}});
        } catch (const WorkerError& e) {
            const std::string msg = e.what();
            const bool missing = e.code() == "op_failed" && msg == "company not found";
            return json(Json{{"error", missing ? "not_found" : "contribute_failed"}, {"detail", msg}}, missing ? 404 : 502);
        }
    });

    r.add_with("POST", base + "/enrich", auth_mw, [&s, worker](Request& req, Ctx& ctx) {
        if (!can_crawl(s, user_id(ctx))) return json(Json{{"error", "forbidden"}}, 403);
        const Json body = body_or_null(req);
        Json args = Json::object();
        if (const Json* c = body_field(body, "company_id")) args["companyId"] = *c;
        if (const Json* l = body_field(body, "limit")) args["limit"] = *l;
        return delegate_summary(worker, "enrich", args, "enrich_failed");
    });

    r.add_with("POST", base + "/merge-duplicates", auth_mw, [&s, worker](Request& req, Ctx& ctx) {
        if (!can_crawl(s, user_id(ctx))) return json(Json{{"error", "forbidden"}}, 403);
        const Json body = body_or_null(req);
        const Json* d = body_field(body, "dryRun");
        return delegate_summary(worker, "merge-duplicates", Json{{"dryRun", d && *d == true}}, "merge_failed");
    });

    r.add_with("POST", base + "/ob/sync", auth_mw, [&s, worker](Request& req, Ctx& ctx) {
        if (!can_crawl(s, user_id(ctx))) return json(Json{{"error", "forbidden"}}, 403);
        const Json body = body_or_null(req);
        const Json* d = body_field(body, "dryRun");
        return delegate_summary(worker, "ob-sync", Json{{"dryRun", d && *d == true}}, "ob_sync_failed");
    });
}

}  // namespace tr::app
