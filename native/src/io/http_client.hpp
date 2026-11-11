#pragma once
// 外向きの HTTP/HTTPS (Beast + OpenSSL)。呼び出しは同期 (ワーカースレッドから使う) で、内部は要求ごとの
// io_context で動かし、全体の期限で打ち切る。
// - 期限: 名前解決・接続・TLS・送受信を含む全体 (timeout)。超えたら HttpClientError("timeout")。
// - 応答の大きさ: ヘッダ 64 KiB、本文 max_response_bytes (超えたら "too_large")。
// - 圧縮: Accept-Encoding: identity を送り、Content-Encoding 付きの応答は "unsupported_encoding" で拒否する
//   (Brotli / gzip の展開器を持たない = 展開後の大きさの攻撃面が無い)。
// - TLS: 証明書とホスト名を必ず検証する (OS の信頼ストア)。
// - public_only: SSRF 判定。解決した全 IP を検査し、検査した IP にそのまま接続する (再解決しない)。
//   リダイレクトは手動で追い、各ホップで同じ検査をする。

#include <chrono>
#include <cstdint>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

#include "http/message.hpp"

namespace tr::io {

class HttpClientError : public std::runtime_error {
public:
    HttpClientError(std::string code, const std::string& detail)
        : std::runtime_error(code + (detail.empty() ? "" : ": " + detail)), code_(std::move(code)) {}
    // invalid_url / blocked / dns / connect / tls / timeout / too_large / unsupported_encoding /
    // protocol / too_many_redirects
    [[nodiscard]] const std::string& code() const { return code_; }

private:
    std::string code_;
};

struct HttpClientRequest {
    std::string method = "GET";
    std::string url;
    std::vector<std::pair<std::string, std::string>> headers;
    std::string body;
    std::chrono::milliseconds timeout{10'000};
    std::size_t max_response_bytes = 8 * 1024 * 1024;
    bool public_only = false;
    int max_redirects = 0;
};

struct HttpClientResponse {
    int status = 0;
    http::Headers headers;
    std::string body;
    std::string final_url;
    [[nodiscard]] bool ok() const { return status >= 200 && status < 300; }
};

HttpClientResponse http_fetch(const HttpClientRequest& request);

// テスト用: 信頼する CA を追加する (PEM)。
void http_client_add_trusted_ca(const std::string& pem);

}  // namespace tr::io
