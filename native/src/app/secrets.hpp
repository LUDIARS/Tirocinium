#pragma once
// packages/secrets (secret-agent クライアント + ローカル暗号化 config) と secrets/hydrate.ts の移植。
// 契約は変えない: 要求 POST {EXCUBITOR_URL}/api/v1/secrets/resolve {service, keys}、Bearer トークンは
// EXCUBITOR_AGENT_TOKEN か token ファイル。ローカル config は @ludiars/encrypted-config と同じ形式。
// 秘密の値はメモリ (Config) にだけ置き、ログにはキー名だけを出す。

#include <filesystem>
#include <functional>
#include <map>
#include <optional>
#include <stdexcept>
#include <string>
#include <vector>

#include "app/config.hpp"
#include "app/version.hpp"
#include "core/json.hpp"
#include "io/http_client.hpp"

namespace tr::app {

using Secrets = std::map<std::string, std::string>;
using HttpFetch = std::function<io::HttpClientResponse(const io::HttpClientRequest&)>;
using LogFn = std::function<void(const std::string&)>;

// ---- ローカル暗号化 config (tirocinium.config.json) ----

std::filesystem::path local_config_path(const EnvLookup& env);
// TIROCINIUM_MASTER_KEY → "tirocinium:<hostname>:<username>" (Node の os.hostname() / userInfo().username)。
std::string master_secret(const EnvLookup& env);

// encryptJson / decryptJson (形式 {v:1, salt, iv, tag, data}、すべて base64)。
Json encrypt_json_blob(const Json& value, const std::string& master_secret);
std::optional<Json> decrypt_json_blob(const Json& blob, const std::string& master_secret);

// readConfig: ファイルが無ければ nullopt。壊れた JSON は空扱い、復号できないキーは飛ばす (Node 版と同じ寛容さ)。
std::optional<Secrets> read_local_config(const EnvLookup& env);
// setConfig: LOCAL_SECRET_KEYS は暗号化、それ以外は平文。
void set_local_config(const std::string& key, const std::string& value, const EnvLookup& env);
const std::vector<std::string>& local_secret_keys();

// ---- secret-agent ----

class SecretAgentError : public std::runtime_error {
public:
    SecretAgentError(std::string code, const std::string& message)
        : std::runtime_error(message), code_(std::move(code)) {}
    // no_token / unauthorized / no_mapping / no_identity / fetch_failed / unreachable / bad_response
    [[nodiscard]] const std::string& code() const { return code_; }

private:
    std::string code_;
};

std::filesystem::path agent_token_path(const EnvLookup& env);
std::optional<std::string> resolve_agent_token(const EnvLookup& env);
std::string resolve_agent_base_url(const EnvLookup& env);
Secrets parse_resolve_response(const Json& body);
Secrets resolve_secrets(const std::string& service_code, const std::vector<std::string>& keys, const EnvLookup& env,
                        const HttpFetch& fetch);

// ---- hydrate ----

struct HydrateResult {
    std::string source;  // agent / local/env / env / default
    std::vector<std::string> applied;
};

// 優先順位: secret-agent → ローカル暗号化 config → env → 既定値。env は常に最後に上書きする。
// agent が「使えない」理由 (no_token/unreachable/no_mapping/no_identity/fetch_failed) は退避し、
// それ以外 (unauthorized/bad_response) は例外で起動を止める。DATABASE_URL (C++ 版だけが使う) は
// env → ローカル config の順に読む (secret-agent への要求キーは Node 版と同じに保つ)。
HydrateResult hydrate_secrets(Config& config, const EnvLookup& env, const HttpFetch& fetch, const LogFn& log);

}  // namespace tr::app
