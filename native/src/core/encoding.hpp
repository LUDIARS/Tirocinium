#pragma once
// base64 / base64url / hex。暗号ではない符号化なので自前で持つ (OpenSSL の BIO を使うより単純で検査しやすい)。

#include <optional>
#include <string>
#include <string_view>

namespace tr {

std::string base64_encode(std::string_view bytes);
std::string base64url_encode(std::string_view bytes);  // パディングなし (Node の 'base64url')

// 厳密な base64url (パディングなし・余分な文字なし)。PASETO のトークンに使う。
std::optional<std::string> base64url_decode_strict(std::string_view text);
// 厳密な base64 (= パディング可、空白なし)。
std::optional<std::string> base64_decode_strict(std::string_view text);
// Node の Buffer.from(x, 'base64') と同じく寛容 (英数・+/-_ 以外を無視し、'=' で止まる)。
std::string base64_decode_lenient(std::string_view text);

std::string hex_encode(std::string_view bytes);

}  // namespace tr
