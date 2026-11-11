#pragma once
// Boost.Beast の HTTP/1.1 受け口。要求を tr::http::Request に組み立てて上位へ渡し、上位が
// (別スレッドで) 返した Response を書き戻す。WebSocket の upgrade は PendingUpgrade で上位に渡す。
//
// 外部入力の上限: ヘッダ 16 KiB (Node の既定と同じ)、本文は経路ごとの上限 (超えたら body_too_large を
// 立てて上位へ渡し、応答後に接続を閉じる)、同時接続数の上限 (超えたら即切断)。期限: 最初の要求の
// ヘッダ 60 秒、要求全体 300 秒、keep-alive の待ち 5 秒 (Node の headersTimeout / requestTimeout /
// keepAliveTimeout と同じ)。

#include <atomic>
#include <chrono>
#include <cstdint>
#include <functional>
#include <memory>
#include <string>

#include <boost/asio/io_context.hpp>
#include <boost/asio/ip/tcp.hpp>

#include "http/message.hpp"

namespace tr::io {

class WsConnection;

struct WsAcceptOptions {
    std::size_t max_message_bytes = 1024 * 1024;
    std::chrono::seconds idle_timeout{300};
};

// upgrade 要求を保持する。上位は accept か reject のどちらかを必ず呼ぶ (呼ばずに捨てると切断)。
class PendingUpgrade {
public:
    virtual ~PendingUpgrade() = default;
    [[nodiscard]] virtual const http::Request& request() const = 0;
    // "HTTP/1.1 <status> <reason>\r\n\r\n" を書いて切る (Node の socket.write + destroy と同じ)。
    virtual void reject(int status) = 0;
    // WebSocket として受け入れる。on_open は接続できたら呼ばれる。
    virtual void accept(WsAcceptOptions options, std::function<void(std::shared_ptr<WsConnection>)> on_open) = 0;
};

struct HttpServerOptions {
    std::size_t header_limit = 16 * 1024;
    // 経路ごとの本文上限。
    std::function<std::size_t(const http::Request&)> body_limit_for;
    std::size_t default_body_limit = 2 * 1024 * 1024;
    std::chrono::seconds header_timeout{60};
    std::chrono::seconds request_timeout{300};
    std::chrono::seconds keep_alive_timeout{5};
    std::size_t max_connections = 512;
};

using Responder = std::function<void(http::Response)>;
// 要求の処理。responder は任意のスレッドから 1 回だけ呼んでよい。
// Request::body_too_large が立っていれば本文は途中まで (上位が 413 を返す)。
using RequestHandler = std::function<void(http::Request, Responder)>;
using UpgradeHandler = std::function<void(std::shared_ptr<PendingUpgrade>)>;

class HttpServer {
public:
    HttpServer(boost::asio::io_context& ioc, std::string host, std::uint16_t port, HttpServerOptions options,
               RequestHandler on_request, UpgradeHandler on_upgrade);
    ~HttpServer();
    HttpServer(const HttpServer&) = delete;
    HttpServer& operator=(const HttpServer&) = delete;

    // bind + listen。失敗したら例外。
    void start();
    void stop();
    [[nodiscard]] std::uint16_t port() const;

    struct Impl;  // 実装の内部 (公開しているのは翻訳単位内の型から参照するため)

private:
    std::shared_ptr<Impl> impl_;
};

}  // namespace tr::io
