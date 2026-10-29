// packages/secrets/src/client.test.ts の移植 + encrypted-config の互換 (Node で暗号化した値を C++ で読む) +
// hydrate の退避規則。HTTP は偽の fetch を注入する (secret-agent には接続しない)。
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <random>
#include <sstream>

#include "check.hpp"
#include "app/secrets.hpp"

using namespace tr;
using trtest::check;
using trtest::check_eq;

namespace {

app::EnvLookup env_of(std::map<std::string, std::string> m) {
    return [m](const std::string& k) -> std::optional<std::string> {
        auto it = m.find(k);
        if (it == m.end()) return std::nullopt;
        return it->second;
    };
}

std::string fixtures() {
    const char* d = std::getenv("TR_FIXTURES");
    return d ? d : "fixtures";
}

std::filesystem::path temp_file(const std::string& name) {
    static const auto tag = std::to_string(std::random_device{}());
    auto p = std::filesystem::temp_directory_path() / ("tr-secrets-test-" + tag + "-" + name);
    std::filesystem::remove(p);
    return p;
}

}  // namespace

TEST_CASE("parseResolveResponse: extracts string secrets, drops non-strings, throws on missing") {
    auto ok = app::parse_resolve_response(Json{{"secrets", {{"A", "1"}, {"B", "2"}}}});
    check(ok == app::Secrets{{"A", "1"}, {"B", "2"}}, "strings");
    auto mixed = app::parse_resolve_response(Json{{"secrets", {{"A", "1"}, {"N", 2}, {"X", nullptr}}}});
    check(mixed == app::Secrets{{"A", "1"}}, "non-strings dropped");
    trtest::check_throws([] { (void)app::parse_resolve_response(Json::object()); }, "missing secrets");
}

TEST_CASE("resolveSecrets: posts to the agent and returns secrets (memory-only)") {
    io::HttpClientRequest captured;
    auto fetch = [&](const io::HttpClientRequest& r) {
        captured = r;
        io::HttpClientResponse res;
        res.status = 200;
        res.body = R"({"secrets":{"NOTION_TOKEN":"secret_x"}})";
        return res;
    };
    auto out = app::resolve_secrets("tirocinium", {"NOTION_TOKEN"},
                                    env_of({{"EXCUBITOR_URL", "http://127.0.0.1:17332/"}, {"EXCUBITOR_AGENT_TOKEN", "tok"}}),
                                    fetch);
    check(out == app::Secrets{{"NOTION_TOKEN", "secret_x"}}, "result");
    check_eq(captured.url, std::string("http://127.0.0.1:17332/api/v1/secrets/resolve"), "url (trailing slash removed)");
    bool auth = false;
    for (auto& [k, v] : captured.headers) auth = auth || (k == "authorization" && v == "Bearer tok");
    check(auth, "bearer");
    check_eq(captured.body, std::string(R"({"service":"tirocinium","keys":["NOTION_TOKEN"]})"), "body");
}

TEST_CASE("resolveSecrets: error codes (no_token / unauthorized / unreachable)") {
    auto code = [](const app::EnvLookup& env, const app::HttpFetch& f) {
        try {
            app::resolve_secrets("tirocinium", {}, env, f);
        } catch (const app::SecretAgentError& e) {
            return e.code();
        }
        return std::string("none");
    };
    auto never = [](const io::HttpClientRequest&) -> io::HttpClientResponse { throw std::runtime_error("unused"); };
    check_eq(code(env_of({{"EXCUBITOR_AGENT_TOKEN_PATH", "/nonexistent/token"}}), never), std::string("no_token"), "no token");
    auto status401 = [](const io::HttpClientRequest&) {
        io::HttpClientResponse r;
        r.status = 401;
        r.body = "nope";
        return r;
    };
    check_eq(code(env_of({{"EXCUBITOR_AGENT_TOKEN", "t"}}), status401), std::string("unauthorized"), "401");
    auto refused = [](const io::HttpClientRequest&) -> io::HttpClientResponse { throw io::HttpClientError("connect", "x"); };
    check_eq(code(env_of({{"EXCUBITOR_AGENT_TOKEN", "t"}}), refused), std::string("unreachable"), "network");
}

TEST_CASE("encrypted-config: a file encrypted by the Node implementation decrypts to the same values") {
    std::ifstream in(fixtures() + "/encrypted_config_node.json");
    check(in.good(), "fixture present");
    std::stringstream ss;
    ss << in.rdbuf();
    const Json fx = *parse_json(ss.str());
    const auto path = temp_file("node.json");
    {
        std::ofstream out(path);
        out << js_stringify(fx["config"]);
    }
    auto env = env_of({{"TIROCINIUM_CONFIG_PATH", path.string()}, {"TIROCINIUM_MASTER_KEY", fx["master"].get<std::string>()}});
    auto got = app::read_local_config(env);
    check(got.has_value(), "read");
    for (auto it = fx["expected"].begin(); it != fx["expected"].end(); ++it) {
        check_eq((*got)[it.key()], it.value().get<std::string>(), "value of " + it.key());
    }
    // 鍵違いは復号できないキーを飛ばす (平文は残る)。
    auto wrong = app::read_local_config(env_of({{"TIROCINIUM_CONFIG_PATH", path.string()}, {"TIROCINIUM_MASTER_KEY", "wrong"}}));
    check(!wrong->count("ANTHROPIC_API_KEY") && wrong->count("TIROCINIUM_PORT"), "wrong key skips secrets");
    std::filesystem::remove(path);
}

TEST_CASE("encrypted-config: set/read roundtrip, secrets encrypted on disk, missing file is nullopt") {
    const auto path = temp_file("roundtrip.json");
    auto env = env_of({{"TIROCINIUM_CONFIG_PATH", path.string()}, {"TIROCINIUM_MASTER_KEY", "m"}});
    check(!app::read_local_config(env).has_value(), "missing file");
    app::set_local_config("OPENAI_API_KEY", "value-1", env);
    app::set_local_config("TIROCINIUM_PORT", "9000", env);
    std::ifstream in(path);
    std::stringstream ss;
    ss << in.rdbuf();
    check(ss.str().find("value-1") == std::string::npos, "secret not in plaintext");
    check(ss.str().find("9000") != std::string::npos, "plain stored as-is");
    auto got = *app::read_local_config(env);
    check_eq(got["OPENAI_API_KEY"], std::string("value-1"), "decrypt");
    check_eq(got["TIROCINIUM_PORT"], std::string("9000"), "plain");
    std::filesystem::remove(path);
}

TEST_CASE("encrypted-config: tampered ciphertext and corrupt files do not crash") {
    Json blob = app::encrypt_json_blob(Json("x"), "m");
    std::string data = blob["data"].get<std::string>();
    data[0] = data[0] == 'A' ? 'B' : 'A';
    blob["data"] = data;
    check(!app::decrypt_json_blob(blob, "m").has_value(), "auth tag rejects tampering");
    const auto path = temp_file("corrupt.json");
    {
        std::ofstream out(path);
        out << "{not json";
    }
    auto got = app::read_local_config(env_of({{"TIROCINIUM_CONFIG_PATH", path.string()}}));
    check(got.has_value() && got->empty(), "corrupt file = empty config");
    std::filesystem::remove(path);
}

TEST_CASE("hydrate: agent unusable → local/env, env always wins, unauthorized stops startup") {
    const auto path = temp_file("hydrate.json");
    auto base = std::map<std::string, std::string>{{"TIROCINIUM_CONFIG_PATH", path.string()},
                                                   {"TIROCINIUM_MASTER_KEY", "m"},
                                                   {"EXCUBITOR_AGENT_TOKEN_PATH", "/nonexistent"}};
    app::set_local_config("TIROCINIUM_PORT", "9100", env_of(base));
    app::set_local_config("DATABASE_URL", "postgres://local/db", env_of(base));
    auto env = base;
    env["SLOT_CAPACITY"] = "7";
    app::Config cfg;
    auto never = [](const io::HttpClientRequest&) -> io::HttpClientResponse { throw std::runtime_error("unused"); };
    auto r = app::hydrate_secrets(cfg, env_of(env), never, nullptr);
    check_eq(r.source, std::string("local/env"), "source");
    check_eq(cfg.port, 9100, "local value");
    check_eq(cfg.slot_capacity, 7, "env value");
    check_eq(cfg.database_url, std::string("postgres://local/db"), "DATABASE_URL from local config");
    auto env2 = base;
    env2["EXCUBITOR_AGENT_TOKEN"] = "t";
    auto unauthorized = [](const io::HttpClientRequest&) {
        io::HttpClientResponse res;
        res.status = 401;
        return res;
    };
    app::Config cfg2;
    trtest::check_throws([&] { app::hydrate_secrets(cfg2, env_of(env2), unauthorized, nullptr); }, "unauthorized");
    std::filesystem::remove(path);
}

TEST_MAIN()
