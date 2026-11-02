#pragma once
// WebSocket の受け口 (ws/handler.ts, ws/call-handler.ts, auth/cernere-composite-ws-relay.ts)。
// - /api/v1/ws/session/<uuid>  : Bearer か ?token= を CERNERE_PUBLIC_KEY で検証、所有者・active を検査。
// - /api/v1/ws/call/<uuid>     : 最初のフレームで 1 回限りの ticket (5 秒以内)、初期化 30 秒、128 KiB、
//                                未処理 16 件で切断、テキストのみ、1 セッション 1 接続、内容をログに出さない。
// - /api/auth/cernere/ws?ticket: Cernere の composite 認証 WS へ素通し (中身を読まない・残さない)。
// - それ以外の upgrade は 404 で断る (Node 版は応答せず放置していた)。

#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <string>

#include <boost/asio/io_context.hpp>
#include <boost/asio/thread_pool.hpp>

#include "app/brief.hpp"
#include "app/session_runtime.hpp"
#include "app/voice.hpp"
#include "io/http_server.hpp"
#include "io/ws_connection.hpp"

namespace tr::app {

class WsSink final : public FrameSink {
public:
    explicit WsSink(std::shared_ptr<io::WsConnection> conn) : conn_(std::move(conn)) {}
    void send(const std::string& json) override { conn_->send_text(json); }
    void close() override { conn_->close(1000, ""); }
    [[nodiscard]] bool is_open() const override { return conn_->is_open(); }

private:
    std::shared_ptr<io::WsConnection> conn_;
};

struct WsRouteDeps {
    Services* services = nullptr;
    const VoiceConfig* voice = nullptr;
    std::function<std::shared_ptr<InterviewerBrain>()> brain_factory;
    AiResearchFn research;
    boost::asio::io_context* ioc = nullptr;
    boost::asio::thread_pool* workers = nullptr;
};

class WsRoutes : public std::enable_shared_from_this<WsRoutes> {
public:
    explicit WsRoutes(WsRouteDeps deps) : deps_(std::move(deps)) {}
    void handle(const std::shared_ptr<io::PendingUpgrade>& up);

    // テスト用
    static std::optional<std::string> session_path_id(const std::string& target);
    static std::optional<std::string> call_path_id(const std::string& target);
    // nullopt = 対象外、"" = 形が違う ticket、それ以外 = ticket
    static std::optional<std::string> relay_ticket(const std::string& target);
    static std::optional<std::string> upstream_url(const std::string& cernere_url, const std::string& ticket);

private:
    void session_ws(const std::shared_ptr<io::PendingUpgrade>& up, std::string session_id);
    void call_ws(const std::shared_ptr<io::PendingUpgrade>& up, std::string session_id);
    void cernere_relay(const std::shared_ptr<io::PendingUpgrade>& up, std::string ticket);

    WsRouteDeps deps_;
    std::mutex owners_mu_;
    std::map<std::string, const void*> owners_;
};

}  // namespace tr::app
