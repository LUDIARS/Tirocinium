#pragma once
// Discord の Bot A (discord/bridge.ts, discord/commands.ts, es-review/discord-relay.ts)。
// - gateway (wss://gateway.discord.gg) に接続し、heartbeat・identify・resume・再接続 (5 秒後) を行う。
//   認証・特権 intent の失敗 (4004, 4010-4014) は設定の問題なので再接続しない。
// - REST は外向き HTTP (SSRF 判定つき、15 秒、1 MiB) で送る。宛先のチャンネル ID は数字だけを許す。
// - テキスト面接: `!tr text [target]` で開始、`!tr end` で終了、それ以外の投稿は回答として渡す。
// - ES 相談の仲介 (`!tr es ...`): DM だけ・本文はログにも DB にも残さない・失敗時は固定文だけ返す。
// - 音声面接 (`!tr voice`) は C++ 版では未対応 (Discord の音声 = UDP + 暗号 + Opus。PORTING.md「人間の判断」)。
//   その場合はテキスト面接として始め、その旨を伝える。
// - gateway の受信は 1 メッセージ 4 MiB まで、圧縮は要求しない (伸長器を持たない)。
// - 投稿の処理は専用の 2 スレッドで行い、溜まりすぎたら (64 件) 捨ててログに残す。

#include <atomic>
#include <chrono>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <string>

#include <boost/asio/io_context.hpp>
#include <boost/asio/steady_timer.hpp>
#include <boost/asio/strand.hpp>
#include <boost/asio/thread_pool.hpp>

#include "app/alumni_repo.hpp"
#include "app/brief.hpp"
#include "app/services.hpp"
#include "app/session_runtime.hpp"
#include "app/voice.hpp"
#include "io/ws_client.hpp"

namespace tr::app {

// ---- ES 相談の仲介 (es-review/discord-relay.ts) ----
struct ReviewRouting {
    std::function<std::optional<ReviewRoute>(const std::string& token, const std::string& channel_id)> consume_pairing;
    std::function<std::optional<ReviewRoute>(const std::string& alias, const std::string& channel_id)> relay_destination;
    std::function<bool(const std::string& message_id, const std::string& request_id)> claim_delivery;
    std::function<void(const std::string& message_id, const std::string& state)> finish_delivery;
};
ReviewRouting db_review_routing(db::Database& db, std::function<EpochMs()> now);
// 送信 (失敗は例外)。
using DiscordSend = std::function<void(const std::string& channel_id, const std::string& content)>;
// 仲介の対象 (`<prefix> es` で始まる) なら処理して true。
bool handle_review_message(const Json& message, const std::string& prefix, const DiscordSend& send, const ReviewRouting& routing);
// 本文に連絡先・URL・メンションらしきものがあるか (正規表現を使わない線形の走査)。
bool review_body_has_contact(const std::string& body);

// RuntimeDiscordSocket: 応答をためて response_end でチャンネルへ送る擬似ソケット (送信は pool 上で順序を保つ)。
std::shared_ptr<FrameSink> make_discord_sink(std::string channel_id,
                                             std::function<void(const std::string&, const std::string&)> post,
                                             boost::asio::thread_pool& pool);

// Discord の snowflake (数字 1〜25 桁)。REST のパスに入れる前に検査する。
bool is_snowflake(const std::string& s);

struct DiscordBridgeDeps {
    Services* services = nullptr;
    boost::asio::io_context* ioc = nullptr;
    boost::asio::thread_pool* workers = nullptr;
    std::function<std::shared_ptr<InterviewerBrain>()> brain_factory;
    AiResearchFn research;
    const VoiceConfig* voice = nullptr;
    std::string gateway_url = "wss://gateway.discord.gg/?v=10&encoding=json";
    std::string api_base = "https://discord.com/api/v10";
    bool public_only = true;  // テストの loopback の偽 gateway では false
    std::chrono::milliseconds reconnect_delay{5'000};
};

class DiscordBridge : public std::enable_shared_from_this<DiscordBridge> {
public:
    explicit DiscordBridge(DiscordBridgeDeps deps);
    ~DiscordBridge();
    // bot token が無ければ何もしない。
    void start();
    void stop();
    // 1 件の MESSAGE_CREATE を処理する (専用スレッドで呼ばれる。テストから直接呼んでもよい)。
    void handle_message(const Json& message);
    void send_message(const std::string& channel_id, const std::string& content);
    [[nodiscard]] bool ready() const { return ready_.load(); }
    [[nodiscard]] std::size_t active_sessions() const;

private:
    struct Active {
        std::string session_id;
        std::shared_ptr<SessionRuntime> runtime;
        std::shared_ptr<FrameSink> sink;
    };
    Json rest(const std::string& method, const std::string& path, const Json& body);
    void start_session(const std::string& channel_id, const std::string& mode, const std::string& target);
    void end_session(const std::string& channel_id);

    // gateway (strand の上だけで触る)
    void connect(std::uint64_t gen);
    void on_text(std::uint64_t gen, const std::string& data);
    void on_closed(std::uint64_t gen, int code);
    void schedule_reconnect();
    void arm_heartbeat(std::uint64_t gen);
    void send_gateway(const Json& payload);
    void dispatch(Json message);

    DiscordBridgeDeps d_;
    Services& s_;
    boost::asio::strand<boost::asio::io_context::executor_type> strand_;
    boost::asio::steady_timer heartbeat_timer_;
    boost::asio::steady_timer reconnect_timer_;
    std::shared_ptr<io::WsClient> ws_;
    std::uint64_t generation_ = 0;
    std::optional<std::int64_t> sequence_;
    std::string session_id_;
    std::string gateway_url_;
    std::chrono::milliseconds heartbeat_interval_{0};
    std::atomic<bool> stopped_{false};
    std::atomic<bool> started_{false};
    std::atomic<bool> ready_{false};
    std::unique_ptr<BackgroundTasks> tasks_;
    mutable std::mutex sessions_mu_;
    std::map<std::string, Active> sessions_;
};

}  // namespace tr::app
