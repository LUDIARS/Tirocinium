#include "app/ws_routes.hpp"

#include <atomic>
#include <condition_variable>
#include <deque>

#include <boost/asio/post.hpp>
#include <boost/asio/steady_timer.hpp>
#include <boost/asio/strand.hpp>

#include "app/interview_repo.hpp"
#include "core/text.hpp"
#include "core/url.hpp"
#include "http/message.hpp"
#include "io/ws_client.hpp"

namespace tr::app {

namespace asio = boost::asio;

namespace {

bool uuidish(std::string_view s) {
    if (s.size() != 36) return false;
    for (char c : s) {
        if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || c == '-')) return false;
    }
    return true;
}

}  // namespace

std::optional<std::string> WsRoutes::session_path_id(const std::string& target) {
    // /^\/api\/v1\/ws\/session\/([0-9a-f-]{36})(?:\?.*)?$/
    static constexpr std::string_view prefix = "/api/v1/ws/session/";
    if (!starts_with(target, prefix)) return std::nullopt;
    std::string_view rest = std::string_view(target).substr(prefix.size());
    const std::string_view id = rest.substr(0, 36);
    if (!uuidish(id)) return std::nullopt;
    if (rest.size() > 36 && rest[36] != '?') return std::nullopt;
    return std::string(id);
}

std::optional<std::string> WsRoutes::call_path_id(const std::string& target) {
    // /^\/api\/v1\/ws\/call\/([0-9a-f-]{36})$/
    static constexpr std::string_view prefix = "/api/v1/ws/call/";
    if (!starts_with(target, prefix)) return std::nullopt;
    std::string_view rest = std::string_view(target).substr(prefix.size());
    if (rest.size() != 36 || !uuidish(rest)) return std::nullopt;
    return std::string(rest);
}

std::optional<std::string> WsRoutes::relay_ticket(const std::string& target) {
    std::string path, query;
    const auto q = target.find('?');
    path = target.substr(0, q);
    if (path != "/api/auth/cernere/ws") return std::nullopt;
    http::Request r;
    r.raw_query = q == std::string::npos ? "" : target.substr(q + 1);
    const std::string ticket = r.query("ticket").value_or("");
    // Cernere の ticket は英数字と - _ のみ。それ以外は中継しない (URL への混入を防ぐ)
    if (ticket.size() < 16 || ticket.size() > 256 || !all_of_chars(ticket, "-_", true)) return std::string();
    return ticket;
}

std::optional<std::string> WsRoutes::upstream_url(const std::string& cernere_url, const std::string& ticket) {
    auto base = parse_url(cernere_url);
    if (!base) return std::nullopt;
    const std::string scheme = base->scheme == "https" ? "wss" : "ws";
    return scheme + "://" + base->host_header() + "/auth/composite-ws?ticket=" + http::encode_uri_component(ticket);
}

void WsRoutes::handle(const std::shared_ptr<io::PendingUpgrade>& up) {
    const std::string& target = up->request().target;
    if (auto id = session_path_id(target)) return session_ws(up, *id);
    if (auto id = call_path_id(target)) return call_ws(up, *id);
    if (auto ticket = relay_ticket(target)) {
        if (ticket->empty()) return up->reject(400);
        return cernere_relay(up, *ticket);
    }
    up->reject(404);
}

// ---- session WS (ws/handler.ts) ----

namespace {

// init が終わるまで後続のフレームを待たせる (Node 版は init と onMessage が並行して走りえた)。
struct InitGate {
    std::mutex mu;
    std::condition_variable cv;
    bool done = false;
    void open() {
        {
            std::lock_guard l(mu);
            done = true;
        }
        cv.notify_all();
    }
    void wait() {
        std::unique_lock l(mu);
        cv.wait_for(l, std::chrono::seconds(60), [&] { return done; });
    }
};

}  // namespace

void WsRoutes::session_ws(const std::shared_ptr<io::PendingUpgrade>& up, std::string session_id) {
    auto self = shared_from_this();
    asio::post(*deps_.workers, [self, up, session_id] {
        Services& s = *self->deps_.services;
        std::optional<std::string> user;
        try {
            user = s.auth.authenticate_ws(up->request());
        } catch (...) {
            return up->reject(500);
        }
        if (!user) return up->reject(401);
        try {
            auto rows = s.db.query("SELECT user_id, status FROM sessions WHERE id = $1", {session_id});
            if (rows.empty() || rows[0]["user_id"] != *user || rows[0]["status"] != "active") return up->reject(403);
        } catch (...) {
            return up->reject(500);
        }
        io::WsAcceptOptions opts;
        opts.max_message_bytes = 1024 * 1024;
        up->accept(opts, [self, session_id, uid = *user](std::shared_ptr<io::WsConnection> conn) {
            RuntimeDeps deps;
            deps.services = self->deps_.services;
            deps.brain = self->deps_.brain_factory();
            deps.voice = self->deps_.voice;
            deps.research = self->deps_.research;
            auto runtime = std::make_shared<SessionRuntime>(std::make_shared<WsSink>(conn), session_id, uid, deps);
            auto gate = std::make_shared<InitGate>();
            asio::post(*self->deps_.workers, [runtime, gate, self] {
                try {
                    runtime->init();
                } catch (const std::exception& e) {
                    if (self->deps_.services->log) self->deps_.services->log(std::string("[ws] session init failed ") + e.what());
                }
                gate->open();
            });
            conn->start(
                [self, runtime, gate](std::string data, bool) {
                    asio::post(*self->deps_.workers, [runtime, gate, data = std::move(data), self] {
                        gate->wait();
                        try {
                            runtime->on_message(data);
                        } catch (const std::exception& e) {
                            if (self->deps_.services->log) self->deps_.services->log(std::string("[ws] frame failed ") + e.what());
                        }
                    });
                },
                [runtime] { runtime->close(); });
        });
    });
}

// ---- call WS (ws/call-handler.ts) ----

namespace {

struct CallState : std::enable_shared_from_this<CallState> {
    std::shared_ptr<io::WsConnection> conn;
    std::shared_ptr<SessionRuntime> runtime;
    std::string user_id;
    std::atomic<bool> disposed{false};
    bool started = false;
    std::atomic<int> pending{0};
    std::unique_ptr<asio::steady_timer> timer;
    std::unique_ptr<asio::strand<asio::thread_pool::executor_type>> queue;
};

}  // namespace

void WsRoutes::call_ws(const std::shared_ptr<io::PendingUpgrade>& up, std::string session_id) {
    auto self = shared_from_this();
    io::WsAcceptOptions opts;
    opts.max_message_bytes = 128 * 1024;
    up->accept(opts, [self, session_id](std::shared_ptr<io::WsConnection> conn) {
        auto st = std::make_shared<CallState>();
        st->conn = conn;
        st->timer = std::make_unique<asio::steady_timer>(*self->deps_.ioc);
        st->queue = std::make_unique<asio::strand<asio::thread_pool::executor_type>>(asio::make_strand(self->deps_.workers->get_executor()));
        const void* owner = st.get();
        Services& s = *self->deps_.services;
        auto report = [&s](const char* code) {
            if (s.log) s.log(std::string("[call] ") + code);
        };
        // dispose: runtime を閉じ、この接続がセッションの持ち主ならセッションを終える (内容はログに出さない)
        auto dispose = [self, st, session_id, owner, report] {
            if (st->disposed.exchange(true)) return;
            asio::post(*self->deps_.ioc, [st] { st->timer->cancel(); });
            asio::post(*self->deps_.workers, [self, st, session_id, owner, report] {
                if (st->runtime) st->runtime->close();
                bool mine = false;
                {
                    std::lock_guard l(self->owners_mu_);
                    auto it = self->owners_.find(session_id);
                    mine = it != self->owners_.end() && it->second == owner;
                }
                if (!mine) return;
                try {
                    self->deps_.services->db.query(
                        "UPDATE sessions SET status = 'ended', ended_at = now() WHERE id = $1 AND user_id = $2 AND status = 'active'",
                        {session_id, st->user_id});
                } catch (...) {
                    report("cleanup_failed");
                }
                self->deps_.services->materials.clear(session_id);
                std::lock_guard l(self->owners_mu_);
                self->owners_.erase(session_id);
            });
        };
        st->timer->expires_after(std::chrono::seconds(5));
        st->timer->async_wait([st](const boost::system::error_code& ec) {
            if (!ec) st->conn->close(1008, "authentication_timeout");
        });
        conn->start(
            [self, st, session_id, owner, dispose](std::string data, bool binary) {
                if (st->disposed) return;
                if (++st->pending > 16) {
                    st->conn->close(1008, "call_backpressure");
                    dispose();
                    return;
                }
                asio::post(*st->queue, [self, st, session_id, owner, dispose, data = std::move(data), binary] {
                    struct Done {
                        CallState* s;
                        ~Done() { --s->pending; }
                    } done{st.get()};
                    if (st->disposed) return;
                    Services& s = *self->deps_.services;
                    try {
                        if (binary) throw std::runtime_error("text_frames_required");
                        auto frame = parse_json(data, JsonLimits{128 * 1024, 100'000, 16});
                        if (!frame) throw std::runtime_error("invalid json");
                        if (!st->runtime) {
                            const std::string ticket = frame->is_object() ? string_or(*frame, "ticket") : "";
                            if (ticket.empty()) throw std::runtime_error("unauthorized");
                            auto uid = s.call_tickets.consume(ticket, session_id, s.now());
                            if (!uid) throw std::runtime_error("unauthorized");
                            st->user_id = *uid;
                            {
                                std::lock_guard l(self->owners_mu_);
                                if (self->owners_.count(session_id)) throw std::runtime_error("call_already_connected");
                                self->owners_[session_id] = owner;
                            }
                            asio::post(*self->deps_.ioc, [st] {
                                st->timer->cancel();
                                st->timer->expires_after(std::chrono::seconds(30));
                                st->timer->async_wait([st](const boost::system::error_code& ec) {
                                    if (!ec) st->conn->close(1011, "initialization_timeout");
                                });
                            });
                            if (s.db.query("SELECT id FROM sessions WHERE id = $1 AND user_id = $2 AND status = 'active'",
                                           {session_id, *uid})
                                    .empty() ||
                                st->disposed) {
                                throw std::runtime_error("inactive_session");
                            }
                            RuntimeDeps deps;
                            deps.services = self->deps_.services;
                            deps.brain = self->deps_.brain_factory();
                            deps.voice = self->deps_.voice;
                            deps.research = self->deps_.research;
                            st->runtime = std::make_shared<SessionRuntime>(std::make_shared<WsSink>(st->conn), session_id, *uid, deps);
                            st->runtime->init();
                            if (st->disposed) {
                                st->runtime->close();
                            } else {
                                asio::post(*self->deps_.ioc, [st] { st->timer->cancel(); });
                            }
                            return;
                        }
                        static const std::vector<std::string> kinds = {"audio_chunk", "start_interview", "stt_final",
                                                                       "barge_in",    "end_session",     "pong"};
                        const std::string kind = frame->is_object() ? string_or(*frame, "kind") : "";
                        if (std::find(kinds.begin(), kinds.end(), kind) == kinds.end()) throw std::runtime_error("invalid_frame");
                        if (kind == "start_interview") {
                            if (st->started) throw std::runtime_error("interview_already_started");
                            st->started = true;
                            // LLM の生成でこの queue (音声の受け取り・割り込み) を塞がない。
                            asio::post(*self->deps_.workers, [st, dispose, frame_text = js_stringify(*frame)] {
                                try {
                                    st->runtime->on_message(frame_text);
                                } catch (...) {
                                    st->conn->close(1011, "interview_failed");
                                    dispose();
                                }
                            });
                            return;
                        }
                        st->runtime->on_message(js_stringify(*frame));
                    } catch (...) {
                        // フレームには音声や資格情報が入りうる。内容はログに出さない。
                        st->conn->close(1008, "call_failed");
                        dispose();
                    }
                });
            },
            [dispose] { dispose(); });
    });
}

// ---- Cernere composite relay ----

void WsRoutes::cernere_relay(const std::shared_ptr<io::PendingUpgrade>& up, std::string ticket) {
    Services& s = *deps_.services;
    if (s.config.cernere.url.empty()) return up->reject(503);
    auto url = upstream_url(s.config.cernere.url, ticket);
    if (!url) return up->reject(502);
    struct Relay {
        std::mutex mu;
        std::shared_ptr<io::WsConnection> client;
        std::deque<std::string> pending;  // client が開く前に上流から届いたもの
        std::shared_ptr<io::WsClient> upstream;
        bool accepted = false;
        bool closed = false;  // どちらかの側が閉じた (または上流に繋がらなかった)
    };
    auto relay = std::make_shared<Relay>();
    auto log = s.log;
    io::WsClientOptions opts;
    opts.max_message = 1024 * 1024;
    // relay は両側の接続を持ち、両側の callback は relay を持つ。どちらかが閉じたら relay 側の参照を外して
    // 循環を切る (切らないと接続ごとに relay と両側の接続が残る。ASan の LeakSanitizer で見つかった)。
    auto upstream = io::ws_connect(
        *deps_.ioc, *url, opts,
        [relay, up, log](bool ok, const std::string& err) {
            if (!ok) {
                {
                    std::lock_guard l(relay->mu);
                    relay->upstream.reset();
                    relay->closed = true;
                }
                if (log) log("[auth] Cernere composite WS relay failed: " + err);
                return up->reject(502);
            }
            io::WsAcceptOptions aopts;
            aopts.max_message_bytes = 1024 * 1024;
            up->accept(aopts, [relay](std::shared_ptr<io::WsConnection> conn) {
                std::deque<std::string> flush;
                {
                    std::lock_guard l(relay->mu);
                    relay->client = conn;
                    relay->accepted = true;
                    flush.swap(relay->pending);
                }
                for (auto& m : flush) conn->send_text(std::move(m));
                conn->start(
                    [relay](std::string data, bool binary) {
                        std::shared_ptr<io::WsClient> upstream;
                        {
                            std::lock_guard l(relay->mu);
                            upstream = relay->upstream;
                        }
                        if (upstream && upstream->is_open()) upstream->send(std::move(data), binary);
                    },
                    [relay] {
                        std::shared_ptr<io::WsClient> upstream;
                        {
                            std::lock_guard l(relay->mu);
                            upstream = std::move(relay->upstream);
                            relay->upstream.reset();
                            relay->client.reset();
                            relay->pending.clear();
                            relay->closed = true;
                        }
                        if (upstream) upstream->close(1000, "");
                    });
            });
        },
        [relay](std::string data, bool) {
            std::shared_ptr<io::WsConnection> client;
            {
                std::lock_guard l(relay->mu);
                if (!relay->client || !relay->client->is_open()) {
                    relay->pending.push_back(std::move(data));
                    return;
                }
                client = relay->client;
            }
            client->send_text(std::move(data));
        },
        [relay](int code, const std::string&) {
            std::shared_ptr<io::WsConnection> client;
            {
                std::lock_guard l(relay->mu);
                client = std::move(relay->client);
                relay->client.reset();
                relay->upstream.reset();
                relay->pending.clear();
                relay->closed = true;
            }
            if (client) {
                const bool valid = code >= 1000 && code < 5000 && code != 1005 && code != 1006;
                client->close(static_cast<std::uint16_t>(valid ? code : 1011), "");
            }
        });
    {
        std::lock_guard l(relay->mu);
        if (!relay->closed) {
            relay->upstream = std::move(upstream);
            return;
        }
    }
    // ws_connect から戻る前にどちらかが閉じていた: 上流を持たずに閉じる。
    if (upstream) upstream->close(1000, "");
}

}  // namespace tr::app
