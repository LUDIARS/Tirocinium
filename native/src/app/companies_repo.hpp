#pragma once
// 企業 DB の読み出しとクロールの投入 (companies/{repo,crawl-queue-repo,profile-repo,newgrad-repo,games-repo,
// ob-repo,job-postings-repo,listing-config,news-config,seeds}.ts の読み出し部分)。
// HTML の取得・解析・LLM 抽出 (クロール本体) は Node の企業 worker に残す。

#include <filesystem>
#include <optional>
#include <string>
#include <vector>

#include "app/config.hpp"
#include "core/json.hpp"
#include "db/database.hpp"

namespace tr::app {

struct EnqueueResult {
    Json job;
    bool deduped = false;
};
// 同じ URL の queued/running が既にあれば新規作成せず再利用 (unique index が最後の砦)。
EnqueueResult enqueue_crawl(db::Database& db, const std::string& url, const std::string& name_hint, const std::string& source,
                            const std::optional<Json>& max_pages, const std::string& requested_by);
Json crawl_queue_counts(db::Database& db);
db::Rows recent_crawl_jobs(db::Database& db, int limit = 20);
Json auto_enrich_stats(db::Database& db);

struct CompanyFilter {
    std::optional<std::string> role, tag, industry, q;
    bool quality = false, summarized = false, newgrad = false, opening = false;
    std::optional<long long> limit, offset;
};
db::Rows list_companies(db::Database& db, const CompanyFilter& f);
long long count_companies(db::Database& db, const CompanyFilter& f);
std::optional<Json> get_company(db::Database& db, const std::string& id);
// allCompaniesForScoring: 更新の新しい順に最大 limit 社 (上限 5000)。
db::Rows all_companies_for_scoring(db::Database& db, long long limit = 1000);
std::optional<Json> get_profile(db::Database& db, const std::string& company_id);
db::Rows get_newgrad_role_images(db::Database& db, const std::string& company_id);
db::Rows list_interview_articles(db::Database& db, const std::string& company_id, int limit);
std::vector<Json> get_games_by_company(db::Database& db, const std::string& company_id);
std::vector<Json> get_ob_placements(db::Database& db, const std::string& company_id);
Json build_ob_summary(const std::vector<Json>& placements);
std::vector<Json> top_companies_by_ob(db::Database& db, long long limit);
std::vector<Json> search_games(db::Database& db, const std::string& q, long long limit);
db::Rows list_job_postings(db::Database& db, const std::optional<std::string>& source, std::optional<long long> limit);
long long count_job_postings(db::Database& db, const std::optional<std::string>& source);

// data/companies/*.json の設定 (無い・壊れている → 空)。
std::vector<Json> load_listing_sources(const std::filesystem::path& root);
std::vector<Json> load_news_sources(const std::filesystem::path& root);
std::vector<Json> load_seed_records(const std::filesystem::path& root);
bool listing_source_active(const Json& s, const Config& c);
bool news_source_active(const Json& s, const Config& c);

}  // namespace tr::app
