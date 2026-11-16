#include "app/cernere.hpp"

#include <random>

#include "core/text.hpp"
#include "app/services.hpp"
#include "http/message.hpp"

namespace tr::app {

std::string fetch_project_credential_token(const Config& config, const HttpFetch& fetch) {
    const auto& c = config.cernere;
    if (c.url.empty() || c.project_client_id.empty() || c.project_client_secret.empty()) {
        throw CernereNotConfiguredError(
            "Cernere project credentials are not configured (CERNERE_URL / CERNERE_PROJECT_CLIENT_ID / "
            "CERNERE_PROJECT_CLIENT_SECRET)");
    }
    io::HttpClientRequest login;
    login.method = "POST";
    login.url = c.url + "/api/auth/login";
    login.headers = {{"content-type", "application/json"}};
    login.body = js_stringify(Json{{"grant_type", "project_credentials"},
                                   {"client_id", c.project_client_id},
                                   {"client_secret", c.project_client_secret}});
    login.timeout = std::chrono::milliseconds(10'000);
    login.max_response_bytes = 64 * 1024;
    auto res = fetch(login);
    if (!res.ok()) {
        throw CernereSessionError("Cernere project login failed: HTTP " + std::to_string(res.status), 502);
    }
    auto data = parse_json(res.body, JsonLimits{64 * 1024, 64, 8});
    const std::string token = data ? string_or(*data, "accessToken") : "";
    if (token.empty()) throw CernereSessionError("Cernere project login returned no token", 502);
    return token;
}

void load_cernere_public_keys(const Config& c, const HttpFetch& fetch, CernereKeys& keys, const LogFn& log) {
    if (!c.cernere_public_key.empty() || c.cernere.url.empty()) return;
    try {
        io::HttpClientRequest req;
        req.url = c.cernere.url + "/.well-known/cernere-public-key";
        req.timeout = std::chrono::milliseconds(10'000);
        req.max_response_bytes = 256 * 1024;
        auto res = fetch(req);
        if (!res.ok()) throw std::runtime_error("HTTP " + std::to_string(res.status));
        auto body = parse_json(res.body);
        if (!body) throw std::runtime_error("invalid JSON");
        auto set = parse_public_key_set(*body);
        const auto n = set.size();
        keys.set_fetched(std::move(set));
        if (log) log("[auth] Cernere public keys loaded: " + std::to_string(n));
    } catch (const std::exception& e) {
        if (log) log(std::string("[auth] Cernere public key fetch failed (auth stays disabled) ") + e.what());
    }
}

// ---- project WS proxy ----

CernereProjectProxy::CernereProjectProxy(const Config& config, HttpFetch fetch, boost::asio::io_context& ioc)
    : config_(config), fetch_(std::move(fetch)), ioc_(ioc) {}

void CernereProjectProxy::ensure_connected() {
    const auto& c = config_.cernere;
    {
        std::lock_guard lock(mu_);
        if (ws_ && ws_->is_open()) return;
    }
    const std::string token = fetch_project_credential_token(config_, fetch_);
    std::string ws_url = c.url;
    if (starts_with(ws_url, "http")) ws_url = "ws" + ws_url.substr(4);
    ws_url += "/ws/project?token=" + http::encode_uri_component(token);

    auto state = std::make_shared<std::pair<bool, std::string>>(false, "");
    auto done = std::make_shared<bool>(false);
    io::WsClientOptions opts;
    opts.connect_timeout = std::chrono::milliseconds(10'000);
    auto self = this;
    auto client = io::ws_connect(
        ioc_, ws_url, opts,
        [self, state, done](bool ok, const std::string& err) {
            std::lock_guard l(self->mu_);
            state->first = ok;
            state->second = err;
            *done = true;
            self->cv_.notify_all();
        },
        [self](std::string data, bool) { self->on_message(data); },
        [self](int code, const std::string&) {
            std::lock_guard l(self->mu_);
            for (auto& [id, p] : self->pending_) {
                p->done = true;
                p->ok = false;
                p->error = "Cernere project WS closed";
            }
            self->pending_.clear();
            (void)code;
            self->cv_.notify_all();
        });
    std::unique_lock lock(mu_);
    cv_.wait_for(lock, std::chrono::seconds(11), [&] { return *done; });
    if (!*done || !state->first) {
        if (client) client->terminate();
        throw std::runtime_error("Cernere project WS connect failed");
    }
    ws_ = client;
}

void CernereProjectProxy::on_message(const std::string& raw) {
    auto msg = parse_json(raw);
    if (!msg || !msg->is_object()) return;
    const std::string id = string_or(*msg, "request_id");
    if (id.empty()) return;
    std::lock_guard lock(mu_);
    auto it = pending_.find(id);
    if (it == pending_.end()) return;
    auto p = it->second;
    pending_.erase(it);
    p->done = true;
    if (string_or(*msg, "type") == "module_response") {
        p->ok = true;
        p->payload = msg->contains("payload") ? (*msg)["payload"] : Json(nullptr);
    } else {
        p->ok = false;
        const std::string m = string_or(*msg, "message");
        p->error = !m.empty() ? m : "Cernere error: " + (msg->contains("code") && (*msg)["code"].is_string() ? (*msg)["code"].get<std::string>() : std::string("unknown"));
    }
    cv_.notify_all();
}

Json CernereProjectProxy::request(const std::string& module, const std::string& action, const Json& payload) {
    ensure_connected();
    static thread_local std::mt19937_64 rng{std::random_device{}()};
    std::string suffix;
    static constexpr char b36[] = "0123456789abcdefghijklmnopqrstuvwxyz";
    for (int i = 0; i < 6; ++i) suffix.push_back(b36[rng() % 36]);
    const std::string request_id = "tr_" + std::to_string(now_ms()) + "_" + suffix;
    auto p = std::make_shared<Pending>();
    std::shared_ptr<io::WsClient> ws;
    {
        std::lock_guard lock(mu_);
        if (!ws_ || !ws_->is_open()) throw std::runtime_error("Cernere project WS is not connected");
        pending_[request_id] = p;
        ws = ws_;
    }
    ws->send(js_stringify(Json{{"type", "module_request"},
                               {"request_id", request_id},
                               {"module", module},
                               {"action", action},
                               {"payload", payload}}));
    std::unique_lock lock(mu_);
    if (!cv_.wait_for(lock, std::chrono::seconds(10), [&] { return p->done; })) {
        pending_.erase(request_id);
        throw std::runtime_error("Cernere request timeout: " + module + "." + action);
    }
    if (!p->ok) throw std::runtime_error(p->error);
    return p->payload;
}

Json CernereProjectProxy::passkey_login_begin(const Json& payload) {
    return request("auth", "passkey-login-begin", payload);
}

Json CernereProjectProxy::passkey_login_finish(const Json& payload) {
    return request("auth", "passkey-login-finish", payload);
}

}  // namespace tr::app
