#include "app/companies_repo.hpp"

#include <algorithm>
#include <cmath>
#include <fstream>
#include <map>
#include <sstream>

#include "io/file_read.hpp"
#include "app/interview_repo.hpp"
#include "core/llm/output.hpp"
#include "http/message.hpp"
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
    return io::read_file_text(p, 8 * 1024 * 1024);  // 読みながら上限で止める (Lorica の予算)
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

// ---------------------------------------------------------------- ゲームグラフの探索

namespace {

const char* kCompanySel =
    "c.id, c.name, c.location, c.url, c.industry, c.is_smb, c.is_listed, c.employee_count, c.listing_market, c.is_newgrad, "
    "c.has_opening, c.recruit_url, c.is_social, c.primary_platform, c.description, c.crawled_at, "
    "(SELECT COALESCE(sum(op.headcount), 0) FROM company_ob_placement op WHERE op.company_id = c.id) AS ob_total, "
    "(SELECT count(*) FROM company_interview_articles a WHERE a.company_id = c.id) AS article_count, "
    "CASE WHEN EXISTS(SELECT 1 FROM company_profiles p WHERE p.company_id = c.id) THEN TRUE ELSE FALSE END AS has_profile";

// toBool: v === true || v === 1 || v === '1' || v === 't'
bool to_bool(const Json* v) {
    if (!v) return false;
    if (v->is_boolean()) return v->get<bool>();
    if (v->is_number()) return v->get<double>() == 1;
    if (v->is_string()) return *v == "1" || *v == "t";
    return false;
}

Json number_json(const Json* v) {
    // Number(v): null → 0、文字列は数値化 (int8/numeric は postgres.js と同じく文字列で来る)
    const double d = v ? num(*v) : 0;
    return d == static_cast<double>(static_cast<std::int64_t>(d)) ? Json(static_cast<std::int64_t>(d)) : Json(d);
}

// direct / by-tech の行: 列はそのまま、真偽値と数値を正規化し relation を足す (JS の {...r, x: ...} と同じ順)。
Json company_row(Json r, const std::string& relation) {
    for (const char* k : {"is_smb", "is_listed", "is_newgrad", "has_opening", "is_social", "has_profile"}) r[k] = to_bool(member(r, k));
    for (const char* k : {"employee_count", "ob_total", "article_count"}) r[k] = number_json(member(r, k));
    if (!r.contains("description") || r["description"].is_null()) r["description"] = "";
    r["relation"] = relation;
    return r;
}

std::map<std::string, std::vector<std::string>> tech_names(db::Database& db, const std::vector<std::string>& ids) {
    std::map<std::string, std::vector<std::string>> out;
    for (const auto& id : ids) {
        if (out.count(id)) continue;
        std::vector<std::string> names;
        for (const auto& r : db.query("SELECT t.name, t.category FROM company_tech ct JOIN tech t ON t.id = ct.tech_id WHERE ct.company_id = $1",
                                      {id})) {
            names.push_back(string_or(r, "name"));
        }
        out[id] = names;
    }
    return out;
}

Json tech_json(const std::map<std::string, std::vector<std::string>>& m, const std::string& id) {
    auto it = m.find(id);
    return it == m.end() ? Json::array() : Json(it->second);
}

}  // namespace

Json related_companies_by_game(db::Database& db, const std::string& game_id, const RelatedFilters& f) {
    Json none{{"game", nullptr}, {"direct", Json::array()}, {"related", Json::array()}};
    if (!is_uuid(game_id)) return none;
    auto games = db.query(
        "SELECT id, title, normalized_title, series, normalized_series, platform, platform_class, genre, release_year, source, "
        "source_url, sources, crawled_at, updated_at FROM games WHERE id = $1",
        {game_id});
    if (games.empty()) return none;
    const Json game = games[0];
    std::vector<Json> direct;
    for (auto& r : db.query(std::string("SELECT ") + kCompanySel +
                                ", cg.role AS role FROM company_game cg JOIN companies c ON c.id = cg.company_id WHERE cg.game_id = $1 "
                                "ORDER BY cg.role",
                            {game_id})) {
        direct.push_back(company_row(std::move(r), "direct"));
    }
    // つながり (reason) を 1 件足す。最初に見た行で項目を作る (Map の挿入順を保つ)。
    std::vector<std::string> order;
    std::map<std::string, Json> by_id;
    auto add_reason = [&](const Json& row, const std::string& reason) {
        const std::string id = string_or(row, "id");
        auto it = by_id.find(id);
        if (it == by_id.end()) {
            Json rc{{"id", row["id"]},
                    {"name", row["name"]},
                    {"location", row["location"]},
                    {"url", row["url"]},
                    {"industry", row["industry"]},
                    {"is_smb", to_bool(member(row, "is_smb"))},
                    {"is_listed", to_bool(member(row, "is_listed"))},
                    {"employee_count", number_json(member(row, "employee_count"))},
                    {"listing_market", row["listing_market"]},
                    {"is_newgrad", to_bool(member(row, "is_newgrad"))},
                    {"has_opening", to_bool(member(row, "has_opening"))},
                    {"is_social", to_bool(member(row, "is_social"))},
                    {"primary_platform", row["primary_platform"]},
                    {"ob_total", number_json(member(row, "ob_total"))},
                    {"description", row["description"].is_null() ? Json("") : row["description"]},
                    {"has_profile", to_bool(member(row, "has_profile"))},
                    {"article_count", number_json(member(row, "article_count"))},
                    {"crawled_at", row.value("crawled_at", Json(nullptr))},
                    {"recruit_url", row["recruit_url"]},
                    {"relation", "related"},
                    {"shared_games", 0},
                    {"via_titles", Json::array()}};
            it = by_id.emplace(id, std::move(rc)).first;
            order.push_back(id);
        }
        Json& titles = it->second["via_titles"];
        if (!reason.empty() && std::find(titles.begin(), titles.end(), Json(reason)) == titles.end()) titles.push_back(reason);
    };
    const std::string in_game = "(SELECT company_id FROM company_game WHERE game_id = $1)";
    // 1) 作り手と他ゲームを共作した企業 (2 ホップ)
    for (const auto& r : db.query(std::string("SELECT ") + kCompanySel +
                                      ", g.title AS via_title FROM company_game cg1 JOIN company_game cg2 ON cg2.game_id = cg1.game_id "
                                      "AND cg2.company_id <> cg1.company_id JOIN companies c ON c.id = cg2.company_id JOIN games g ON g.id = cg1.game_id "
                                      "WHERE cg1.company_id IN " + in_game + " AND cg2.company_id NOT IN " + in_game,
                                  {game_id})) {
        add_reason(r, "共作: " + string_or(r, "via_title"));
    }
    // 2) 同シリーズの他作品の開発/発売企業 (正規化キーが空の行は raw series に戻す)
    const std::string series = string_or(game, "series");
    if (!series.empty()) {
        const std::string key0 = "(CASE WHEN g0.normalized_series <> '' THEN g0.normalized_series ELSE g0.series END)";
        for (const auto& r :
             db.query(std::string("SELECT ") + kCompanySel +
                          ", g2.title AS via_title FROM games g0 JOIN games g2 ON (CASE WHEN g2.normalized_series <> '' THEN "
                          "g2.normalized_series ELSE g2.series END) = " + key0 +
                          " AND g2.id <> g0.id JOIN company_game cg ON cg.game_id = g2.id JOIN companies c ON c.id = cg.company_id "
                          "WHERE g0.id = $1 AND " + key0 + " <> '' AND c.id NOT IN " + in_game,
                      {game_id})) {
            add_reason(r, series + "シリーズ: " + string_or(r, "via_title"));
        }
    }
    // 3) 直接関与企業の取引先
    for (const auto& r : db.query(std::string("SELECT ") + kCompanySel +
                                      " FROM company_partner cp JOIN companies c ON c.id = cp.partner_id WHERE cp.company_id IN " + in_game +
                                      " AND cp.partner_id NOT IN " + in_game,
                                  {game_id})) {
        add_reason(r, "取引先");
    }
    std::vector<Json> related;
    for (const auto& id : order) {
        Json r = by_id[id];
        r["shared_games"] = r["via_titles"].size();
        if (f.smb && !r["is_smb"].get<bool>()) continue;
        if (f.newgrad && !r["is_newgrad"].get<bool>()) continue;
        if (f.opening && !r["has_opening"].get<bool>()) continue;
        if (f.social && !r["is_social"].get<bool>()) continue;
        related.push_back(std::move(r));
    }
    std::stable_sort(related.begin(), related.end(),
                     [](const Json& a, const Json& b) { return a["shared_games"].get<std::size_t>() > b["shared_games"].get<std::size_t>(); });
    if (related.size() > 200) related.resize(200);  // 技術の付与前に候補を絞る
    std::vector<std::string> ids;
    for (const auto& d : direct) ids.push_back(string_or(d, "id"));
    for (const auto& r : related) ids.push_back(string_or(r, "id"));
    const auto techs = tech_names(db, ids);
    Json direct_out = Json::array();
    for (auto& d : direct) {
        d["tech"] = tech_json(techs, string_or(d, "id"));
        direct_out.push_back(std::move(d));
    }
    for (auto& r : related) r["tech"] = tech_json(techs, string_or(r, "id"));
    if (f.engine && !f.engine->empty()) {
        const std::string needle = js_to_lower(*f.engine);
        std::vector<Json> kept;
        for (auto& r : related) {
            bool hit = false;
            for (const auto& t : r["tech"]) hit |= js_to_lower(t.get<std::string>()).find(needle) != std::string::npos;
            if (hit) kept.push_back(std::move(r));
        }
        related.swap(kept);
    }
    const auto lim = static_cast<std::size_t>(std::min<long long>(std::max<long long>(f.limit.value_or(30), 1), 100));
    if (related.size() > lim) related.resize(lim);
    Json related_out = Json::array();
    for (auto& r : related) {
        Json& v = r["via_titles"];
        if (v.size() > 5) v.erase(v.begin() + 5, v.end());
        related_out.push_back(std::move(r));
    }
    return Json{{"game", game}, {"direct", direct_out}, {"related", related_out}};
}

std::vector<Json> companies_by_tech(db::Database& db, const std::string& tech, bool smb, bool social, std::optional<long long> limit) {
    const auto lim = static_cast<std::size_t>(std::min<long long>(std::max<long long>(limit.value_or(50), 1), 200));
    std::vector<Json> out;
    std::vector<std::string> seen;
    for (auto& r : db.query(std::string("SELECT ") + kCompanySel +
                                " FROM company_tech ct JOIN tech t ON t.id = ct.tech_id JOIN companies c ON c.id = ct.company_id "
                                "WHERE t.name ILIKE $1",
                            {"%" + tech + "%"})) {
        Json row = company_row(std::move(r), "related");
        if (smb && !row["is_smb"].get<bool>()) continue;
        if (social && !row["is_social"].get<bool>()) continue;
        const std::string id = string_or(row, "id");
        if (std::find(seen.begin(), seen.end(), id) != seen.end()) continue;  // 重複社を畳む
        seen.push_back(id);
        out.push_back(std::move(row));
    }
    if (out.size() > lim) out.resize(lim);
    std::vector<std::string> ids;
    for (const auto& r : out) ids.push_back(string_or(r, "id"));
    const auto techs = tech_names(db, ids);
    for (auto& r : out) r["tech"] = tech_json(techs, string_or(r, "id"));
    return out;
}

// ---------------------------------------------------------------- 地図マーカー

std::optional<std::pair<double, double>> parse_geocode_result(const Json& body) {
    if (!body.is_object() || body.value("status", Json(nullptr)) != "OK") return std::nullopt;
    const Json* results = member(body, "results");
    if (!results || !results->is_array() || results->empty()) return std::nullopt;
    const Json& first = (*results)[0];
    const Json* geometry = first.is_object() ? member(first, "geometry") : nullptr;
    const Json* loc = geometry && geometry->is_object() ? member(*geometry, "location") : nullptr;
    auto number_of = [&](const char* k) {
        if (!loc || !loc->is_object() || !loc->contains(k)) return std::nan("");  // Number(undefined) = NaN
        return llm::js_to_number((*loc)[k]);
    };
    const double lat = number_of("lat");
    const double lng = number_of("lng");
    if (!std::isfinite(lat) || !std::isfinite(lng)) return std::nullopt;
    if (lat == 0 && lng == 0) return std::nullopt;
    return std::make_pair(lat, lng);
}

Json build_map_markers(db::Database& db, const HttpFetch& fetch, const std::string& api_key, long long max_geocode,
                       std::chrono::milliseconds deadline) {
    if (api_key.empty()) return Json{{"enabled", false}, {"markers", Json::array()}, {"pendingLocations", 0}};
    const auto companies = db.query(
        "SELECT c.id, c.name, c.location, c.is_smb, c.is_social, (SELECT count(*) FROM company_game cg WHERE cg.company_id = c.id) "
        "AS game_count FROM companies c WHERE c.location <> '' AND EXISTS (SELECT 1 FROM company_game cg WHERE cg.company_id = c.id)");
    std::vector<std::string> distinct;
    for (const auto& c : companies) {
        const std::string loc = string_or(c, "location");
        if (std::find(distinct.begin(), distinct.end(), loc) == distinct.end()) distinct.push_back(loc);
    }
    struct LatLng {
        double lat, lng;
        bool ok;
    };
    std::map<std::string, LatLng> coords;
    long long geocoded = 0, pending = 0;
    const auto until = std::chrono::steady_clock::now() + deadline;
    for (const auto& loc : distinct) {
        auto cached = db.query("SELECT location, lat, lng, ok FROM geocode_cache WHERE location = $1", {loc});
        if (!cached.empty()) {
            coords[loc] = {num(cached[0]["lat"]), num(cached[0]["lng"]), to_bool(member(cached[0], "ok"))};
            continue;
        }
        if (geocoded >= max_geocode || std::chrono::steady_clock::now() >= until) {
            ++pending;
            continue;
        }
        std::optional<std::pair<double, double>> ll;
        try {
            io::HttpClientRequest req;
            req.method = "GET";
            // キーは URL に載る (Google の仕様)。この URL はログに出さない。
            req.url = "https://maps.googleapis.com/maps/api/geocode/json?address=" + http::encode_uri_component(loc) +
                      "&language=ja&region=jp&key=" + http::encode_uri_component(api_key);
            req.timeout = std::chrono::milliseconds(10'000);
            req.max_response_bytes = 1024 * 1024;
            req.public_only = true;
            const auto res = fetch(req);
            if (res.ok()) {
                if (auto body = parse_json(res.body)) ll = parse_geocode_result(*body);
            }
        } catch (...) {
            ll.reset();
        }
        ++geocoded;
        const LatLng v = ll ? LatLng{ll->first, ll->second, true} : LatLng{0, 0, false};  // 失敗も記録して再試行を抑える
        db.query("INSERT INTO geocode_cache (location, lat, lng, ok) VALUES ($1, $2, $3, $4) ON CONFLICT (location) DO UPDATE SET "
                 "lat = EXCLUDED.lat, lng = EXCLUDED.lng, ok = EXCLUDED.ok, geocoded_at = now()",
                 {loc, v.lat, v.lng, v.ok});
        coords[loc] = v;
    }
    Json markers = Json::array();
    for (const auto& c : companies) {
        auto it = coords.find(string_or(c, "location"));
        if (it == coords.end() || !it->second.ok) continue;
        markers.push_back(Json{{"id", c["id"]},
                               {"name", c["name"]},
                               {"location", c["location"]},
                               {"lat", it->second.lat},
                               {"lng", it->second.lng},
                               {"is_smb", to_bool(member(c, "is_smb"))},
                               {"is_social", to_bool(member(c, "is_social"))},
                               {"game_count", number_json(member(c, "game_count"))}});
    }
    return Json{{"enabled", true}, {"markers", markers}, {"pendingLocations", pending}};
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
