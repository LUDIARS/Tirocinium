#pragma once
// 常駐処理と、それに依存する経路をまとめて起動・停止する。
// - Node の企業 worker (クロール・enrich・求人ニュース・地図・関連探索。TIROCINIUM_COMPANIES_WORKER=0 で起動しない)
// - /api/v1/companies と /api/v1/recommend
// - Discord の Bot A (bot token があるときだけ)
// - ブリーフの企業 AI 調査 (worker があれば worker、無ければ「確認できない」)

#include <functional>
#include <memory>

#include <boost/asio/io_context.hpp>
#include <boost/asio/thread_pool.hpp>

#include "app/brief.hpp"
#include "app/companies_worker.hpp"
#include "app/discord_bridge.hpp"
#include "app/services.hpp"
#include "app/voice.hpp"

namespace tr::app {

class RuntimeExtensions {
public:
    RuntimeExtensions(Services& s, boost::asio::io_context& ioc, boost::asio::thread_pool& workers, const VoiceConfig& voice,
                      std::function<std::shared_ptr<InterviewerBrain>()> brain_factory);
    ~RuntimeExtensions();
    void start();
    void stop();
    void register_routes(http::Router& router);
    AiResearchFn research_fn();

private:
    Services& s_;
    boost::asio::io_context& ioc_;
    boost::asio::thread_pool& workers_;
    const VoiceConfig& voice_;
    std::function<std::shared_ptr<InterviewerBrain>()> brain_factory_;
    std::unique_ptr<CompaniesWorker> worker_;
    std::shared_ptr<DiscordBridge> discord_;
};

}  // namespace tr::app
