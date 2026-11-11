#include "app/runtime_extensions.hpp"

#include "app/recommend.hpp"
#include "app/routes/companies_routes.hpp"
#include "core/time.hpp"

namespace tr::app {

RuntimeExtensions::RuntimeExtensions(Services& s, boost::asio::io_context& ioc, boost::asio::thread_pool& workers,
                                     const VoiceConfig& voice, std::function<std::shared_ptr<InterviewerBrain>()> brain_factory)
    : s_(s), ioc_(ioc), workers_(workers), voice_(voice), brain_factory_(std::move(brain_factory)) {
    std::string enabled = "1";
    for (const auto& [k, v] : s_.env) {
        if (k == "TIROCINIUM_COMPANIES_WORKER") enabled = v;
    }
    if (enabled != "0") {
        worker_ = std::make_unique<CompaniesWorker>(CompaniesWorker::default_options(s_.root, s_.env, s_.config.database_url),
                                                    s_.log);
    }
}

RuntimeExtensions::~RuntimeExtensions() { stop(); }

void RuntimeExtensions::start() {
    if (worker_) worker_->start();
    DiscordBridgeDeps d;
    d.services = &s_;
    d.ioc = &ioc_;
    d.workers = &workers_;
    d.brain_factory = brain_factory_;
    d.research = research_fn();
    d.voice = &voice_;
    discord_ = std::make_shared<DiscordBridge>(std::move(d));
    discord_->start();
}

void RuntimeExtensions::stop() {
    if (discord_) discord_->stop();
    if (worker_) worker_->stop();
}

void RuntimeExtensions::register_routes(http::Router& router) {
    register_companies_routes(router, s_, worker_.get());
    register_recommend_routes(router, s_);
}

AiResearchFn RuntimeExtensions::research_fn() {
    CompaniesWorker* worker = worker_.get();
    auto now = s_.now;
    return [worker, now](const std::string& company_url, const std::vector<std::string>& profile_urls) -> Json {
        if (!worker) return unavailable_ai_research(iso_from_ms(now()));
        Json urls = Json::array();
        for (const auto& u : profile_urls) urls.push_back(u);
        // 失敗は例外のまま返す (brief 側が research_unavailable として記録する)。
        return worker->call("ai-research", Json{{"companyUrl", company_url}, {"profileUrls", urls}},
                            companies_op_timeout("ai-research"));
    };
}

}  // namespace tr::app
