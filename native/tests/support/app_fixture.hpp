#pragma once
// 経路の結合テスト用: 一時 Postgres + 本物の Router + 偽の外向き HTTP + テスト用の Cernere 鍵。

#include <memory>
#include <mutex>
#include <vector>

#include "support/paseto_signer.hpp"
#include "support/pg_fixture.hpp"
#include "app/auth.hpp"
#include "app/pipeline.hpp"
#include "app/services.hpp"
#include "core/encoding.hpp"

namespace trtest {

struct AppFixture {
    std::unique_ptr<tr::io::PgPool> pool;
    tr::app::Config config;
    tr::app::CernereKeys keys;
    std::unique_ptr<tr::app::Authenticator> auth;
    tr::app::CallTickets tickets;
    tr::app::MaterialStore materials;
    std::unique_ptr<tr::FixedWindowLimiter> limiter;
    tr::app::BackgroundTasks background{1, 16};
    TestSigner signer;
    std::mutex fetch_mu;
    std::vector<tr::io::HttpClientRequest> outbound;
    std::function<tr::io::HttpClientResponse(const tr::io::HttpClientRequest&)> fake_http;
    std::unique_ptr<tr::app::Services> services;
    tr::http::Router router;
    std::vector<std::string> logs;

    AppFixture() {
        pool = fresh_database();
        keys.set_configured("k4.public." + tr::base64url_encode(signer.public_raw()));
        config.cernere_public_key = "k4.public." + tr::base64url_encode(signer.public_raw());
        auth = std::make_unique<tr::app::Authenticator>(config, keys);
        limiter = std::make_unique<tr::FixedWindowLimiter>(config.session_rate_limit.window_ms, config.session_rate_limit.max);
        services.reset(new tr::app::Services{config, *pool, *auth, std::filesystem::path(TR_SOURCE_DIR).parent_path(),
                                             [this](const tr::io::HttpClientRequest& r) { return fetch(r); },
                                             [] { return tr::now_ms(); },
                                             [this](const std::string& l) { logs.push_back(l); },
                                             tickets, materials, *limiter, background, nullptr, {}, 30});
    }

    tr::io::HttpClientResponse fetch(const tr::io::HttpClientRequest& r) {
        {
            std::lock_guard lock(fetch_mu);
            outbound.push_back(r);
        }
        if (fake_http) return fake_http(r);
        tr::io::HttpClientResponse res;
        res.status = 200;
        res.body = "{}";
        return res;
    }

    std::string token_for(const std::string& sub) {
        tr::Json p{{"sub", sub}, {"aud", "tirocinium"}, {"exp", tr::iso_from_ms(tr::now_ms() + 600000)}};
        return signer.sign(tr::js_stringify(p));
    }

    tr::http::Response call(const std::string& method, const std::string& target, const std::string& token = "",
                            const std::string& body = "") {
        tr::http::Request req;
        req.method = method;
        req.target = target;
        tr::http::split_target(target, req.path, req.raw_query);
        req.body = body;
        if (!token.empty()) req.headers.set("authorization", "Bearer " + token);
        return tr::app::handle_request(router, req, [this](const std::string& l) { logs.push_back(l); });
    }

    static tr::Json body_of(const tr::http::Response& r) {
        auto v = tr::parse_json(r.body);
        return v ? *v : tr::Json(nullptr);
    }
};

inline const std::string kUserA = "11111111-1111-4111-8111-111111111111";
inline const std::string kUserB = "22222222-2222-4222-8222-222222222222";

}  // namespace trtest
