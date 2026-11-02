#include "app/discord_bridge.hpp"

#include <boost/asio/bind_executor.hpp>
#include <boost/asio/post.hpp>

#include "app/interview_repo.hpp"
#include "core/domain/domain.hpp"
#include "core/text.hpp"
#include "core/time.hpp"

namespace tr::app {

namespace asio = boost::asio;

// ---------------------------------------------------------------- ES 相談の仲介

ReviewRouting db_review_routing(db::Database& db, std::function<EpochMs()> now) {
    ReviewRouting r;
    r.consume_pairing = [&db, now](const std::string& token, const std::string& channel) {
        return consume_pairing(db, token, channel, now());
    };
    r.relay_destination = [&db](const std::string& alias, const std::string& channel) {
        return relay_destination(db, alias, channel);
    };
    r.claim_delivery = [&db, now](const std::string& message_id, const std::string& request_id) {
        return claim_delivery(db, message_id, request_id, now());
    };
    r.finish_delivery = [&db](const std::string& message_id, const std::string& state) { finish_delivery(db, message_id, state); };
    return r;
}

namespace {

bool is_ascii_word(unsigned char c) {
    return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '_';
}
bool is_digit(unsigned char c) { return c >= '0' && c <= '9'; }

// [-ー] を pos で読めれば次の位置、読めなければ npos。
std::size_t phone_sep(std::string_view s, std::size_t pos) {
    if (pos < s.size() && s[pos] == '-') return pos + 1;
    if (s.substr(pos, 3) == "\xE3\x83\xBC") return pos + 3;  // U+30FC 'ー'
    return std::string_view::npos;
}

// pos から数字が何桁続くか。
std::size_t digit_run(std::string_view s, std::size_t pos) {
    std::size_t n = 0;
    while (pos + n < s.size() && is_digit(static_cast<unsigned char>(s[pos + n]))) ++n;
    return n;
}

// /\b\d{2,4}[-ー]\d{2,4}[-ー]\d{3,4}\b/ (u フラグなし: \d・\b は ASCII)。
bool has_phone_like(std::string_view s) {
    for (std::size_t i = 0; i < s.size(); ++i) {
        if (!is_digit(static_cast<unsigned char>(s[i]))) continue;
        if (i > 0 && is_ascii_word(static_cast<unsigned char>(s[i - 1]))) continue;  // \b
        // 先頭の数字の並びは区切りで終わる必要があるので、並び全体が 2〜4 桁でなければならない。
        const std::size_t a = digit_run(s, i);
        if (a < 2 || a > 4) continue;
        std::size_t p = phone_sep(s, i + a);
        if (p == std::string_view::npos) continue;
        const std::size_t b = digit_run(s, p);
        if (b < 2 || b > 4) continue;
        p = phone_sep(s, p + b);
        if (p == std::string_view::npos) continue;
        const std::size_t c = digit_run(s, p);
        if (c < 3 || c > 4) continue;
        const std::size_t end = p + c;
        if (end < s.size() && is_ascii_word(static_cast<unsigned char>(s[end]))) continue;  // \b
        return true;
    }
    return false;
}

// /^connect ([a-f0-9]{64})$/
std::optional<std::string> parse_connect(const std::string& args) {
    static constexpr std::string_view head = "connect ";
    if (!starts_with(args, head) || args.size() != head.size() + 64) return std::nullopt;
    const std::string token = args.substr(head.size());
    if (!is_lower_hex(token, 64)) return std::nullopt;
    return token;
}

// /^reply ([a-f0-9]{16})\s+([\s\S]+)$/
std::optional<std::pair<std::string, std::string>> parse_reply(const std::string& args) {
    static constexpr std::string_view head = "reply ";
    if (!starts_with(args, head) || args.size() < head.size() + 16) return std::nullopt;
    const std::string alias = args.substr(head.size(), 16);
    if (!is_lower_hex(alias, 16)) return std::nullopt;
    const std::string rest = args.substr(head.size() + 16);
    // \s+ (貪欲) の後に 1 文字以上
    const std::string body = js_trim_start(rest);
    if (body.size() == rest.size() || body.empty()) return std::nullopt;
    return std::make_pair(alias, body);
}

}  // namespace

bool review_body_has_contact(const std::string& body) {
    const std::string l = ascii_lower(body);
    for (std::string_view needle : {"http://", "https://", "www.", "discord.gg", "discord.com", "<@", "<#"}) {
        if (l.find(needle) != std::string::npos) return true;
    }
    for (std::size_t i = 0; i + 1 < l.size(); ++i) {
        if (l[i] != '@') continue;
        const auto c = static_cast<unsigned char>(l[i + 1]);
        if (is_ascii_word(c) || c == '.' || c == '-') return true;  // @[\w.-]+
    }
    return has_phone_like(body);
}

bool handle_review_message(const Json& message, const std::string& prefix, const DiscordSend& send, const ReviewRouting& routing) {
    const std::string content = string_or(message, "content");
    const std::string start = prefix + " es";
    if (content != start && !starts_with(content, start + " ")) return false;
    const Json* author = member(message, "author");
    if (author && author->is_object() && author->value("bot", false) == true) return true;
    const std::string channel = string_or(message, "channel_id");
    if (const Json* g = member(message, "guild_id"); g && g->is_string() && !g->get<std::string>().empty()) {
        try {
            send(channel, "ES の連絡は Bot との個別 DM で行ってください。ここには本文や接続コードを投稿しないでください。");
        } catch (...) {
        }
        return true;
    }
    try {
        if (const Json* a = member(message, "attachments"); a && a->is_array() && !a->empty()) {
            send(channel, "添付ファイルには対応していません。氏名・連絡先を除いたテキストを送ってください。");
            return true;
        }
        const std::string args = js_trim(utf16_slice(content, utf16_length(start), utf16_length(content)));
        if (auto token = parse_connect(args)) {
            const auto route = routing.consume_pairing(*token, channel);
            send(channel, route ? "接続しました。返信: " + prefix + " es reply " + route->alias +
                                      " 本文\n氏名・連絡先・URLを含めないでください。"
                                : std::string("接続コードが無効・期限切れ、または相談が終了しています。Tirocinium で再発行してください。"));
            return true;
        }
        const auto reply = parse_reply(args);
        if (!reply) {
            send(channel, "Tirocinium の相談画面で接続コードを取得してください。返信: " + prefix + " es reply 相談番号 本文");
            return true;
        }
        const std::string body = js_trim(reply->second);
        // 自由記述は匿名を保証できない。連絡先らしきものは弾く (ES を黙って書き換えない)。
        if (body.empty() || utf16_length(body) > 1400 || review_body_has_contact(body)) {
            send(channel, "本文は1〜1400文字で、連絡先・URL・メンションを除いて送ってください。長いESは分割できます。");
            return true;
        }
        const auto dest = routing.relay_destination(reply->first, channel);
        if (!dest) {
            send(channel, "送信できません。相談番号、双方のBot接続、相談が継続中かをTirociniumで確認してください。");
            return true;
        }
        const std::string message_id = string_or(message, "id");
        if (!routing.claim_delivery(message_id, dest->request_id)) return true;  // gateway の重複配送
        try {
            send(dest->channel_id, "【ES相談 " + dest->alias + "】" + (dest->role == "student" ? "学生" : "OB") + "から\n" + body +
                                       "\n\n返信: " + prefix + " es reply " + dest->alias + " 本文");
            routing.finish_delivery(message_id, "sent");
        } catch (...) {
            routing.finish_delivery(message_id, "unknown");
            send(channel, "配送を確認できませんでした。自動再送はしません。相手の受信状況を確認してから再投稿してください。");
            return true;
        }
        send(channel, "Bot 経由で送りました。");
    } catch (...) {
        // Discord API のエラーは投稿内容を含みうる。固定文だけを返す。
        try {
            send(channel, "ES仲介処理を完了できませんでした。しばらくして相談画面の状態を確認してください。");
        } catch (...) {
        }
    }
    return true;
}

bool is_snowflake(const std::string& s) {
    if (s.empty() || s.size() > 25) return false;
    for (char c : s) {
        if (c < '0' || c > '9') return false;
    }
    return true;
}

// ---------------------------------------------------------------- 面接の擬似ソケット

namespace {

// RuntimeDiscordSocket: 応答をためて response_end でチャンネルへ送る。送信は順序を保って背景で。
class DiscordSink final : public FrameSink {
public:
    DiscordSink(std::string channel_id, std::function<void(const std::string&, const std::string&)> post_message,
                asio::thread_pool& pool)
        : channel_id_(std::move(channel_id)), post_(std::move(post_message)), strand_(asio::make_strand(pool)) {}

    void send(const std::string& raw) override {
        auto frame = parse_json(raw);
        if (!frame || !frame->is_object()) return;
        const std::string kind = string_or(*frame, "kind");
        std::string out;
        {
            std::lock_guard lock(mu_);
            if (kind == "response_token") {
                buffer_ += string_or(*frame, "token");
                return;
            }
            if (kind == "response_end") {
                out = js_trim(buffer_);
                buffer_.clear();
            } else if (kind == "system") {
                if (string_or(*frame, "code") == "closing") {
                    out = "Tr interview ended.";
                } else if (const std::string m = string_or(*frame, "message"); !m.empty()) {
                    out = "Tr system: " + m;
                }
            }
        }
        if (out.empty()) return;
        asio::post(strand_, [post = post_, channel = channel_id_, out = std::move(out)] { post(channel, out); });
    }
    void close() override { open_ = false; }
    [[nodiscard]] bool is_open() const override { return open_.load(); }

private:
    std::string channel_id_;
    std::function<void(const std::string&, const std::string&)> post_;
    asio::strand<asio::thread_pool::executor_type> strand_;
    std::mutex mu_;
    std::string buffer_;
    std::atomic<bool> open_{true};
};

}  // namespace

std::shared_ptr<FrameSink> make_discord_sink(std::string channel_id, std::function<void(const std::string&, const std::string&)> post,
                                             asio::thread_pool& pool) {
    return std::make_shared<DiscordSink>(std::move(channel_id), std::move(post), pool);
}

namespace {

const char* platform_name() {
#ifdef _WIN32
    return "win32";
#elif defined(__APPLE__)
    return "darwin";
#else
    return "linux";
#endif
}

// GUILDS(1) | GUILD_VOICE_STATES(128) | GUILD_MESSAGES(512) | DIRECT_MESSAGES(4096) | MESSAGE_CONTENT(32768)
constexpr int kIntents = 1 | 128 | 512 | 4096 | 32768;

bool valid_resume_url(const std::string& u) {
    // /^wss:\/\/[a-z0-9.-]+\.discord\.gg\/?$/i
    const std::string l = ascii_lower(u);
    if (!starts_with(l, "wss://")) return false;
    std::string host = l.substr(6);
    if (!host.empty() && host.back() == '/') host.pop_back();
    if (!ends_with(host, ".discord.gg") || host.size() <= std::string(".discord.gg").size()) return false;
    for (char c : host) {
        if (!((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '.' || c == '-')) return false;
    }
    return true;
}

}  // namespace

// ---------------------------------------------------------------- bridge

DiscordBridge::DiscordBridge(DiscordBridgeDeps deps)
    : d_(std::move(deps)),
      s_(*d_.services),
      strand_(asio::make_strand(*d_.ioc)),
      heartbeat_timer_(strand_),
      reconnect_timer_(strand_),
      gateway_url_(d_.gateway_url) {}

// 停止は所有者 (RuntimeExtensions) が stop() で行う。背景の処理が自分を握っている間は破棄されない。
DiscordBridge::~DiscordBridge() = default;

std::size_t DiscordBridge::active_sessions() const {
    std::lock_guard lock(sessions_mu_);
    return sessions_.size();
}

void DiscordBridge::start() {
    if (s_.config.discord.bot_token.empty()) return;
    if (started_.exchange(true)) return;
    tasks_ = std::make_unique<BackgroundTasks>(2, 64);
    asio::post(strand_, [self = shared_from_this()] { self->connect(++self->generation_); });
}

void DiscordBridge::stop() {
    if (stopped_.exchange(true)) return;
    if (!started_.load()) return;
    std::map<std::string, Active> sessions;
    {
        std::lock_guard lock(sessions_mu_);
        sessions.swap(sessions_);
    }
    for (auto& [ch, a] : sessions) {
        try {
            a.runtime->close();
        } catch (...) {
        }
        a.sink->close();
    }
    auto self = shared_from_this();
    asio::post(strand_, [self] {
        self->heartbeat_timer_.cancel();
        self->reconnect_timer_.cancel();
        if (self->ws_) self->ws_->close(1000, "");
        self->ws_.reset();
        ++self->generation_;
    });
    if (tasks_) tasks_->join();
}

Json DiscordBridge::rest(const std::string& method, const std::string& path, const Json& body) {
    io::HttpClientRequest req;
    req.method = method;
    req.url = d_.api_base + path;
    req.headers = {{"authorization", "Bot " + s_.config.discord.bot_token}, {"content-type", "application/json"}};
    req.body = js_stringify(body);
    req.timeout = std::chrono::milliseconds(15'000);
    req.max_response_bytes = 1024 * 1024;
    req.public_only = d_.public_only;
    const auto res = s_.fetch(req);
    // 応答本文は投稿内容を含みうるので、例外にもログにも載せない。
    if (!res.ok()) throw std::runtime_error("discord rest " + std::to_string(res.status));
    auto parsed = parse_json(res.body);
    return parsed ? *parsed : Json(nullptr);
}

void DiscordBridge::send_message(const std::string& channel_id, const std::string& content) {
    if (!is_snowflake(channel_id)) throw std::runtime_error("invalid channel id");
    for (const auto& chunk : domain::chunk_content(content)) {
        rest("POST", "/channels/" + channel_id + "/messages",
             Json{{"content", chunk}, {"allowed_mentions", Json{{"parse", Json::array()}}}});
    }
}

void DiscordBridge::handle_message(const Json& message) {
    if (!message.is_object()) return;
    const Json* author = member(message, "author");
    if (author && author->is_object() && author->value("bot", false) == true) return;
    const auto& dc = s_.config.discord;
    auto send = [this](const std::string& ch, const std::string& text) { send_message(ch, text); };
    if (handle_review_message(message, dc.command_prefix, send, db_review_routing(s_.db, s_.now))) return;
    const std::string channel = string_or(message, "channel_id");
    if (!is_snowflake(channel)) return;
    if (!dc.allowed_channel_ids.empty() &&
        std::find(dc.allowed_channel_ids.begin(), dc.allowed_channel_ids.end(), channel) == dc.allowed_channel_ids.end()) {
        return;
    }
    const std::string content = string_or(message, "content");
    const auto cmd = domain::parse_discord_command(content, dc.command_prefix);
    if (cmd.kind == "help") {
        send_message(channel, domain::render_discord_help(dc.command_prefix));
        return;
    }
    if (cmd.kind == "end") {
        end_session(channel);
        return;
    }
    if (cmd.kind == "start") {
        start_session(channel, cmd.mode, cmd.target);
        return;
    }
    std::shared_ptr<SessionRuntime> runtime;
    {
        std::lock_guard lock(sessions_mu_);
        if (auto it = sessions_.find(channel); it != sessions_.end()) runtime = it->second.runtime;
    }
    if (runtime) runtime->on_message(js_stringify(Json{{"kind", "stt_final"}, {"text", content}}));
}

void DiscordBridge::start_session(const std::string& channel_id, const std::string& mode, const std::string& target) {
    {
        std::lock_guard lock(sessions_mu_);
        if (sessions_.count(channel_id)) {
            send_message(channel_id, "This channel already has an active Tr interview. Use `!tr end` first.");
            return;
        }
    }
    const std::string uid = s_.config.dev_user_id;
    ensure_user(s_.db, uid);
    const auto decision = try_start(s_.db, uid, s_.now(), s_.config.slot_capacity, s_.slot_duration_env);
    if (decision.kind != "start") {
        send_message(channel_id, decision.kind == "offer" ? "Tr is busy. Next slot: " + iso_from_ms(decision.slot_start)
                                                          : "Tr cannot start: " + decision.reason);
        return;
    }
    const auto interviewers = list_interviewers(s_.db, std::nullopt, std::nullopt, std::nullopt);
    if (!interviewers.empty()) {
        const std::string iid = string_or(interviewers.front(), "id");
        if (!iid.empty()) patch_session_metadata(s_.db, decision.session_id, Json{{"interviewer_id", iid}});
    }
    if (!target.empty()) {
        s_.db.query("UPDATE sessions SET target_role = COALESCE($1, target_role) WHERE id = $2", {target, decision.session_id});
    }
    auto weak = weak_from_this();
    auto post = [weak](const std::string& ch, const std::string& text) {
        auto self = weak.lock();
        if (!self) return;
        try {
            self->send_message(ch, text);
        } catch (const std::exception& e) {
            if (self->s_.log) self->s_.log(std::string("[discord] send failed: ") + e.what());
        }
    };
    auto sink = make_discord_sink(channel_id, post, *d_.workers);
    RuntimeDeps deps;
    deps.services = &s_;
    deps.brain = d_.brain_factory();
    deps.tts_over_ws = false;  // Node 版も Discord では WS 向けの tts_chunk を流さない
    deps.voice = d_.voice;
    deps.research = d_.research;
    auto runtime = std::make_shared<SessionRuntime>(sink, decision.session_id, uid, deps);
    {
        std::lock_guard lock(sessions_mu_);
        if (sessions_.count(channel_id)) return;
        sessions_[channel_id] = Active{decision.session_id, runtime, sink};
    }
    try {
        runtime->init();
    } catch (...) {
        {
            std::lock_guard lock(sessions_mu_);
            sessions_.erase(channel_id);
        }
        sink->close();
        throw;
    }
    if (mode == "voice") {
        send_message(channel_id,
                     "Voice mode is not available on this server build yet. Starting a text interview in this channel instead.");
    }
    send_message(channel_id, "Started Tr text interview. Tr will ask first.");
    runtime->on_message(R"({"kind":"start_interview"})");
}

void DiscordBridge::end_session(const std::string& channel_id) {
    Active active;
    {
        std::lock_guard lock(sessions_mu_);
        auto it = sessions_.find(channel_id);
        if (it == sessions_.end()) {
            active.runtime = nullptr;
        } else {
            active = it->second;
        }
    }
    if (!active.runtime) {
        send_message(channel_id, "No active Tr interview in this channel.");
        return;
    }
    active.runtime->on_message(R"({"kind":"end_session"})");
    active.runtime->close();
    active.sink->close();
    std::lock_guard lock(sessions_mu_);
    sessions_.erase(channel_id);
}

// ---------------------------------------------------------------- gateway

void DiscordBridge::send_gateway(const Json& payload) {
    if (ws_ && ws_->is_open()) ws_->send(js_stringify(payload));
}

void DiscordBridge::connect(std::uint64_t gen) {
    if (stopped_ || gen != generation_) return;
    io::WsClientOptions o;
    o.connect_timeout = std::chrono::milliseconds(15'000);
    o.idle_timeout = std::chrono::seconds(120);  // heartbeat ACK が 41 秒ごとに来る。来なければ死んだ接続とみなす
    o.max_message = 4 * 1024 * 1024;
    o.public_only = d_.public_only;
    auto weak = weak_from_this();
    ws_ = io::ws_connect(
        *d_.ioc, gateway_url_, o,
        [weak, gen](bool ok, const std::string&) {
            auto self = weak.lock();
            if (!self || ok) return;
            asio::post(self->strand_, [self, gen] { self->on_closed(gen, 1006); });
        },
        [weak, gen](std::string data, bool binary) {
            auto self = weak.lock();
            if (!self || binary) return;
            asio::post(self->strand_, [self, gen, data = std::move(data)] { self->on_text(gen, data); });
        },
        [weak, gen](int code, const std::string&) {
            auto self = weak.lock();
            if (!self) return;
            asio::post(self->strand_, [self, gen, code] { self->on_closed(gen, code); });
        });
}

void DiscordBridge::arm_heartbeat(std::uint64_t gen) {
    heartbeat_timer_.expires_after(heartbeat_interval_);
    heartbeat_timer_.async_wait(asio::bind_executor(strand_, [self = shared_from_this(), gen](const boost::system::error_code& ec) {
        if (ec || self->stopped_ || gen != self->generation_) return;
        self->send_gateway(Json{{"op", 1}, {"d", self->sequence_ ? Json(*self->sequence_) : Json(nullptr)}});
        self->arm_heartbeat(gen);
    }));
}

void DiscordBridge::on_text(std::uint64_t gen, const std::string& data) {
    if (stopped_ || gen != generation_) return;
    JsonLimits limits;
    limits.max_bytes = 4 * 1024 * 1024;
    auto payload = parse_json(data, limits);
    if (!payload || !payload->is_object()) return;
    if (const Json* s = member(*payload, "s"); s && s->is_number_integer()) sequence_ = s->get<std::int64_t>();
    const Json* op_v = member(*payload, "op");
    const int op = op_v && op_v->is_number_integer() ? op_v->get<int>() : -1;
    const std::string t = string_or(*payload, "t");
    const Json* d = member(*payload, "d");
    if (op == 7 || op == 9) {
        if (op == 9 && !(d && *d == true)) {
            session_id_.clear();
            sequence_.reset();
            gateway_url_ = d_.gateway_url;
        }
        if (ws_) ws_->close(4000, "reconnect");
        return;
    }
    if (op == 1) {
        send_gateway(Json{{"op", 1}, {"d", sequence_ ? Json(*sequence_) : Json(nullptr)}});
        return;
    }
    if (op == 10) {
        long long interval = 41'250;
        if (d && d->is_object()) {
            if (const Json* h = member(*d, "heartbeat_interval"); h && h->is_number()) interval = static_cast<long long>(h->get<double>());
        }
        interval = std::clamp<long long>(interval, 1'000, 120'000);
        heartbeat_interval_ = std::chrono::milliseconds(interval);
        heartbeat_timer_.cancel();
        arm_heartbeat(gen);
        const std::string& token = s_.config.discord.bot_token;
        if (!session_id_.empty() && sequence_) {
            send_gateway(Json{{"op", 6}, {"d", Json{{"token", token}, {"session_id", session_id_}, {"seq", *sequence_}}}});
            return;
        }
        send_gateway(Json{{"op", 2},
                          {"d", Json{{"token", token},
                                     {"intents", kIntents},
                                     {"properties", Json{{"os", platform_name()}, {"browser", "tirocinium"}, {"device", "tirocinium"}}}}}});
        return;
    }
    if (t == "READY" && d && d->is_object()) {
        session_id_ = string_or(*d, "session_id");
        const std::string resume = string_or(*d, "resume_gateway_url");
        if (!resume.empty() && valid_resume_url(resume)) {
            std::string base = resume;
            if (base.back() == '/') base.pop_back();
            gateway_url_ = base + "/?v=10&encoding=json";
        }
        ready_ = true;
        if (s_.log) s_.log("[discord] bridge ready");
        return;
    }
    if (t == "RESUMED") {
        ready_ = true;
        return;
    }
    if (t == "MESSAGE_CREATE" && d && d->is_object()) {
        dispatch(*d);
        return;
    }
    // VOICE_STATE_UPDATE / VOICE_SERVER_UPDATE: 音声は未対応なので読み捨てる。
}

void DiscordBridge::dispatch(Json message) {
    if (!tasks_) return;
    auto self = shared_from_this();
    const bool accepted = tasks_->submit([self, message = std::move(message)] {
        try {
            self->handle_message(message);
        } catch (const std::exception& e) {
            if (self->s_.log) self->s_.log(std::string("[discord] bridge error: ") + e.what());
        }
    });
    if (!accepted && s_.log) s_.log("[discord] busy; a message was dropped");
}

void DiscordBridge::on_closed(std::uint64_t gen, int code) {
    if (gen != generation_) return;
    heartbeat_timer_.cancel();
    ready_ = false;
    ws_.reset();
    if (stopped_) return;
    // 認証・intent の失敗は設定の変更が要る。再接続を繰り返さない。
    if (code == 4004 || (code >= 4010 && code <= 4014)) {
        if (s_.log) s_.log("[discord] gateway closed with code " + std::to_string(code) + "; not reconnecting (check bot settings)");
        return;
    }
    if (code == 4007 || code == 4009) {
        session_id_.clear();
        sequence_.reset();
        gateway_url_ = d_.gateway_url;
    }
    schedule_reconnect();
}

void DiscordBridge::schedule_reconnect() {
    const std::uint64_t gen = ++generation_;
    reconnect_timer_.expires_after(d_.reconnect_delay);
    reconnect_timer_.async_wait(asio::bind_executor(strand_, [self = shared_from_this(), gen](const boost::system::error_code& ec) {
        if (ec) return;
        self->connect(gen);
    }));
}

}  // namespace tr::app
