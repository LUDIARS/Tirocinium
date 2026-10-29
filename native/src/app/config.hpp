#pragma once
// apps/server/src/config.ts と secrets/apply.ts の移植。既定値は Node 版と同じ。
// 秘密値 (トークン・キー) はこの構造体のメモリにだけ持ち、ログには出さない。

#include <cstdint>
#include <map>
#include <optional>
#include <string>
#include <vector>

namespace tr::app {

struct DiscordConfig {
    std::string bot_token;
    std::string guild_id;
    std::string category_id;
    std::vector<std::string> allowed_channel_ids;
    std::string command_prefix = "!tr";
};

struct CompanyCrawlConfig {
    int max_pages = 20;
    int fetch_timeout_ms = 15'000;
    int min_interval_ms = 2'000;
    bool respect_robots = true;
    int enrich_max_pages = 5;
    std::string user_agent = "TirociniumBot/0.1 (+https://github.com/LUDIARS/Tirocinium)";
    std::vector<std::string> admin_ids;
    std::vector<std::string> listing_opt_in_sources;
    bool require_smb = false;
    int listing_chunk_chars = 16'000;
    int listing_max_chars = 120'000;
    int listing_max_chunks = 12;
};

struct JobNewsConfig {
    bool enabled = false;
    int daily_hour = 6;
    std::string time_zone = "Asia/Tokyo";
    std::string discord_webhook_url;
    std::vector<std::string> opt_in_sources;
    std::string notify_user_id;
    int max_items_per_source = 60;
};

struct Config {
    std::string interviewer_model = "sol";  // 'sol' | 'opus'
    int port = 8084;
    // 既定は loopback。外部公開する場合は TIROCINIUM_HOST と Cernere 設定を必ず入れる。
    std::string host = "127.0.0.1";
    // C++ 版は Postgres (libpq) のみ。空なら起動しない (SQLite は未許可。PORTING.md §0)。
    std::string database_url;
    std::string cernere_public_key;
    std::string cernere_audience = "tirocinium";
    struct {
        std::string url;
        std::string project_client_id;
        std::string project_client_secret;
    } cernere;
    bool dev_auth = false;
    std::string dev_user_id = "00000000-0000-0000-0000-000000000001";
    std::string llm_backend = "api";  // 'api' | 'cli'
    int slot_duration_min = 30;
    int slot_capacity = 4;
    int no_show_timeout_min = 5;
    int notify_lead_min = 15;
    std::string nuntius_url;
    std::string nuntius_api_key;
    DiscordConfig discord;
    CompanyCrawlConfig company_crawl;
    std::string google_maps_api_key;
    struct {
        std::string service_account_json;
        std::string spreadsheet_id;
        std::string range = "A:Z";
    } ob_sheet;
    struct {
        std::string token;
        int min_interval_ms = 3'000;
        std::string default_industry;
    } gbiz;
    struct {
        bool enabled = true;
        int interval_ms = 60'000;
    } enrich_queue;
    struct {
        bool enabled = true;
        int interval_ms = 15'000;
        int max_attempts = 3;
        bool chain_enrich = true;
    } crawl_queue;
    JobNewsConfig job_news;
    struct {
        int window_ms = 60'000;
        int max = 10;
    } session_rate_limit;

    // 子プロセスへ渡す必要がある値と、LLM の有効判定 (Node 版で process.env に注入していたもの)。
    // ANTHROPIC_API_KEY は C++ 版では Anthropic を呼ばない (claude -p に置換)。有無は機能の有効判定だけに使う。
    std::string anthropic_api_key;
    std::string openai_api_key;
    std::string claude_code_git_bash_path;
};

// JS の Number.parseInt(v, 10)。数字が 1 つも無ければ nullopt (NaN)。
std::optional<long long> js_parse_int(const std::string& v);

// secrets/apply.ts の applyDiscordSecrets / applyServerConfig。適用したキー名を返す。
// 不正な TIROCINIUM_INTERVIEWER_MODEL は例外 (起動を止める)。
std::vector<std::string> apply_discord_secrets(DiscordConfig& discord, const std::map<std::string, std::string>& secrets);
std::vector<std::string> apply_server_config(Config& cfg, const std::map<std::string, std::string>& secrets);

// hydrate.ts の SECRET_KEYS (secret-agent に問い合わせるキー。契約を変えないため Node 版と同一)。
const std::vector<std::string>& secret_keys();

bool is_loopback_host(const std::string& host);

}  // namespace tr::app
