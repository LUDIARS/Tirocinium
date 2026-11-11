#include "app/server_main.hpp"

#include <iostream>
#include <mutex>
#include <thread>

#include <boost/asio/io_context.hpp>
#include <boost/asio/post.hpp>
#include <boost/asio/signal_set.hpp>
#include <boost/asio/steady_timer.hpp>
#include <boost/asio/thread_pool.hpp>

#include "app/auth.hpp"
#include "app/cernere.hpp"
#include "app/config.hpp"
#include "app/llm.hpp"
#include "app/paths.hpp"
#include "app/pipeline.hpp"
#include "app/reservation_tick.hpp"
#include "app/routes/alumni_routes.hpp"
#include "app/routes/health.hpp"
#include "app/routes/interview_routes.hpp"
#include "app/runtime_extensions.hpp"
#include "app/secrets.hpp"
#include "app/services.hpp"
#include "app/version.hpp"
#include "app/voice.hpp"
#include "app/ws_routes.hpp"
#include "io/http_server.hpp"
#include "io/pg_pool.hpp"
#include "io/process.hpp"

namespace tr::app {

namespace {

std::mutex g_log_mu;

void log_line(const std::string& line) {
    std::lock_guard lock(g_log_mu);
    std::cerr << line << std::endl;
}

}  // namespace

int run_server(int, char**) {
    const LogFn log = log_line;
    const EnvLookup env = process_env();
    const EnvList env_list = io::current_environment();
    const HttpFetch fetch = [](const io::HttpClientRequest& r) { return io::http_fetch(r); };

    // 起動順は Node 版と同じ: 秘密の読み込み → 認証設定の検査 → 公開鍵 → DB → HTTP/WS → 常駐処理。
    Config config;
    hydrate_secrets(config, env, fetch, log);
    const std::string blackbox = env("TIROCINIUM_JUDGE_BLACKBOX").value_or("0");
    if (blackbox != "0" && blackbox != "1") {
        throw std::runtime_error("TIROCINIUM_JUDGE_BLACKBOX が不正: \"" + blackbox + "\" (0 | 1 のみ)");
    }
    if (blackbox == "1") {
        throw std::runtime_error(
            "TIROCINIUM_JUDGE_BLACKBOX=1 (judge の卒業機構、SQLite の sidecar) は C++ 版では未対応です (native/PORTING.md)");
    }
    CernereKeys keys;
    if (!config.cernere_public_key.empty()) keys.set_configured(config.cernere_public_key);
    Authenticator auth(config, keys);
    auth.assert_safe_config();
    load_cernere_public_keys(config, fetch, keys, log);
    const VoiceConfig voice = load_voice_config(env_list);
    if (io::is_sqlite_url(config.database_url)) {
        throw std::runtime_error(
            "DATABASE_URL (postgres://) が必要です。C++ 版は SQLite (data/tirocinium.sqlite) を開けません "
            "(SQLite はこのリポで未許可。native/PORTING.md「人間の判断が要ること」)");
    }
    io::PgPool pool(config.database_url);

    int slot_env = 30;
    if (auto v = env("SLOT_DURATION_MIN")) {
        if (auto n = js_parse_int(*v); n && *n > 0) slot_env = static_cast<int>(*n);
    }
    BackgroundTasks background(4, 256);
    CallTickets tickets;
    MaterialStore materials;
    FixedWindowLimiter limiter(config.session_rate_limit.window_ms, config.session_rate_limit.max);
    LlmGateway gateway(config, env_list, fetch);
    Services services{config,     pool,      auth,       repo_root(env), fetch, [] { return now_ms(); }, log, tickets,
                      materials,  limiter,   background, &gateway,       env_list, slot_env};
    // TIROCINIUM_BRAIN / TIROCINIUM_INTERVIEWER_MODEL の不正は起動時に止める。
    (void)create_brain(gateway, env_list);
    auto brain_factory = [&gateway, &env_list]() -> std::shared_ptr<InterviewerBrain> { return create_brain(gateway, env_list); };

    boost::asio::io_context ioc;
    boost::asio::thread_pool workers(8);
    CernereProjectProxy proxy(config, fetch, ioc);
    RuntimeExtensions extensions(services, ioc, workers, voice, brain_factory);
    extensions.start();

    http::Router router;
    register_health_routes(router, service_version(env), [&pool] { return pool.ping(); });
    register_auth_routes(router, config, fetch, proxy);
    register_interview_routes(router, services);
    extensions.register_routes(router);
    register_alumni_routes(router, services);
    register_public_routes(router, services);

    auto ws = std::make_shared<WsRoutes>(
        WsRouteDeps{&services, &voice, brain_factory, extensions.research_fn(), &ioc, &workers});

    io::HttpServerOptions options;
    options.body_limit_for = body_limit_for;
    io::HttpServer server(
        ioc, config.host, static_cast<std::uint16_t>(config.port), options,
        [&](http::Request req, io::Responder respond) {
            boost::asio::post(workers, [&, req = std::move(req), respond = std::move(respond)]() mutable {
                respond(handle_request(router, req, log));
            });
        },
        [ws](std::shared_ptr<io::PendingUpgrade> up) { ws->handle(up); });
    server.start();
    log("tirocinium server listening on " + config.host + ":" + std::to_string(server.port()));

    // 予約の tick: 起動直後に 1 回、その後 60 秒ごと (重ならないように前回の終了を待つ)。
    boost::asio::steady_timer tick_timer(ioc);
    std::atomic<bool> ticking{false};
    std::function<void()> schedule_tick;
    auto run_tick = [&] {
        if (ticking.exchange(true)) return;
        boost::asio::post(workers, [&] {
            try {
                (void)tick_now(services, now_ms());
            } catch (const std::exception& e) {
                log(std::string("[reservation tick] error ") + e.what());
            }
            ticking = false;
        });
    };
    schedule_tick = [&] {
        tick_timer.expires_after(std::chrono::seconds(60));
        tick_timer.async_wait([&](const boost::system::error_code& ec) {
            if (ec) return;
            run_tick();
            schedule_tick();
        });
    };
    run_tick();
    schedule_tick();

    boost::asio::signal_set signals(ioc, SIGINT, SIGTERM);
    signals.async_wait([&](const boost::system::error_code&, int) {
        log("shutting down");
        extensions.stop();
        tick_timer.cancel();
        server.stop();
        ioc.stop();
    });

    std::vector<std::thread> threads;
    for (int i = 0; i < 2; ++i) threads.emplace_back([&] { ioc.run(); });
    for (auto& t : threads) t.join();
    workers.join();
    background.join();
    return 0;
}

}  // namespace tr::app
