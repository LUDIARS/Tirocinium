#include "app/cernere.hpp"

#include <random>

#include "core/text.hpp"
#include "core/url.hpp"
#include "app/services.hpp"
#include "http/message.hpp"

namespace tr::app {

namespace {

std::string base_url(const Config& c) {
    if (c.cernere.url.empty()) throw CernereSessionError("CERNERE_URL is not configured", 503);
    return c.cernere.url;
}

std::string pathname_of(const std::string& url) {
    auto u = parse_url(url);
    if (!u) return url;
    const auto q = u->target.find('?');
    return u->target.substr(0, q);
}

Json post(const HttpFetch& fetch, const std::string& url, const Json& body, const std::string& bearer = {}) {
    io::HttpClientRequest req;
    req.method = "POST";
    req.url = url;
    req.headers = {{"content-type", "application/json"}};
    if (!bearer.empty()) req.headers.emplace_back("authorization", "Bearer " + bearer);
    req.body = js_stringify(body);
    req.timeout = std::chrono::milliseconds(15'000);
    req.max_response_bytes = 1024 * 1024;
    auto res = fetch(req);
    Json data = Json::object();
    if (auto parsed = parse_json(res.body); parsed) data = *parsed;
    // Cernere の応答は { data: {...} } で包まれる経路があるので両方を受ける
    Json payload = data.is_object() && data.contains("data") && data["data"].is_object() ? data["data"] : data;
    if (!res.ok()) {
        const std::string reason = payload.is_object() && payload.contains("error") && payload["error"].is_string()
                                       ? payload["error"].get<std::string>()
                                       : "HTTP " + std::to_string(res.status);
        throw CernereSessionError("Cernere " + pathname_of(url) + " failed: " + reason,
                                  res.status == 401 || res.status == 400 ? 401 : 502);
    }
    return payload.is_object() ? payload : Json::object();
}

std::string str(const Json& obj, const char* key, const char* what) {
    const Json* v = member(obj, key);
    if (!v || !v->is_string() || v->get<std::string>().empty()) {
        throw CernereSessionError(std::string("Cernere response has no ") + what, 502);
    }
    return v->get<std::string>();
}

struct ProjectToken {
    std::string token;
    Json expires_in;
    std::string user_id;
    std::string display_name;
};

ProjectToken project_token(const Config& c, const HttpFetch& fetch, const std::string& access_token) {
    Json r = post(fetch, base_url(c) + "/api/auth/project-token",
                  Json{{"project_key", "tirocinium"}, {"hub_url", c.cernere_audience}}, access_token);
    ProjectToken p;
    p.token = str(r, "accessToken", "project token");
    p.expires_in = r.contains("expiresIn") && r["expiresIn"].is_number() ? r["expiresIn"] : Json(900);
    p.user_id = str(r, "userId", "userId");
    p.display_name = string_or(r, "displayName");
    return p;
}

Json session_json(const ProjectToken& pt, const std::string& refresh) {
    return Json{{"token", pt.token},
                {"expiresIn", pt.expires_in},
                {"refreshToken", refresh},
                {"user", {{"id", pt.user_id}, {"displayName", pt.display_name}}}};
}

}  // namespace

Json exchange_auth_code(const Config& c, const HttpFetch& fetch, const std::string& auth_code) {
    Json ex = post(fetch, base_url(c) + "/api/auth/exchange", Json{{"code", auth_code}});
    const std::string access = str(ex, "accessToken", "accessToken");
    const std::string refresh = str(ex, "refreshToken", "refreshToken");
    return session_json(project_token(c, fetch, access), refresh);
}

Json refresh_session(const Config& c, const HttpFetch& fetch, const std::string& refresh_token) {
    Json r = post(fetch, base_url(c) + "/api/auth/refresh", Json{{"refreshToken", refresh_token}});
    const std::string access = str(r, "accessToken", "accessToken");
    // Cernere は refresh で refreshToken も回す。返ってこなければ元のものを使い続ける
    std::string next = string_or(r, "refreshToken");
    if (next.empty()) next = refresh_token;
    return session_json(project_token(c, fetch, access), next);
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
    if (c.url.empty() || c.project_client_id.empty() || c.project_client_secret.empty()) {
        throw CernereNotConfiguredError(
            "Cernere project credentials are not configured (CERNERE_URL / CERNERE_PROJECT_CLIENT_ID / "
            "CERNERE_PROJECT_CLIENT_SECRET)");
    }
    {
        std::lock_guard lock(mu_);
        if (ws_ && ws_->is_open()) return;
    }
    io::HttpClientRequest login;
    login.method = "POST";
    login.url = c.url + "/api/auth/login";
    login.headers = {{"content-type", "application/json"}};
    login.body = js_stringify(Json{{"grant_type", "project_credentials"},
                                   {"client_id", c.project_client_id},
                                   {"client_secret", c.project_client_secret}});
    login.timeout = std::chrono::milliseconds(10'000);
    auto res = fetch_(login);
    if (!res.ok()) throw std::runtime_error("Cernere project login failed: " + std::to_string(res.status));
    auto data = parse_json(res.body);
    const std::string token = data ? string_or(*data, "accessToken") : "";
    if (token.empty()) throw std::runtime_error("Cernere project login returned no token");
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

Json CernereProjectProxy::login(const std::string& email, const std::string& password) {
    return request("auth", "login", Json{{"email", email}, {"password", password}});
}

Json CernereProjectProxy::register_user(const std::string& name, const std::string& email, const std::string& password) {
    return request("auth", "register", Json{{"name", name}, {"email", email}, {"password", password}});
}

Json CernereProjectProxy::mfa_verify(const std::string& mfa_token, const std::string& method, const std::string& code) {
    return request("auth", "mfa-verify", Json{{"mfaToken", mfa_token}, {"method", method}, {"code", code}});
}

// ---- routes/auth.ts ----

namespace {

Json body_object(http::Request& req) {
    auto b = read_json_body(req);
    return b && b->is_object() ? *b : Json::object();
}

std::string text(const Json& body, const char* key) { return string_or(body, key); }

http::Response fail(const std::exception_ptr& ep) {
    try {
        std::rethrow_exception(ep);
    } catch (const CernereNotConfiguredError&) {
        return http::Response::json(Json{{"error", "login_not_configured"}}, 503);
    } catch (const CernereSessionError& e) {
        return http::Response::json(Json{{"error", e.what()}}, e.status());
    } catch (const std::exception& e) {
        // Cernere が返したエラー文 (認証失敗など) はそのまま利用者へ見せる
        const std::string msg = e.what();
        return http::Response::json(Json{{"error", msg.empty() ? std::string("login_failed") : msg}}, 400);
    } catch (...) {
        return http::Response::json(Json{{"error", "login_failed"}}, 400);
    }
}

}  // namespace

void register_auth_routes(http::Router& r, const Config& config, HttpFetch fetch, CompositeAuthProxy& proxy) {
    r.post("/api/auth/cernere/login", [&proxy](http::Request& req, http::Context&) {
        const Json b = body_object(req);
        if (text(b, "email").empty() || text(b, "password").empty()) {
            return http::Response::json(Json{{"error", "email と password が必要です"}}, 400);
        }
        try {
            return http::Response::json(proxy.login(text(b, "email"), text(b, "password")));
        } catch (...) {
            return fail(std::current_exception());
        }
    });
    r.post("/api/auth/cernere/register", [&proxy](http::Request& req, http::Context&) {
        const Json b = body_object(req);
        if (text(b, "name").empty() || text(b, "email").empty() || text(b, "password").empty()) {
            return http::Response::json(Json{{"error", "name と email と password が必要です"}}, 400);
        }
        try {
            return http::Response::json(proxy.register_user(text(b, "name"), text(b, "email"), text(b, "password")));
        } catch (...) {
            return fail(std::current_exception());
        }
    });
    r.post("/api/auth/cernere/mfa-verify", [&proxy](http::Request& req, http::Context&) {
        const Json b = body_object(req);
        if (text(b, "mfaToken").empty() || text(b, "method").empty() || text(b, "code").empty()) {
            return http::Response::json(Json{{"error", "mfaToken と method と code が必要です"}}, 400);
        }
        try {
            return http::Response::json(proxy.mfa_verify(text(b, "mfaToken"), text(b, "method"), text(b, "code")));
        } catch (...) {
            return fail(std::current_exception());
        }
    });
    r.post("/api/auth/exchange", [&config, fetch](http::Request& req, http::Context&) {
        const std::string code = text(body_object(req), "authCode");
        if (code.empty()) return http::Response::json(Json{{"error", "authCode が必要です"}}, 400);
        try {
            return http::Response::json(exchange_auth_code(config, fetch, code));
        } catch (...) {
            return fail(std::current_exception());
        }
    });
    r.post("/api/auth/refresh", [&config, fetch](http::Request& req, http::Context&) {
        const std::string token = text(body_object(req), "refreshToken");
        if (token.empty()) return http::Response::json(Json{{"error", "refreshToken が必要です"}}, 400);
        try {
            return http::Response::json(refresh_session(config, fetch, token));
        } catch (...) {
            return fail(std::current_exception());
        }
    });
}

}  // namespace tr::app
