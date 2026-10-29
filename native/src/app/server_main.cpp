#include "app/server_main.hpp"

#include <iostream>
#include <thread>

#include <boost/asio/io_context.hpp>
#include <boost/asio/post.hpp>
#include <boost/asio/signal_set.hpp>
#include <boost/asio/thread_pool.hpp>

#include "app/config.hpp"
#include "app/pipeline.hpp"
#include "app/routes/health.hpp"
#include "app/version.hpp"
#include "io/http_server.hpp"

namespace tr::app {

int run_server(int, char**) {
    const EnvLookup env = process_env();
    Config config;
    std::map<std::string, std::string> secrets;
    for (const auto& key : secret_keys()) {
        if (auto v = env(key); v && !v->empty()) secrets[key] = *v;
    }
    apply_server_config(config, secrets);
    apply_discord_secrets(config.discord, secrets);

    http::Router router;
    register_health_routes(router, service_version(env), [] { return false; });

    boost::asio::io_context ioc;
    boost::asio::thread_pool workers(8);
    const ErrorLog log = [](const std::string& line) { std::cerr << line << '\n'; };

    io::HttpServerOptions options;
    options.body_limit_for = body_limit_for;
    io::HttpServer server(
        ioc, config.host, static_cast<std::uint16_t>(config.port), options,
        [&](http::Request req, io::Responder respond) {
            boost::asio::post(workers, [&, req = std::move(req), respond = std::move(respond)]() mutable {
                respond(handle_request(router, req, log));
            });
        },
        [](std::shared_ptr<io::PendingUpgrade> up) { up->reject(404); });
    server.start();
    std::cout << "tirocinium server listening on " << config.host << ":" << server.port() << std::endl;

    boost::asio::signal_set signals(ioc, SIGINT, SIGTERM);
    signals.async_wait([&](const boost::system::error_code&, int) {
        std::cout << "shutting down" << std::endl;
        server.stop();
        ioc.stop();
    });

    std::vector<std::thread> threads;
    for (int i = 0; i < 2; ++i) threads.emplace_back([&] { ioc.run(); });
    for (auto& t : threads) t.join();
    workers.join();
    return 0;
}

}  // namespace tr::app
