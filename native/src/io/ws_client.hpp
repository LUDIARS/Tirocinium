#pragma once
// 外向きの WebSocket (ws / wss)。Cernere の project WS・composite 認証の中継先・Discord gateway に使う。
// - 期限: 接続 (名前解決〜TLS〜ハンドシェイク) は connect_timeout。以降は idle_timeout で無通信を検出。
// - 受信 1 メッセージの上限 max_message (超えたら 1009 で切れる)。
// - TLS は証明書とホスト名を検証する。public_only なら解決した IP を SSRF 判定してから接続する。
// - 送信・切断はどのスレッドからでもよい。コールバックは io_context のスレッドで呼ばれる。

#include <chrono>
#include <cstdint>
#include <functional>
#include <memory>
#include <string>
#include <utility>
#include <vector>

#include <boost/asio/io_context.hpp>

namespace tr::io {

struct WsClientOptions {
    std::chrono::milliseconds connect_timeout{10'000};
    std::chrono::seconds idle_timeout{300};
    std::size_t max_message = 4 * 1024 * 1024;
    bool public_only = false;
    std::vector<std::pair<std::string, std::string>> headers;
};

class WsClient {
public:
    using OnOpen = std::function<void(bool ok, const std::string& error)>;
    using OnMessage = std::function<void(std::string data, bool binary)>;
    using OnClose = std::function<void(int code, const std::string& reason)>;

    virtual ~WsClient() = default;
    virtual void send(std::string data, bool binary = false) = 0;
    virtual void close(std::uint16_t code, std::string reason) = 0;
    virtual void terminate() = 0;
    [[nodiscard]] virtual bool is_open() const = 0;
};

// 接続を始める。on_open は成功・失敗のどちらでも 1 回。on_close は開いた後に閉じたとき 1 回。
std::shared_ptr<WsClient> ws_connect(boost::asio::io_context& ioc, const std::string& url, WsClientOptions options,
                                     WsClient::OnOpen on_open, WsClient::OnMessage on_message, WsClient::OnClose on_close);

}  // namespace tr::io
