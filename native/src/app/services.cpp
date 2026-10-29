#include "app/services.hpp"

#include <boost/asio/post.hpp>

#include "core/text.hpp"

namespace tr::app {

bool BackgroundTasks::submit(std::function<void()> fn) {
    if (pending_.fetch_add(1) >= max_pending_) {
        pending_.fetch_sub(1);
        return false;
    }
    boost::asio::post(pool_, [this, fn = std::move(fn)] {
        try {
            fn();
        } catch (...) {
        }
        pending_.fetch_sub(1);
    });
    return true;
}

std::optional<Json> read_json_body(const http::Request& req) {
    JsonLimits limits;
    limits.max_bytes = std::max<std::size_t>(req.body.size(), 1);
    limits.max_elements = 200'000;
    limits.max_depth = 64;
    return parse_json(req.body, limits);
}

const std::string& user_id(const http::Context& ctx) {
    static const std::string empty;
    return ctx.user_id ? *ctx.user_id : empty;
}

std::optional<long long> query_int(const http::Request& req, const std::string& key) {
    auto v = req.query(key);
    if (!v) return std::nullopt;
    return js_parse_int(*v);
}

http::Handler authed(const Services& s, http::Handler h) {
    return [&s, h = std::move(h)](http::Request& req, http::Context& ctx) -> http::Response {
        if (auto early = s.auth.require(req, ctx)) return std::move(*early);
        return h(req, ctx);
    };
}

std::optional<http::Response> check_session_rate(Services& s, const http::Context& ctx) {
    auto d = s.session_limiter.hit(user_id(ctx), s.now());
    if (d.allowed) return std::nullopt;
    auto r = http::Response::json(Json{{"error", "rate_limited"}, {"retry_after_sec", d.retry_after_sec}}, 429);
    r.headers.set("Retry-After", std::to_string(d.retry_after_sec));
    return r;
}

PushResult push_notification(const Services& s, const std::string& uid, const std::string& title, const std::string& body,
                             const Json& data) {
    if (s.config.nuntius_url.empty()) return {false, "nuntius_url_unset"};
    try {
        io::HttpClientRequest req;
        req.method = "POST";
        req.url = s.config.nuntius_url + "/api/notifications";
        req.headers = {{"content-type", "application/json"}};
        if (!s.config.nuntius_api_key.empty()) req.headers.emplace_back("authorization", "Bearer " + s.config.nuntius_api_key);
        Json payload{{"user_id", uid}, {"title", title}, {"body", body}};
        if (!data.is_null()) payload["data"] = data;
        req.body = js_stringify(payload);
        req.timeout = std::chrono::milliseconds(10'000);
        req.max_response_bytes = 64 * 1024;
        auto res = s.fetch(req);
        if (!res.ok()) return {false, "http_" + std::to_string(res.status)};
        return {true, ""};
    } catch (const std::exception& e) {
        return {false, e.what()};
    }
}

void push_notification_async(Services& s, std::string uid, std::string title, std::string body, Json data) {
    const bool queued = s.background.submit([&s, uid = std::move(uid), title = std::move(title), body = std::move(body),
                                             data = std::move(data)] { (void)push_notification(s, uid, title, body, data); });
    if (!queued && s.log) s.log("[nuntius] background queue full; notification dropped");
}

void ensure_user(db::Database& db, const std::string& uid) {
    db.query("INSERT INTO users (id) VALUES ($1) ON CONFLICT (id) DO NOTHING", {uid});
}

}  // namespace tr::app
