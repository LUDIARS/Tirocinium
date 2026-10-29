#include "app/secrets.hpp"

#include <algorithm>
#include <fstream>
#include <set>
#include <sstream>

#ifdef _WIN32
#include <windows.h>
#else
#include <pwd.h>
#include <unistd.h>
#endif

#include "core/encoding.hpp"
#include "core/text.hpp"
#include "crypto/crypto.hpp"

namespace tr::app {
namespace {

std::string os_hostname() {
#ifdef _WIN32
    wchar_t buf[256];
    DWORD len = 256;
    if (!GetComputerNameExW(ComputerNameDnsHostname, buf, &len)) return "localhost";
    const int n = WideCharToMultiByte(CP_UTF8, 0, buf, static_cast<int>(len), nullptr, 0, nullptr, nullptr);
    std::string out(static_cast<std::size_t>(n), '\0');
    WideCharToMultiByte(CP_UTF8, 0, buf, static_cast<int>(len), out.data(), n, nullptr, nullptr);
    return out;
#else
    char buf[256] = {};
    if (gethostname(buf, sizeof buf - 1) != 0) return "localhost";
    return buf;
#endif
}

std::string os_username() {
#ifdef _WIN32
    wchar_t buf[257];
    DWORD len = 257;
    if (!GetUserNameW(buf, &len) || len == 0) return "";
    const int wlen = static_cast<int>(len) - 1;  // 終端の NUL を含む
    const int n = WideCharToMultiByte(CP_UTF8, 0, buf, wlen, nullptr, 0, nullptr, nullptr);
    std::string out(static_cast<std::size_t>(n), '\0');
    WideCharToMultiByte(CP_UTF8, 0, buf, wlen, out.data(), n, nullptr, nullptr);
    return out;
#else
    struct passwd pw {};
    struct passwd* result = nullptr;
    std::vector<char> buf(16384);
    if (getpwuid_r(geteuid(), &pw, buf.data(), buf.size(), &result) != 0 || !result) return "";
    return pw.pw_name;
#endif
}

std::optional<std::string> read_file(const std::filesystem::path& p, std::size_t max_bytes) {
    std::error_code ec;
    if (!std::filesystem::is_regular_file(p, ec)) return std::nullopt;
    const auto size = std::filesystem::file_size(p, ec);
    if (ec || size > max_bytes) return std::nullopt;
    std::ifstream in(p, std::ios::binary);
    std::stringstream ss;
    ss << in.rdbuf();
    return ss.str();
}

constexpr std::size_t kMaxConfigBytes = 1024 * 1024;

Json read_config_file(const std::filesystem::path& path) {
    Json cfg = {{"plain", Json::object()}, {"secrets", Json::object()}};
    auto text = read_file(path, kMaxConfigBytes);
    if (!text) return cfg;
    auto parsed = parse_json(*text);
    if (!parsed || !parsed->is_object()) return cfg;
    if (const Json* p = member(*parsed, "plain"); p && p->is_object()) cfg["plain"] = *p;
    if (const Json* s = member(*parsed, "secrets"); s && s->is_object()) cfg["secrets"] = *s;
    return cfg;
}

bool is_encrypted_blob(const Json& x) {
    return x.is_object() && x.contains("v") && x["v"] == 1 && x.contains("salt") && x["salt"].is_string() &&
           x.contains("data") && x["data"].is_string();
}

}  // namespace

std::filesystem::path local_config_path(const EnvLookup& env) {
    if (auto v = env("TIROCINIUM_CONFIG_PATH"); v && !v->empty()) return std::filesystem::path(*v);
    return std::filesystem::current_path() / "tirocinium.config.json";
}

std::string master_secret(const EnvLookup& env) {
    if (auto v = env("TIROCINIUM_MASTER_KEY"); v && !v->empty()) return *v;
    return "tirocinium:" + os_hostname() + ":" + os_username();
}

Json encrypt_json_blob(const Json& value, const std::string& secret) {
    const std::string salt = crypto::random_bytes(16);
    const std::string iv = crypto::random_bytes(12);
    auto key = crypto::scrypt_key(secret, salt);
    if (!key) throw std::runtime_error("scrypt failed");
    auto enc = crypto::aes256gcm_encrypt(*key, iv, js_stringify(value));
    if (!enc) throw std::runtime_error("encrypt failed");
    return Json{{"v", 1},
                {"salt", base64_encode(salt)},
                {"iv", base64_encode(iv)},
                {"tag", base64_encode(enc->tag)},
                {"data", base64_encode(enc->ciphertext)}};
}

std::optional<Json> decrypt_json_blob(const Json& blob, const std::string& secret) {
    if (!is_encrypted_blob(blob)) return std::nullopt;
    const std::string salt = base64_decode_lenient(blob["salt"].get<std::string>());
    const std::string iv = base64_decode_lenient(string_or(blob, "iv"));
    const std::string tag = base64_decode_lenient(string_or(blob, "tag"));
    const std::string data = base64_decode_lenient(blob["data"].get<std::string>());
    auto key = crypto::scrypt_key(secret, salt);
    if (!key) return std::nullopt;
    auto plain = crypto::aes256gcm_decrypt(*key, iv, data, tag);
    if (!plain) return std::nullopt;
    return parse_json(*plain);
}

const std::vector<std::string>& local_secret_keys() {
    static const std::vector<std::string> keys = {"ANTHROPIC_API_KEY",  "OPENAI_API_KEY",      "TIROCINIUM_DISCORD_BOT_TOKEN",
                                                  "NUNTIUS_API_KEY",    "CERNERE_PUBLIC_KEY",  "GOOGLE_MAPS_API_KEY",
                                                  "GBIZINFO_TOKEN"};
    return keys;
}

std::optional<Secrets> read_local_config(const EnvLookup& env) {
    const auto path = local_config_path(env);
    std::error_code ec;
    if (!std::filesystem::exists(path, ec)) return std::nullopt;
    const Json cfg = read_config_file(path);
    const std::string ms = master_secret(env);
    Secrets out;
    for (auto it = cfg["plain"].begin(); it != cfg["plain"].end(); ++it) {
        if (it.value().is_string()) out[it.key()] = it.value().get<std::string>();
    }
    for (auto it = cfg["secrets"].begin(); it != cfg["secrets"].end(); ++it) {
        auto v = decrypt_json_blob(it.value(), ms);
        if (v && v->is_string()) out[it.key()] = v->get<std::string>();  // 復号できないキーは無視 (鍵の変更・改竄)
    }
    return out;
}

void set_local_config(const std::string& key, const std::string& value, const EnvLookup& env) {
    const auto path = local_config_path(env);
    Json cfg = read_config_file(path);
    const auto& secret_keys = local_secret_keys();
    if (std::find(secret_keys.begin(), secret_keys.end(), key) != secret_keys.end()) {
        cfg["secrets"][key] = encrypt_json_blob(Json(value), master_secret(env));
        cfg["plain"].erase(key);
    } else {
        cfg["plain"][key] = value;
        cfg["secrets"].erase(key);
    }
    std::filesystem::create_directories(path.parent_path().empty() ? std::filesystem::path(".") : path.parent_path());
    std::ofstream out(path, std::ios::binary | std::ios::trunc);
    out << cfg.dump(2, ' ', false, Json::error_handler_t::replace) << "\n";
}

std::filesystem::path agent_token_path(const EnvLookup& env) {
    if (auto v = env("EXCUBITOR_AGENT_TOKEN_PATH"); v && !v->empty()) return std::filesystem::path(*v);
    std::filesystem::path base;
    if (auto a = env("APPDATA")) base = *a;
    else if (auto x = env("XDG_CONFIG_HOME")) base = *x;
    else base = std::filesystem::path(env("HOME").value_or(env("USERPROFILE").value_or("."))) / ".config";
    return base / "Excubitor" / "secret-agent.token";
}

std::optional<std::string> resolve_agent_token(const EnvLookup& env) {
    if (auto v = env("EXCUBITOR_AGENT_TOKEN"); v && !v->empty()) return v;
    auto text = read_file(agent_token_path(env), 64 * 1024);
    if (!text) return std::nullopt;
    std::string t = js_trim(*text);
    if (t.empty()) return std::nullopt;
    return t;
}

std::string resolve_agent_base_url(const EnvLookup& env) {
    std::string url = env("EXCUBITOR_URL").value_or("http://127.0.0.1:17332");
    if (!url.empty() && url.back() == '/') url.pop_back();
    return url;
}

Secrets parse_resolve_response(const Json& body) {
    const Json* secrets = member(body, "secrets");
    if (!secrets || !secrets->is_object()) throw SecretAgentError("bad_response", "agent response missing secrets object");
    Secrets out;
    for (auto it = secrets->begin(); it != secrets->end(); ++it) {
        if (it.value().is_string()) out[it.key()] = it.value().get<std::string>();
    }
    return out;
}

Secrets resolve_secrets(const std::string& service_code, const std::vector<std::string>& keys, const EnvLookup& env,
                        const HttpFetch& fetch) {
    const std::string base_url = resolve_agent_base_url(env);
    auto token = resolve_agent_token(env);
    if (!token) {
        throw SecretAgentError("no_token",
                               "agent token not found (set EXCUBITOR_AGENT_TOKEN or ensure secret-agent.token exists)");
    }
    io::HttpClientRequest req;
    req.method = "POST";
    req.url = base_url + "/api/v1/secrets/resolve";
    req.headers = {{"content-type", "application/json"}, {"authorization", "Bearer " + *token}};
    req.body = js_stringify(Json{{"service", service_code}, {"keys", keys}});
    req.timeout = std::chrono::milliseconds(10'000);
    req.max_response_bytes = 1024 * 1024;
    io::HttpClientResponse res;
    try {
        res = fetch(req);
    } catch (const std::exception& e) {
        throw SecretAgentError("unreachable", "secret-agent unreachable at " + base_url + ": " + e.what());
    }
    if (!res.ok()) {
        std::string code = "fetch_failed";
        if (res.status == 401) code = "unauthorized";
        else if (res.status == 404) code = "no_mapping";
        else if (res.status == 503) code = "no_identity";
        // agent の応答本文は秘密を含みうるので先頭 200 文字に留める (Node 版と同じ)。
        throw SecretAgentError(code, "agent " + std::to_string(res.status) + ": " + utf16_slice(res.body, 0, 200));
    }
    auto body = parse_json(res.body);
    if (!body) throw SecretAgentError("bad_response", "agent response is not JSON");
    return parse_resolve_response(*body);
}

HydrateResult hydrate_secrets(Config& config, const EnvLookup& env, const HttpFetch& fetch, const LogFn& log) {
    const std::string service = env("TIROCINIUM_SERVICE_CODE").value_or("tirocinium");
    auto env_secrets = [&] {
        Secrets out;
        for (const auto& key : secret_keys()) {
            if (auto v = env(key); v && !v->empty()) out[key] = *v;
        }
        return out;
    };
    static const std::set<std::string> fallback = {"no_token", "unreachable", "no_mapping", "no_identity", "fetch_failed"};
    Secrets secrets;
    std::string source;
    std::optional<Secrets> local;
    try {
        secrets = resolve_secrets(service, secret_keys(), env, fetch);
        source = "agent";
    } catch (const SecretAgentError& e) {
        if (!fallback.count(e.code())) throw;
        if (e.code() != "no_token") {
            if (log) {
                log(std::string("[secrets] secret-agent から取得できません (") + e.code() + "): " + e.what());
                log("  ローカル config / env にフォールバックします。");
            }
        }
        local = read_local_config(env);
        if (!local) {
            secrets = env_secrets();
            source = secrets.empty() ? "default" : "env";
            if (source == "default" && log) {
                log("[secrets] ローカル config が見つかりません。デフォルト設定で起動します。");
                log("  LLM キーを設定するには: npm run config-setup  (保存先: " + local_config_path(env).string() + ")");
            }
        } else {
            secrets = *local;
            for (auto& [k, v] : env_secrets()) secrets[k] = v;
            source = "local/env";
        }
    }
    for (auto& [k, v] : env_secrets()) secrets[k] = v;
    HydrateResult result;
    result.source = source;
    auto a1 = apply_server_config(config, secrets);
    auto a2 = apply_discord_secrets(config.discord, secrets);
    result.applied = a1;
    result.applied.insert(result.applied.end(), a2.begin(), a2.end());
    // C++ 版だけが使う DATABASE_URL (Node 版の常駐サーバは常に SQLite を開いていた)。
    if (auto v = env("DATABASE_URL"); v && !v->empty()) {
        config.database_url = *v;
    } else {
        if (!local) local = read_local_config(env);
        if (local) {
            if (auto it = local->find("DATABASE_URL"); it != local->end()) config.database_url = it->second;
        }
    }
    if (log) {
        log("[secrets] hydrated from " + source + ": " + std::to_string(result.applied.size()) + " key(s) [" +
            join(result.applied, ", ") + "]");
    }
    return result;
}

}  // namespace tr::app
