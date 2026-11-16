#include "db/pg_range.hpp"

#include <cctype>
#include <charconv>

#include <lorica/checked_integer.hpp>

namespace tr::db {
namespace {

// sscanf の %d と同じく、前の空白と '+' / '-' を受け付けて 10 進の int を 1 つ読む。
std::optional<int> read_int(std::string_view& rest) {
    std::size_t pos = 0;
    while (pos < rest.size() && std::isspace(static_cast<unsigned char>(rest[pos]))) ++pos;
    if (pos < rest.size() && rest[pos] == '+') {  // from_chars は '+' を読まない
        ++pos;
        if (pos < rest.size() && rest[pos] == '-') return std::nullopt;  // "+-1" は %d でも読めない
    }
    int value = 0;
    const char* first = rest.data() + pos;
    const char* last = rest.data() + rest.size();
    const auto [ptr, ec] = std::from_chars(first, last, value);
    if (ec != std::errc()) return std::nullopt;
    rest.remove_prefix(static_cast<std::size_t>(ptr - rest.data()));
    return value;
}

}  // namespace

std::optional<std::pair<int, int>> parse_int4range_closed(std::string_view text) {
    if (text.empty()) return std::nullopt;
    std::string_view rest = text.substr(1);
    const auto lo = read_int(rest);
    if (!lo || rest.empty() || rest.front() != ',') return std::nullopt;
    rest.remove_prefix(1);
    const auto hi = read_int(rest);
    if (!hi) return std::nullopt;
    if (text.back() != ')') return std::pair{*lo, *hi};
    const auto closed_hi = lorica::checked_subtract(*hi, 1);
    if (!closed_hi) return std::nullopt;
    return std::pair{*lo, *closed_hi};
}

}  // namespace tr::db
