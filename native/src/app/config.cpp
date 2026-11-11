#include "app/config.hpp"

#include <functional>
#include <stdexcept>

#include "core/text.hpp"

namespace tr::app {

std::optional<long long> js_parse_int(const std::string& v) {
    const std::string s = js_trim(v);
    std::size_t i = 0;
    bool neg = false;
    if (i < s.size() && (s[i] == '+' || s[i] == '-')) {
        neg = s[i] == '-';
        ++i;
    }
    long long n = 0;
    std::size_t start = i;
    while (i < s.size() && s[i] >= '0' && s[i] <= '9') {
        if (n > 100'000'000'000'000LL) return std::nullopt;  // 安全な範囲を超える値は採用しない
        n = n * 10 + (s[i] - '0');
        ++i;
    }
    if (i == start) return std::nullopt;
    return neg ? -n : n;
}

namespace {

using Secrets = std::map<std::string, std::string>;

struct Applier {
    const Secrets& secrets;
    std::vector<std::string>& applied;

    // set: 空でない値だけ
    void set(const std::string& key, const std::function<void(const std::string&)>& fn) const {
        auto it = secrets.find(key);
        if (it != secrets.end() && !it->second.empty()) {
            fn(it->second);
            applied.push_back(key);
        }
    }
    // setNum: 値があり parseInt が NaN でなければ
    void set_num(const std::string& key, const std::function<void(int)>& fn) const {
        auto it = secrets.find(key);
        if (it == secrets.end()) return;
        if (auto n = js_parse_int(it->second)) {
            fn(static_cast<int>(*n));
            applied.push_back(key);
        }
    }
    // setBool: 値があれば (空でも) '1' か 'true' (大小無視) を真とする
    void set_bool(const std::string& key, const std::function<void(bool)>& fn) const {
        auto it = secrets.find(key);
        if (it == secrets.end()) return;
        fn(it->second == "1" || ascii_lower(it->second) == "true");
        applied.push_back(key);
    }
};

std::vector<std::string> csv(const std::string& v) { return split_trim_nonempty(v, ','); }

std::string strip_trailing_slashes(std::string v) {
    while (!v.empty() && v.back() == '/') v.pop_back();
    return v;
}

}  // namespace

std::vector<std::string> apply_discord_secrets(DiscordConfig& d, const Secrets& secrets) {
    std::vector<std::string> applied;
    Applier a{secrets, applied};
    a.set("TIROCINIUM_DISCORD_BOT_TOKEN", [&](const std::string& v) { d.bot_token = v; });
    a.set("TIROCINIUM_DISCORD_GUILD_ID", [&](const std::string& v) { d.guild_id = v; });
    a.set("TIROCINIUM_DISCORD_CATEGORY_ID", [&](const std::string& v) { d.category_id = v; });
    a.set("TIROCINIUM_DISCORD_COMMAND_PREFIX", [&](const std::string& v) { d.command_prefix = v; });
    a.set("TIROCINIUM_DISCORD_TEXT_CHANNEL_IDS", [&](const std::string& v) { d.allowed_channel_ids = csv(v); });
    return applied;
}

std::vector<std::string> apply_server_config(Config& c, const Secrets& secrets) {
    std::vector<std::string> applied;
    Applier a{secrets, applied};
    a.set("TIROCINIUM_HOST", [&](const std::string& v) { c.host = v; });
    a.set_num("TIROCINIUM_PORT", [&](int v) { c.port = v; });
    a.set_bool("TIROCINIUM_DEV_AUTH", [&](bool v) { c.dev_auth = v; });
    a.set("CERNERE_PUBLIC_KEY", [&](const std::string& v) { c.cernere_public_key = v; });
    a.set("CERNERE_AUDIENCE", [&](const std::string& v) { c.cernere_audience = v; });
    a.set("CERNERE_URL", [&](const std::string& v) { c.cernere.url = strip_trailing_slashes(v); });
    a.set("CERNERE_PROJECT_CLIENT_ID", [&](const std::string& v) { c.cernere.project_client_id = v; });
    a.set("CERNERE_PROJECT_CLIENT_SECRET", [&](const std::string& v) { c.cernere.project_client_secret = v; });
    a.set("TIROCINIUM_LLM_BACKEND", [&](const std::string& v) { c.llm_backend = v; });
    a.set("TIROCINIUM_INTERVIEWER_MODEL", [&](const std::string& v) {
        if (v != "sol" && v != "opus") throw std::runtime_error("TIROCINIUM_INTERVIEWER_MODEL must be sol or opus");
        c.interviewer_model = v;
    });
    a.set_num("SLOT_DURATION_MIN", [&](int v) { c.slot_duration_min = v; });
    a.set_num("SLOT_CAPACITY", [&](int v) { c.slot_capacity = v; });
    a.set_num("NO_SHOW_TIMEOUT_MIN", [&](int v) { c.no_show_timeout_min = v; });
    a.set_num("NOTIFY_LEAD_MIN", [&](int v) { c.notify_lead_min = v; });
    a.set_num("COMPANY_CRAWL_MAX_PAGES", [&](int v) { c.company_crawl.max_pages = v; });
    a.set_num("COMPANY_CRAWL_FETCH_TIMEOUT_MS", [&](int v) { c.company_crawl.fetch_timeout_ms = v; });
    a.set_num("COMPANY_CRAWL_MIN_INTERVAL_MS", [&](int v) { c.company_crawl.min_interval_ms = v; });
    a.set_bool("COMPANY_CRAWL_RESPECT_ROBOTS", [&](bool v) { c.company_crawl.respect_robots = v; });
    a.set_num("COMPANY_ENRICH_MAX_PAGES", [&](int v) { c.company_crawl.enrich_max_pages = v; });
    a.set("COMPANY_CRAWL_USER_AGENT", [&](const std::string& v) { c.company_crawl.user_agent = v; });
    a.set("COMPANY_CRAWL_ADMIN_IDS", [&](const std::string& v) { c.company_crawl.admin_ids = csv(v); });
    a.set("COMPANY_LISTING_OPTIN_SOURCES",
          [&](const std::string& v) { c.company_crawl.listing_opt_in_sources = csv(v); });
    a.set_bool("COMPANY_REQUIRE_SMB", [&](bool v) { c.company_crawl.require_smb = v; });
    a.set_num("COMPANY_LISTING_CHUNK_CHARS", [&](int v) { c.company_crawl.listing_chunk_chars = v; });
    a.set("NUNTIUS_URL", [&](const std::string& v) { c.nuntius_url = v; });
    a.set("NUNTIUS_API_KEY", [&](const std::string& v) { c.nuntius_api_key = v; });
    a.set_bool("COMPANY_JOB_NEWS_ENABLED", [&](bool v) { c.job_news.enabled = v; });
    a.set_num("COMPANY_JOB_NEWS_DAILY_HOUR", [&](int v) { c.job_news.daily_hour = v; });
    a.set("COMPANY_JOB_NEWS_TIME_ZONE", [&](const std::string& v) { c.job_news.time_zone = v; });
    a.set("COMPANY_JOB_NEWS_DISCORD_WEBHOOK_URL", [&](const std::string& v) { c.job_news.discord_webhook_url = v; });
    a.set("COMPANY_JOB_NEWS_OPTIN_SOURCES", [&](const std::string& v) { c.job_news.opt_in_sources = csv(v); });
    a.set("COMPANY_JOB_NEWS_NOTIFY_USER_ID", [&](const std::string& v) { c.job_news.notify_user_id = v; });
    a.set("GOOGLE_MAPS_API_KEY", [&](const std::string& v) { c.google_maps_api_key = v; });
    a.set("TIROCINIUM_OB_SHEET_SA_JSON", [&](const std::string& v) { c.ob_sheet.service_account_json = v; });
    a.set("TIROCINIUM_OB_SHEET_ID", [&](const std::string& v) { c.ob_sheet.spreadsheet_id = v; });
    a.set("TIROCINIUM_OB_SHEET_RANGE", [&](const std::string& v) { c.ob_sheet.range = v; });
    a.set("GBIZINFO_TOKEN", [&](const std::string& v) { c.gbiz.token = v; });
    a.set_num("GBIZINFO_MIN_INTERVAL_MS", [&](int v) { c.gbiz.min_interval_ms = v; });
    a.set("GBIZINFO_DEFAULT_INDUSTRY", [&](const std::string& v) { c.gbiz.default_industry = v; });
    a.set_num("SESSION_RATELIMIT_WINDOW_MS", [&](int v) { c.session_rate_limit.window_ms = v; });
    a.set_num("SESSION_RATELIMIT_MAX", [&](int v) { c.session_rate_limit.max = v; });
    // 子プロセス (claude CLI) に渡す値 / LLM の有効判定 (Node 版は process.env へ注入していた)。
    a.set("ANTHROPIC_API_KEY", [&](const std::string& v) { c.anthropic_api_key = v; });
    a.set("OPENAI_API_KEY", [&](const std::string& v) { c.openai_api_key = v; });
    a.set("CLAUDE_CODE_GIT_BASH_PATH", [&](const std::string& v) { c.claude_code_git_bash_path = v; });
    return applied;
}

const std::vector<std::string>& secret_keys() {
    static const std::vector<std::string> keys = {
        "TIROCINIUM_PORT", "TIROCINIUM_HOST", "TIROCINIUM_DEV_AUTH", "CERNERE_PUBLIC_KEY", "CERNERE_AUDIENCE",
        "CERNERE_URL", "CERNERE_PROJECT_CLIENT_ID", "CERNERE_PROJECT_CLIENT_SECRET", "TIROCINIUM_LLM_BACKEND",
        "TIROCINIUM_INTERVIEWER_MODEL", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "CLAUDE_CODE_GIT_BASH_PATH",
        "SLOT_DURATION_MIN", "SLOT_CAPACITY", "NO_SHOW_TIMEOUT_MIN", "NOTIFY_LEAD_MIN", "COMPANY_CRAWL_MAX_PAGES",
        "COMPANY_CRAWL_FETCH_TIMEOUT_MS", "COMPANY_CRAWL_MIN_INTERVAL_MS", "COMPANY_CRAWL_RESPECT_ROBOTS",
        "COMPANY_ENRICH_MAX_PAGES", "COMPANY_CRAWL_USER_AGENT", "COMPANY_CRAWL_ADMIN_IDS",
        "COMPANY_LISTING_OPTIN_SOURCES", "COMPANY_REQUIRE_SMB", "COMPANY_LISTING_CHUNK_CHARS", "NUNTIUS_URL",
        "NUNTIUS_API_KEY", "COMPANY_JOB_NEWS_ENABLED", "COMPANY_JOB_NEWS_DAILY_HOUR", "COMPANY_JOB_NEWS_TIME_ZONE",
        "COMPANY_JOB_NEWS_DISCORD_WEBHOOK_URL", "COMPANY_JOB_NEWS_OPTIN_SOURCES", "COMPANY_JOB_NEWS_NOTIFY_USER_ID",
        "GOOGLE_MAPS_API_KEY", "TIROCINIUM_OB_SHEET_SA_JSON", "TIROCINIUM_OB_SHEET_ID", "TIROCINIUM_OB_SHEET_RANGE",
        "GBIZINFO_TOKEN", "GBIZINFO_MIN_INTERVAL_MS", "GBIZINFO_DEFAULT_INDUSTRY", "SESSION_RATELIMIT_WINDOW_MS",
        "SESSION_RATELIMIT_MAX", "TIROCINIUM_DISCORD_BOT_TOKEN", "TIROCINIUM_DISCORD_GUILD_ID",
        "TIROCINIUM_DISCORD_CATEGORY_ID", "TIROCINIUM_DISCORD_TEXT_CHANNEL_IDS", "TIROCINIUM_DISCORD_COMMAND_PREFIX",
    };
    return keys;
}

bool is_loopback_host(const std::string& host) {
    std::string h = ascii_lower(js_trim(host));
    if (h.size() >= 2 && h.front() == '[' && h.back() == ']') h = h.substr(1, h.size() - 2);
    else if (!h.empty() && h.front() == '[') h = h.substr(1);
    else if (!h.empty() && h.back() == ']') h.pop_back();
    return h == "127.0.0.1" || h == "localhost" || h == "::1";
}

}  // namespace tr::app
