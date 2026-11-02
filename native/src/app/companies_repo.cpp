#include "app/companies_repo.hpp"

#include <algorithm>
#include <fstream>
#include <map>
#include <sstream>

#include "app/interview_repo.hpp"
#include "core/text.hpp"

namespace tr::app {

namespace {

const char* kJobCols =
    "id, url, name_hint, source, status, max_pages, attempts, summary, error, requested_by, enqueued_at, started_at, "
    "finished_at, child_status, child_log, child_detail";

std::optional<Json> active_job_by_url(db::Database& db, const std::string& url) {
    auto rows = db.query(std::string("SELECT ") + kJobCols + " FROM crawl_jobs WHERE url = $1 AND status IN ('queued', 'running') LIMIT 1",
                         {url});
    if (rows.empty()) return std::nullopt;
    return rows[0];
}

double num(const Json& v) {
    if (v.is_number()) return v.get<double>();
    if (v.is_string()) {
        try {
            return std::stod(v.get<std::string>());
        } catch (...) {
            return 0;
        }
    }
    return 0;
}

Json with_numbers(Json row, std::initializer_list<const char*> keys) {
    for (const char* k : keys) {
        if (row.contains(k)) {
            const double d = num(row[k]);
            row[k] = d == static_cast<double>(static_cast<std::int64_t>(d)) ? Json(static_cast<std::int64_t>(d)) : Json(d);
        }
    }
    return row;
}

std::string filter_sql(const CompanyFilter& f, db::Params& params) {
    std::string sql = " WHERE TRUE";
    auto add = [&](const std::string& v) {
        params.emplace_back(v);
        return "$" + std::to_string(params.size());
    };
    if (f.role && !f.role->empty()) sql += " AND " + add(*f.role) + " = ANY(c.roles)";
    if (f.tag && !f.tag->empty()) sql += " AND " + add(*f.tag) + " = ANY(c.tags)";
    if (f.industry && !f.industry->empty()) sql += " AND c.industry = " + add(*f.industry);
    if (f.quality) {
        sql += " AND (EXISTS (SELECT 1 FROM company_game cg WHERE cg.company_id = c.id) OR EXISTS (SELECT 1 FROM job_postings jp "
               "WHERE jp.company_id = c.id))";
    }
    if (f.summarized) sql += " AND c.description <> ''";
    if (f.newgrad) sql += " AND c.is_newgrad";
    if (f.opening) sql += " AND c.has_opening";
    if (f.q && !f.q->empty()) {
        const std::string p = add("%" + *f.q + "%");
        sql += " AND (c.name ILIKE " + p + " OR c.description ILIKE " + p + " OR c.industry ILIKE " + p +
               " OR EXISTS (SELECT 1 FROM unnest(c.roles) AS role WHERE role ILIKE " + p +
               ") OR EXISTS (SELECT 1 FROM unnest(c.tags) AS tag WHERE tag ILIKE " + p + "))";
    }
    return sql;
}

std::optional<std::string> read_file(const std::filesystem::path& p) {
    std::error_code ec;
    if (!std::filesystem::is_regular_file(p, ec) || std::filesystem::file_size(p, ec) > 8 * 1024 * 1024) return std::nullopt;
    std::ifstream in(p, std::ios::binary);
    std::stringstream ss;
    ss << in.rdbuf();
    return ss.str();
}

std::vector<Json> read_array(const std::filesystem::path& p) {
    auto text = read_file(p);
    if (!text) return {};
    JsonLimits limits;
    limits.max_bytes = 8 * 1024 * 1024;
    limits.max_elements = 1'000'000;
    auto v = parse_json(*text, limits);
    if (!v || !v->is_array()) return {};
    std::vector<Json> out;
    for (const auto& x : *v) {
        if (x.is_object()) out.push_back(x);
    }
    return out;
}

Json string_urls(const Json& r) {
    Json urls = Json::array();
    if (const Json* u = member(r, "urls"); u && u->is_array()) {
        for (const auto& x : *u) {
            if (x.is_string()) urls.push_back(x);
        }
    }
    return urls;
}

std::string id_string(const Json& r) {
    const Json* id = member(r, "id");
    if (!id || id->is_null()) return "";
    return id->is_string() ? id->get<std::string>() : js_stringify(*id);
}

}  // namespace

EnqueueResult enqueue_crawl(db::Database& db, const std::string& raw_url, const std::string& name_hint, const std::string& source,
                            const std::optional<Json>& max_pages, const std::string& requested_by) {
    const std::string url = js_trim(raw_url);
    if (auto existing = active_job_by_url(db, url)) return {*existing, true};
    try {
        auto rows = db.query(std::string("INSERT INTO crawl_jobs (url, name_hint, source, max_pages, requested_by) VALUES ($1, $2, $3, $4, $5) "
                                         "RETURNING ") + kJobCols,
                             {url, name_hint, source, max_pages ? param_from_json(*max_pages) : db::Param(db::Null{}), requested_by});
        return {rows.at(0), false};
    } catch (const db::DbError&) {
        // unique index 競合 = 並行 enqueue で先に同じ URL が入った。既存を再利用する。
        if (auto raced = active_job_by_url(db, url)) return {*raced, true};
        throw;
    }
}

Json crawl_queue_counts(db::Database& db) {
    Json counts{{"queued", 0}, {"running", 0}, {"done", 0}, {"failed", 0}};
    for (const auto& r : db.query("SELECT status, COUNT(*) AS n FROM crawl_jobs GROUP BY status")) {
        counts[r["status"].get<std::string>()] = static_cast<std::int64_t>(num(r["n"]));
    }
    return counts;
}

db::Rows recent_crawl_jobs(db::Database& db, int limit) {
    return db.query(std::string("SELECT ") + kJobCols + " FROM crawl_jobs ORDER BY enqueued_at DESC LIMIT $1", {std::int64_t{limit}});
}

Json auto_enrich_stats(db::Database& db) {
    auto rows = db.query(
        "SELECT sum(CASE WHEN c.description = '' THEN 1 ELSE 0 END)::text AS pending, "
        "sum(CASE WHEN c.description = '' AND c.enrich_attempted_at IS NOT NULL THEN 1 ELSE 0 END)::text AS attempted "
        "FROM companies c WHERE c.url <> '' AND EXISTS (SELECT 1 FROM company_game cg WHERE cg.company_id = c.id)");
    const Json r = rows.empty() ? Json::object() : rows[0];
    return Json{{"pending", static_cast<std::int64_t>(num(r.value("pending", Json(0))))},
                {"attempted", static_cast<std::int64_t>(num(r.value("attempted", Json(0))))}};
}

db::Rows list_companies(db::Database& db, const CompanyFilter& f) {
    long long limit = std::min<long long>(std::max<long long>(f.limit.value_or(50), 1), 200);
    long long offset = std::max<long long>(f.offset.value_or(0), 0);
    db::Params params;
    const std::string where = filter_sql(f, params);
    params.emplace_back(static_cast<std::int64_t>(limit));
    const std::string lp = "$" + std::to_string(params.size());
    params.emplace_back(static_cast<std::int64_t>(offset));
    const std::string op = "$" + std::to_string(params.size());
    auto rows = db.query(
        "SELECT c.id, c.name, c.normalized_name, c.url, c.industry, c.description, c.roles, c.tags, c.location, c.size, "
        "c.employee_count, c.listing_market, c.source, c.source_url, c.is_newgrad, c.is_game, c.has_opening, c.recruit_url, "
        "c.stock_reason, c.sources, c.is_smb, c.is_listed, c.corporate_number, c.crawled_at, c.updated_at, "
        "(SELECT count(*) FROM company_interview_articles a WHERE a.company_id = c.id) AS article_count, "
        "CASE WHEN EXISTS(SELECT 1 FROM company_newgrad_role_images r WHERE r.company_id = c.id) THEN TRUE ELSE FALSE END AS has_newgrad_image, "
        "CASE WHEN EXISTS(SELECT 1 FROM company_profiles p WHERE p.company_id = c.id) THEN TRUE ELSE FALSE END AS has_profile, "
        "(SELECT count(*) FROM company_game cg WHERE cg.company_id = c.id) AS game_count FROM companies c" +
            where +
            " ORDER BY (c.is_newgrad AND c.has_opening) DESC, c.is_newgrad DESC, c.has_opening DESC, c.updated_at DESC LIMIT " +
            lp + " OFFSET " + op,
        params);
    for (auto& r : rows) r = with_numbers(r, {"article_count", "game_count"});
    return rows;
}

long long count_companies(db::Database& db, const CompanyFilter& f) {
    db::Params params;
    auto rows = db.query("SELECT count(*)::text AS count FROM companies c" + filter_sql(f, params), params);
    return rows.empty() ? 0 : static_cast<long long>(num(rows[0]["count"]));
}

std::optional<Json> get_company(db::Database& db, const std::string& id) {
    if (!is_uuid(id)) return std::nullopt;
    auto rows = db.query(
        "SELECT id, name, normalized_name, url, industry, description, roles, tags, location, size, employee_count, "
        "listing_market, source, source_url, is_newgrad, is_game, has_opening, recruit_url, stock_reason, sources, is_smb, "
        "is_listed, corporate_number, crawled_at, updated_at FROM companies WHERE id = $1",
        {id});
    if (rows.empty()) return std::nullopt;
    return rows[0];
}

db::Rows all_companies_for_scoring(db::Database& db, long long limit) {
    return db.query(
        "SELECT id, name, normalized_name, url, industry, description, roles, tags, location, size, employee_count, "
        "listing_market, source, source_url, is_newgrad, is_game, has_opening, recruit_url, stock_reason, sources, is_smb, "
        "is_listed, corporate_number, crawled_at, updated_at FROM companies ORDER BY updated_at DESC LIMIT $1",
        {static_cast<std::int64_t>(std::min<long long>(limit, 5000))});
}

std::optional<Json> get_profile(db::Database& db, const std::string& company_id) {
    if (!is_uuid(company_id)) return std::nullopt;
    auto rows = db.query(
        "SELECT company_id, philosophy, \"values\", ir_summary, business, sources, fetched_at FROM company_profiles WHERE company_id = $1",
        {company_id});
    if (rows.empty()) return std::nullopt;
    return rows[0];
}

db::Rows get_newgrad_role_images(db::Database& db, const std::string& company_id) {
    if (!is_uuid(company_id)) return {};
    return db.query(
        "SELECT role, summary, themes, article_count, model, fetched_at FROM company_newgrad_role_images WHERE company_id = $1 ORDER BY role",
        {company_id});
}

db::Rows list_interview_articles(db::Database& db, const std::string& company_id, int limit) {
    if (!is_uuid(company_id)) return {};
    return db.query("SELECT url, title, body FROM company_interview_articles WHERE company_id = $1 ORDER BY fetched_at DESC LIMIT $2",
                    {company_id, static_cast<std::int64_t>(std::min(std::max(limit, 1), 500))});
}

std::vector<Json> get_games_by_company(db::Database& db, const std::string& company_id) {
    if (!is_uuid(company_id)) return {};
    std::vector<Json> out;
    for (const auto& r : db.query(
             "SELECT g.id, g.title, g.series, g.platform, g.release_year, cg.role FROM company_game cg JOIN games g ON g.id = cg.game_id "
             "WHERE cg.company_id = $1 ORDER BY g.release_year DESC, g.title",
             {company_id})) {
        out.push_back(with_numbers(r, {"release_year"}));
    }
    return out;
}

std::vector<Json> get_ob_placements(db::Database& db, const std::string& company_id) {
    if (!is_uuid(company_id)) return {};
    std::vector<Json> out;
    for (const auto& r : db.query(
             "SELECT join_year, class_name, role, headcount, source FROM company_ob_placement WHERE company_id = $1 "
             "ORDER BY join_year DESC, class_name, role",
             {company_id})) {
        out.push_back(with_numbers(r, {"join_year", "headcount"}));
    }
    return out;
}

Json build_ob_summary(const std::vector<Json>& rows) {
    // Map の挿入順を保ち、並べ替えは安定 (JS の Array.prototype.sort と同じ)
    std::vector<std::pair<std::int64_t, std::int64_t>> years;
    std::vector<std::pair<std::string, std::int64_t>> roles, classes;
    std::int64_t total = 0;
    auto bump = [](auto& v, const auto& key, std::int64_t n) {
        for (auto& [k, c] : v) {
            if (k == key) {
                c += n;
                return;
            }
        }
        v.emplace_back(key, n);
    };
    for (const auto& r : rows) {
        const auto hc = r.value("headcount", Json(0)).get<std::int64_t>();
        total += hc;
        const auto year = r.value("join_year", Json(0)).get<std::int64_t>();
        if (year > 0) bump(years, year, hc);
        const std::string role = string_or(r, "role");
        if (!role.empty()) bump(roles, role, hc);
        const std::string cls = string_or(r, "class_name");
        if (!cls.empty()) bump(classes, cls, hc);
    }
    std::stable_sort(years.begin(), years.end(), [](const auto& a, const auto& b) { return a.first > b.first; });
    std::stable_sort(roles.begin(), roles.end(), [](const auto& a, const auto& b) { return a.second > b.second; });
    std::stable_sort(classes.begin(), classes.end(), [](const auto& a, const auto& b) { return a.second > b.second; });
    Json by_year = Json::array(), by_role = Json::array(), by_class = Json::array();
    for (const auto& [y, n] : years) by_year.push_back(Json{{"join_year", y}, {"headcount", n}});
    for (const auto& [r, n] : roles) by_role.push_back(Json{{"role", r}, {"headcount", n}});
    for (const auto& [c, n] : classes) by_class.push_back(Json{{"class_name", c}, {"headcount", n}});
    return Json{{"total", total}, {"cells", rows.size()}, {"by_year", by_year}, {"by_role", by_role}, {"by_class", by_class}};
}

std::vector<Json> top_companies_by_ob(db::Database& db, long long limit) {
    std::vector<Json> out;
    for (const auto& r : db.query(
             "SELECT c.id, c.name, COALESCE(sum(op.headcount), 0)::text AS ob_total FROM company_ob_placement op "
             "JOIN companies c ON c.id = op.company_id GROUP BY c.id, c.name ORDER BY sum(op.headcount) DESC, c.name LIMIT $1",
             {static_cast<std::int64_t>(std::min<long long>(std::max<long long>(limit, 1), 200))})) {
        out.push_back(with_numbers(r, {"ob_total"}));
    }
    return out;
}

std::vector<Json> search_games(db::Database& db, const std::string& q, long long limit) {
    std::vector<Json> out;
    for (const auto& r : db.query(
             "SELECT g.id, g.title, g.series, g.platform, g.release_year, (SELECT count(*) FROM company_game cg WHERE cg.game_id = g.id) "
             "AS company_count FROM games g WHERE g.title ILIKE $1 ORDER BY company_count DESC, g.release_year DESC LIMIT $2",
             {"%" + js_trim(q) + "%", static_cast<std::int64_t>(std::min<long long>(std::max<long long>(limit, 1), 50))})) {
        out.push_back(with_numbers(r, {"release_year", "company_count"}));
    }
    return out;
}

db::Rows list_job_postings(db::Database& db, const std::optional<std::string>& source, std::optional<long long> limit) {
    const long long lim = std::min<long long>(std::max<long long>(limit.value_or(100), 1), 500);
    const std::string s = source ? js_trim(*source) : "";
    return db.query(
        "SELECT id, source, kind, url, title, company_name, company_id, role, location, employment_type, snippet, posted_at, deadline, "
        "first_seen_at FROM job_postings WHERE ($1::text = '' OR source = $1) ORDER BY first_seen_at DESC LIMIT $2",
        {s, static_cast<std::int64_t>(lim)});
}

long long count_job_postings(db::Database& db, const std::optional<std::string>& source) {
    const std::string s = source ? js_trim(*source) : "";
    auto rows = db.query("SELECT count(*) AS n FROM job_postings WHERE ($1::text = '' OR source = $1)", {s});
    return rows.empty() ? 0 : static_cast<long long>(num(rows[0]["n"]));
}

std::vector<Json> load_listing_sources(const std::filesystem::path& root) {
    std::vector<Json> out;
    for (const auto& r : read_array(root / "data" / "companies" / "listing-sources.json")) {
        Json s{{"id", id_string(r)},
               {"kind", r.contains("kind") && !r["kind"].is_null() ? r["kind"] : Json("job-aggregator")},
               {"urls", string_urls(r)},
               {"enabled", r.contains("enabled") && r["enabled"] == true}};
        if (const Json* n = member(r, "note"); n && n->is_string()) s["note"] = *n;
        if (!s["id"].get<std::string>().empty() && !s["urls"].empty()) out.push_back(s);
    }
    return out;
}

std::vector<Json> load_news_sources(const std::filesystem::path& root) {
    std::vector<Json> out;
    for (const auto& r : read_array(root / "data" / "companies" / "news-sources.json")) {
        const std::string kind = string_or(r, "kind");
        Json s{{"id", id_string(r)},
               {"kind", kind == "job-listing" || kind == "recruit-page" ? kind : std::string("rss")},
               {"urls", string_urls(r)},
               {"enabled", r.contains("enabled") && r["enabled"] == true}};
        if (const Json* n = member(r, "note"); n && n->is_string()) s["note"] = *n;
        if (!s["id"].get<std::string>().empty() && !s["urls"].empty()) out.push_back(s);
    }
    return out;
}

std::vector<Json> load_seed_records(const std::filesystem::path& root) {
    std::vector<Json> out;
    for (const auto& r : read_array(root / "data" / "companies" / "seeds.json")) {
        Json s{{"name", string_or(r, "name")}, {"url", string_or(r, "url")}};
        if (!s["url"].get<std::string>().empty()) out.push_back(s);
    }
    return out;
}

bool listing_source_active(const Json& s, const Config& c) {
    const auto& opt = c.company_crawl.listing_opt_in_sources;
    return s.value("enabled", false) || std::find(opt.begin(), opt.end(), s.value("id", std::string())) != opt.end();
}

bool news_source_active(const Json& s, const Config& c) {
    const auto& opt = c.job_news.opt_in_sources;
    return s.value("enabled", false) || std::find(opt.begin(), opt.end(), s.value("id", std::string())) != opt.end();
}

}  // namespace tr::app
