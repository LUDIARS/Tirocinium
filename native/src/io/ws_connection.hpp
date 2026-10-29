#pragma once
// サーバ側の WebSocket 接続 (平文 TCP 上。外部公開は前段の TLS 終端か loopback を前提にする Node 版と同じ)。
// 送信・切断はどのスレッドから呼んでもよい (内部で接続の strand に載せる)。受信は 1 本ずつ順に
// on_message へ渡す。1 メッセージの上限は accept 時に決める (超えたら 1009 で切る)。

#include <cstdint>
#include <functional>
#include <memory>
#include <string>

namespace tr::io {

class WsConnection {
public:
    using MessageHandler = std::function<void(std::string data, bool binary)>;
    using CloseHandler = std::function<void()>;

    virtual ~WsConnection() = default;
    // 受信ループを始める。on_close は相手の切断・こちらの close・エラーのどれでも 1 回だけ呼ばれる。
    virtual void start(MessageHandler on_message, CloseHandler on_close) = 0;
    virtual void send_text(std::string data) = 0;
    virtual void close(std::uint16_t code, std::string reason) = 0;
    // 即座に切る (ws.terminate)。
    virtual void terminate() = 0;
    [[nodiscard]] virtual bool is_open() const = 0;
};

}  // namespace tr::io
