#pragma once
// UTF-8 の文字列を JS の文字列と同じ規則で扱うための補助 (JS は UTF-16 の単位で長さ・切り出しを数える)。

#include <cstddef>
#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

namespace tr {

// 不正な UTF-8 の列を U+FFFD に置き換える (TextDecoder の既定と同じ)。
std::string sanitize_utf8(std::string_view s);
bool is_valid_utf8(std::string_view s);

// UTF-8 → コードポイント列 (不正な列は U+FFFD)。
std::vector<char32_t> decode_utf8(std::string_view s);
void append_utf8(std::string& out, char32_t cp);
std::string encode_utf8(const std::vector<char32_t>& cps);

// JS の string.length (UTF-16 の単位数)。
std::size_t utf16_length(std::string_view s);
// JS の s.slice(start, end) (UTF-16 単位)。サロゲート対を割る位置は対の手前で切る。
std::string utf16_slice(std::string_view s, std::size_t start, std::size_t end);

// JS の String.prototype.trim() の空白 (WhiteSpace + LineTerminator)。
bool is_js_space(char32_t cp);
std::string js_trim(std::string_view s);
std::string js_trim_start(std::string_view s);
std::string js_trim_end(std::string_view s);

// JS の toLowerCase() (ASCII・ラテン 1・ラテン拡張 A・ギリシャ・キリル・全角英字の範囲)。
std::string js_to_lower(std::string_view s);
std::string ascii_lower(std::string_view s);

bool starts_with(std::string_view s, std::string_view prefix);
bool ends_with(std::string_view s, std::string_view suffix);
std::vector<std::string> split(std::string_view s, char sep);
// s.split(',').map(trim).filter(Boolean)
std::vector<std::string> split_trim_nonempty(std::string_view s, char sep);
std::string join(const std::vector<std::string>& parts, std::string_view sep);

// /^[0-9a-f]{n}$/ 等の小さな検査。
bool is_lower_hex(std::string_view s, std::size_t length);
bool all_of_chars(std::string_view s, std::string_view allowed_extra, bool alnum);

}  // namespace tr
