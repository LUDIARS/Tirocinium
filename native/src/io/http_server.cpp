#include "io/http_server.hpp"

#include <deque>
#include <iostream>
#include <mutex>

#include <boost/asio/dispatch.hpp>
#include <boost/asio/ip/address.hpp>
#include <boost/asio/post.hpp>
#include <boost/asio/strand.hpp>
#include <boost/asio/write.hpp>
#include <boost/beast/core.hpp>
#include <boost/beast/http.hpp>
#include <boost/beast/websocket.hpp>

#include "http/request_budget.hpp"
#include "io/ws_connection.hpp"

namespace tr::io {

namespace asio = boost::asio;
namespace beast = boost::beast;
namespace bhttp = boost::beast::http;
namespace websocket = boost::beast::websocket;
using tcp = asio::ip::tcp;

namespace {

http::Request to_request(const bhttp::request<bhttp::string_body>& msg, const std::string& remote) {
    http::Request req;
    req.method = std::string(msg.method_string());
    req.target = std::string(msg.target());
    http::split_target(req.target, req.path, req.raw_query);
    for (const auto& field : msg) {
        req.headers.append(std::string(field.name_string()), std::string(field.value()));
    }
    req.body = msg.body();
    req.remote_address = remote;
    return req;
}

// ---- WebSocket (server) ----------------------------------------------------------------------

class ServerWs final : public WsConnection, public std::enable_shared_from_this<ServerWs> {
public:
    ServerWs(websocket::stream<beast::tcp_stream> ws, std::shared_ptr<void> token)
        : ws_(std::move(ws)), token_(std::move(token)) {}

    void start(MessageHandler on_message, CloseHandler on_close) override {
        on_message_ = std::move(on_message);
        on_close_ = std::move(on_close);
        asio::dispatch(ws_.get_executor(), [self = shared_from_this()] { self->do_read(); });
    }

    void send_text(std::string data) override {
        asio::post(ws_.get_executor(), [self = shared_from_this(), data = std::move(data)]() mutable {
            if (!self->open_) return;
            self->queue_.push_back(std::move(data));
            if (self->queue_.size() == 1) self->do_write();
        });
    }

    void close(std::uint16_t code, std::string reason) override {
        asio::post(ws_.get_executor(), [self = shared_from_this(), code, reason = std::move(reason)]() mutable {
            if (!self->open_ || self->closing_) return;
            self->closing_ = true;
            self->pending_close_ = websocket::close_reason(static_cast<websocket::close_code>(code), reason);
            if (self->queue_.empty()) self->do_close();
        });
    }

    void terminate() override {
        asio::post(ws_.get_executor(), [self = shared_from_this()] {
            beast::error_code ec;
            beast::get_lowest_layer(self->ws_).socket().close(ec);
            self->finish();
        });
    }

    [[nodiscard]] bool is_open() const override { return open_.load(); }

    void accept_async(bhttp::request<bhttp::string_body> req, WsAcceptOptions options,
                      std::function<void(std::shared_ptr<WsConnection>)> on_open) {
        ws_.read_message_max(options.max_message_bytes);
        websocket::stream_base::timeout t{};
        t.handshake_timeout = std::chrono::seconds(30);
        t.idle_timeout = options.idle_timeout;
        t.keep_alive_pings = true;
        ws_.set_option(t);
        ws_.auto_fragment(false);
        beast::get_lowest_layer(ws_).expires_never();
        ws_.async_accept(req, [self = shared_from_this(), on_open = std::move(on_open)](beast::error_code ec) {
            if (ec) {
                self->open_ = false;
                return;
            }
            self->open_ = true;
            on_open(self);
        });
    }

private:
    void do_read() {
        ws_.async_read(buffer_, [self = shared_from_this()](beast::error_code ec, std::size_t) {
            if (ec) {
                self->finish();
                return;
            }
            std::string data = beast::buffers_to_string(self->buffer_.data());
            const bool binary = self->ws_.got_binary();
            self->buffer_.consume(self->buffer_.size());
            if (self->on_message_) self->on_message_(std::move(data), binary);
            self->do_read();
        });
    }

    void do_write() {
        ws_.text(true);
        ws_.async_write(asio::buffer(queue_.front()), [self = shared_from_this()](beast::error_code ec, std::size_t) {
            if (ec) {
                self->finish();
                return;
            }
            self->queue_.pop_front();
            if (!self->queue_.empty()) {
                self->do_write();
            } else if (self->closing_) {
                self->do_close();
            }
        });
    }

    void do_close() {
        ws_.async_close(pending_close_, [self = shared_from_this()](beast::error_code) { self->finish(); });
    }

    void finish() {
        if (finished_) return;
        finished_ = true;
        open_ = false;
        queue_.clear();
        if (on_close_) {
            auto cb = std::move(on_close_);
            on_close_ = nullptr;
            cb();
        }
        on_message_ = nullptr;
    }

    websocket::stream<beast::tcp_stream> ws_;
    beast::flat_buffer buffer_;
    std::deque<std::string> queue_;
    MessageHandler on_message_;
    CloseHandler on_close_;
    std::atomic<bool> open_{false};
    bool closing_ = false;
    bool finished_ = false;
    websocket::close_reason pending_close_;
    std::shared_ptr<void> token_;  // 同時接続数の課金 (破棄で返す)
};

}  // namespace

// ---- HTTP session -----------------------------------------------------------------------------

struct HttpServer::Impl : std::enable_shared_from_this<HttpServer::Impl> {
    asio::io_context& ioc;
    std::string host;
    std::uint16_t port;
    HttpServerOptions options;
    RequestHandler on_request;
    UpgradeHandler on_upgrade;
    std::optional<tcp::acceptor> acceptor;
    std::atomic<std::size_t> connections{0};
    std::atomic<bool> stopped{false};

    Impl(asio::io_context& c, std::string h, std::uint16_t p, HttpServerOptions o, RequestHandler r, UpgradeHandler u)
        : ioc(c), host(std::move(h)), port(p), options(std::move(o)), on_request(std::move(r)),
          on_upgrade(std::move(u)) {}

    void do_accept();
};

namespace {

class Session;

class Upgrade final : public PendingUpgrade {
public:
    Upgrade(std::shared_ptr<Session> session, http::Request req, bhttp::request<bhttp::string_body> raw)
        : session_(std::move(session)), req_(std::move(req)), raw_(std::move(raw)) {}
    ~Upgrade() override;
    [[nodiscard]] const http::Request& request() const override { return req_; }
    void reject(int status) override;
    void accept(WsAcceptOptions options, std::function<void(std::shared_ptr<WsConnection>)> on_open) override;

private:
    std::shared_ptr<Session> session_;
    http::Request req_;
    bhttp::request<bhttp::string_body> raw_;
    std::atomic<bool> decided_{false};
};

class Session : public std::enable_shared_from_this<Session> {
public:
    Session(tcp::socket socket, std::shared_ptr<HttpServer::Impl> server, std::shared_ptr<void> token)
        : stream_(std::move(socket)), server_(std::move(server)), token_(std::move(token)) {
        beast::error_code ec;
        const auto ep = stream_.socket().remote_endpoint(ec);
        if (!ec) remote_ = ep.address().to_string();
    }

    void run() {
        asio::dispatch(stream_.get_executor(), [self = shared_from_this()] { self->read_header(true); });
    }

    void write_response(http::Response res, bool keep_alive) {
        asio::post(stream_.get_executor(),
                   [self = shared_from_this(), res = std::move(res), keep_alive]() mutable {
                       self->do_write(std::move(res), keep_alive);
                   });
    }

    void write_raw_and_close(std::string data) {
        asio::post(stream_.get_executor(), [self = shared_from_this(), data = std::move(data)]() mutable {
            self->raw_ = std::move(data);
            self->stream_.expires_after(std::chrono::seconds(10));
            asio::async_write(self->stream_, asio::buffer(self->raw_), [self](beast::error_code, std::size_t) {
                beast::error_code ec;
                self->stream_.socket().shutdown(tcp::socket::shutdown_both, ec);
                self->stream_.socket().close(ec);
            });
        });
    }

    void close_now() {
        asio::post(stream_.get_executor(), [self = shared_from_this()] {
            beast::error_code ec;
            self->stream_.socket().close(ec);
        });
    }

    void accept_ws(bhttp::request<bhttp::string_body> raw, WsAcceptOptions options,
                   std::function<void(std::shared_ptr<WsConnection>)> on_open) {
        asio::post(stream_.get_executor(), [self = shared_from_this(), raw = std::move(raw), options,
                                            on_open = std::move(on_open)]() mutable {
            auto ws = std::make_shared<ServerWs>(websocket::stream<beast::tcp_stream>(std::move(self->stream_)),
                                                 self->token_);
            ws->accept_async(std::move(raw), options, std::move(on_open));
        });
    }

    const std::string& remote() const { return remote_; }

private:
    void read_header(bool first) {
        parser_.emplace();
        parser_->header_limit(static_cast<std::uint32_t>(server_->options.header_limit));
        parser_->body_limit(boost::none);
        stream_.expires_after(first ? server_->options.header_timeout : server_->options.keep_alive_timeout);
        bhttp::async_read_header(stream_, buffer_, *parser_,
                                 [self = shared_from_this()](beast::error_code ec, std::size_t) {
                                     self->on_header(ec);
                                 });
    }

    void on_header(beast::error_code ec) {
        if (ec == bhttp::error::header_limit) {
            write_raw_and_close("HTTP/1.1 431 Request Header Fields Too Large\r\nConnection: close\r\n\r\n");
            return;
        }
        if (ec) {
            beast::error_code ignored;
            stream_.socket().close(ignored);
            return;
        }
        auto& msg = parser_->get();
        if (websocket::is_upgrade(msg)) {
            stream_.expires_never();
            http::Request req = to_request(msg, remote_);
            // upgrade 要求にも予算を作ってヘッダを課金する (本文は無い。フレームはメッセージごとの予算)。
            auto limits = http::request_budget_limits({server_->options.header_limit, 0});
            if (limits) req.budget.emplace(*limits);
            if (!req.budget || !http::charge_headers(*req.budget, req.headers.items())) {
                write_raw_and_close("HTTP/1.1 431 Request Header Fields Too Large\r\nConnection: close\r\n\r\n");
                return;
            }
            auto up = std::make_shared<Upgrade>(shared_from_this(), std::move(req), parser_->release());
            server_->on_upgrade(up);
            return;
        }
        http::Request probe = to_request(msg, remote_);
        std::size_t limit = server_->options.default_body_limit;
        if (server_->options.body_limit_for) limit = server_->options.body_limit_for(probe);
        limit_ = limit;
        // 要求 1 つに予算 1 つ (Lorica)。ヘッダをここで課金し、本文と本文の JSON も同じ予算から引く。
        budget_.reset();
        if (auto limits = http::request_budget_limits({server_->options.header_limit, limit})) budget_.emplace(*limits);
        if (!budget_ || !http::charge_headers(*budget_, probe.headers.items())) {
            write_raw_and_close("HTTP/1.1 431 Request Header Fields Too Large\r\nConnection: close\r\n\r\n");
            return;
        }
        // Content-Length が上限を超えていれば本文を読まずに上限超過として扱う
        // (Beast の body_limit はヘッダ解析後に設定すると Content-Length には効かないため自前で比べる)。
        if (auto len = parser_->content_length(); len && *len > limit) {
            on_body(bhttp::error::body_limit);
            return;
        }
        parser_->body_limit(limit);
        stream_.expires_after(server_->options.request_timeout);
        bhttp::async_read(stream_, buffer_, *parser_, [self = shared_from_this()](beast::error_code e, std::size_t) {
            self->on_body(e);
        });
    }

    void on_body(beast::error_code ec) {
        bool too_large = false;
        if (ec == bhttp::error::body_limit || (!ec && parser_->get().body().size() > limit_)) {
            too_large = true;
        } else if (ec) {
            beast::error_code ignored;
            stream_.socket().close(ignored);
            return;
        }
        stream_.expires_never();
        auto& msg = parser_->get();
        http::Request req = to_request(msg, remote_);
        if (!too_large && budget_ && !http::charge_body(*budget_, req.body)) too_large = true;
        req.body_too_large = too_large;
        if (too_large) req.body.clear();
        req.budget = std::move(budget_);
        budget_.reset();
        const bool keep_alive = !too_large && msg.keep_alive();
        const bool head = req.method == "HEAD";
        head_ = head;
        version_ = msg.version();
        server_->on_request(std::move(req), [self = shared_from_this(), keep_alive](http::Response res) {
            self->write_response(std::move(res), keep_alive);
        });
    }

    void do_write(http::Response res, bool keep_alive) {
        auto out = std::make_shared<bhttp::response<bhttp::string_body>>();
        out->version(version_);
        out->result(static_cast<unsigned>(res.status));
        for (const auto& [k, v] : res.headers.items()) out->insert(k, v);
        out->keep_alive(keep_alive);
        if (head_) {
            out->content_length(res.body.size());
        } else if (res.status != 204 && res.status != 304) {
            out->body() = std::move(res.body);
            out->prepare_payload();
        }
        stream_.expires_after(std::chrono::seconds(60));
        if (head_) {
            auto sr = std::make_shared<bhttp::response_serializer<bhttp::string_body>>(*out);
            bhttp::async_write_header(stream_, *sr, [self = shared_from_this(), out, sr, keep_alive](beast::error_code ec, std::size_t) {
                self->after_write(ec, keep_alive);
            });
            return;
        }
        bhttp::async_write(stream_, *out, [self = shared_from_this(), out, keep_alive](beast::error_code ec, std::size_t) {
            self->after_write(ec, keep_alive);
        });
    }

    void after_write(beast::error_code ec, bool keep_alive) {
        if (ec || !keep_alive || server_->stopped) {
            beast::error_code ignored;
            stream_.socket().shutdown(tcp::socket::shutdown_send, ignored);
            stream_.socket().close(ignored);
            return;
        }
        read_header(false);
    }

    beast::tcp_stream stream_;
    beast::flat_buffer buffer_;
    std::optional<bhttp::request_parser<bhttp::string_body>> parser_;
    std::shared_ptr<HttpServer::Impl> server_;
    std::shared_ptr<void> token_;
    std::string remote_;
    std::string raw_;
    bool head_ = false;
    unsigned version_ = 11;
    std::size_t limit_ = 0;
    std::optional<lorica::input_budget> budget_;
};

Upgrade::~Upgrade() {
    if (!decided_.exchange(true)) session_->close_now();
}

void Upgrade::reject(int status) {
    if (decided_.exchange(true)) return;
    std::string line = "HTTP/1.1 " + std::to_string(status) + " " + std::string(http::reason_phrase(status)) + "\r\n\r\n";
    session_->write_raw_and_close(std::move(line));
}

void Upgrade::accept(WsAcceptOptions options, std::function<void(std::shared_ptr<WsConnection>)> on_open) {
    if (decided_.exchange(true)) return;
    session_->accept_ws(std::move(raw_), options, std::move(on_open));
}

}  // namespace

void HttpServer::Impl::do_accept() {
    acceptor->async_accept(asio::make_strand(ioc), [self = shared_from_this()](beast::error_code ec, tcp::socket socket) {
        if (self->stopped) return;
        if (!ec) {
            if (self->connections.fetch_add(1) >= self->options.max_connections) {
                // 上限を超えた接続は受け付けずに切る (待たせない)。
                self->connections.fetch_sub(1);
                beast::error_code ignored;
                socket.close(ignored);
            } else {
                // 接続 (HTTP でも WebSocket でも) が生きている間だけ数える。
                std::shared_ptr<void> token(nullptr, [server = self](void*) { server->connections.fetch_sub(1); });
                std::make_shared<Session>(std::move(socket), self, std::move(token))->run();
            }
        }
        self->do_accept();
    });
}

HttpServer::HttpServer(asio::io_context& ioc, std::string host, std::uint16_t port, HttpServerOptions options,
                       RequestHandler on_request, UpgradeHandler on_upgrade)
    : impl_(std::make_shared<Impl>(ioc, std::move(host), port, std::move(options), std::move(on_request),
                                   std::move(on_upgrade))) {}

HttpServer::~HttpServer() { stop(); }

void HttpServer::start() {
    const auto address = asio::ip::make_address(impl_->host == "localhost" ? "127.0.0.1" : impl_->host);
    tcp::endpoint ep(address, impl_->port);
    impl_->acceptor.emplace(asio::make_strand(impl_->ioc));
    impl_->acceptor->open(ep.protocol());
    impl_->acceptor->set_option(asio::socket_base::reuse_address(true));
    impl_->acceptor->bind(ep);
    impl_->acceptor->listen(asio::socket_base::max_listen_connections);
    impl_->do_accept();
}

void HttpServer::stop() {
    if (!impl_ || impl_->stopped.exchange(true)) return;
    if (impl_->acceptor) {
        asio::post(impl_->acceptor->get_executor(), [impl = impl_] {
            beast::error_code ec;
            impl->acceptor->close(ec);
        });
    }
}

std::uint16_t HttpServer::port() const {
    return impl_->acceptor ? impl_->acceptor->local_endpoint().port() : impl_->port;
}

}  // namespace tr::io
