#pragma once
// hono の app.route / use / get と同じ「登録順に照合し、最初に応答を返したものが勝つ」ルータ。
// - パターンは "/api/v1/sessions/:id/summary" の形。":name" は 1 セグメント ([^/]+)。
// - "/prefix/*" は "/prefix" 自身と "/prefix/..." の両方に一致する (hono の use('*') と同じ)。
// - middleware は応答を返せば打ち切り、nullopt なら次へ進む (next())。
// - どれも応答しなければ 404 {"error":"not_found"}。

#include <functional>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

#include "http/message.hpp"

namespace tr::http {

// 要求ごとの状態 (認証済みの利用者など)。ルートの外から触らない。
struct Context {
    std::optional<std::string> user_id;
};

using Handler = std::function<Response(Request&, Context&)>;
using Middleware = std::function<std::optional<Response>(Request&, Context&)>;

class Router {
public:
    void get(std::string pattern, Handler h) { add("GET", std::move(pattern), std::move(h)); }
    void post(std::string pattern, Handler h) { add("POST", std::move(pattern), std::move(h)); }
    void put(std::string pattern, Handler h) { add("PUT", std::move(pattern), std::move(h)); }
    void del(std::string pattern, Handler h) { add("DELETE", std::move(pattern), std::move(h)); }
    void add(std::string method, std::string pattern, Handler h);
    // 指定パターン (末尾 "/*" 可) に一致する全メソッドの要求に middleware を掛ける。
    void use(std::string pattern, Middleware mw);
    // 1 つのルートだけに middleware を掛ける (hono の app.post('/x', mw, handler))。
    void add_with(std::string method, std::string pattern, Middleware mw, Handler h);

    // HEAD は GET として照合し、本文を捨てる。
    [[nodiscard]] Response dispatch(Request& req, Context& ctx) const;

    // パターン照合 (テスト用に公開)。一致すれば params を埋めて true。
    static bool match(std::string_view pattern, std::string_view path, std::map<std::string, std::string>& params);

private:
    struct Entry {
        std::string method;  // 空 = 全メソッド (middleware)
        std::string pattern;
        Middleware middleware;
        Handler handler;
    };
    std::vector<Entry> entries_;
};

}  // namespace tr::http
