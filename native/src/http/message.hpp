#pragma once
// ネットワークから切り離した HTTP の要求・応答。ルートのハンドラはこの型だけを扱うので、
// ソケット無しで単体テストできる。

#include <map>
#include <optional>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "core/json.hpp"

namespace tr::http {

// 名前は小文字で持つ (HTTP ヘッダは大文字小文字を区別しない)。
class Headers {
public:
    void set(std::string_view name, std::string value);
    void append(std::string_view name, std::string value);
    void remove(std::string_view name);
    [[nodiscard]] std::optional<std::string> get(std::string_view name) const;
    [[nodiscard]] bool has(std::string_view name) const { return get(name).has_value(); }
    [[nodiscard]] const std::vector<std::pair<std::string, std::string>>& items() const { return items_; }

private:
    std::vector<std::pair<std::string, std::string>> items_;
};

struct Request {
    std::string method;      // 大文字 (GET/POST/...)
    std::string target;      // 生の要求ターゲット ("/path?query")
    std::string path;        // decodeURI 済みのパス (hono の getPath と同じ)
    std::string raw_query;   // '?' の後ろ (生)
    Headers headers;
    std::string body;
    std::string remote_address;
    std::map<std::string, std::string> params;  // ルートの :name
    // 本文が経路の上限を超えた (本文は途中まで)。上位が 413 を返し、接続は応答後に閉じる。
    bool body_too_large = false;
    // この要求の Lorica 予算 (http/request_budget.hpp)。受け口がヘッダを読んだ時点で作り、ヘッダ・本文・
    // 本文の JSON の読み取りまで同じ予算から差し引く。要求と一緒に 1 つのスレッドへ渡るだけで、共有しない。
    std::optional<lorica::input_budget> budget;

    // c.req.query('key'): 最初の値 ('+' は空白、%XX を復号)。
    [[nodiscard]] std::optional<std::string> query(std::string_view key) const;
    // c.req.query(): 全キー (同じキーは最初の値)。
    [[nodiscard]] std::vector<std::pair<std::string, std::string>> query_all() const;
    [[nodiscard]] std::optional<std::string> header(std::string_view name) const { return headers.get(name); }
    [[nodiscard]] std::string param(std::string_view name) const;
};

struct Response {
    int status = 200;
    Headers headers;
    std::string body;

    // c.json(value, status): Content-Type は hono 4 と同じ "application/json"。
    static Response json(const Json& value, int status = 200);
    // c.text(...): "text/plain; charset=UTF-8"
    static Response text(std::string body, int status = 200);
    // c.html(...): "text/html; charset=UTF-8"
    static Response html(std::string body, int status = 200);
    static Response raw(std::string body, std::string content_type, int status = 200);
};

// 要求ターゲットを path / query に分け、path を decodeURI する。
void split_target(std::string_view target, std::string& path, std::string& raw_query);
// decodeURIComponent (失敗したら元の文字列)。
std::string decode_uri_component(std::string_view s);
// decodeURI (予約文字 ;/?:@&=+$,# の %XX は残す。失敗したら元の文字列)。
std::string decode_uri(std::string_view s);
// encodeURIComponent
std::string encode_uri_component(std::string_view s);

std::string_view reason_phrase(int status);

}  // namespace tr::http
