#include "http/message.hpp"

#include "core/text.hpp"

namespace tr::http {

void Headers::set(std::string_view name, std::string value) {
    remove(name);
    items_.emplace_back(ascii_lower(name), std::move(value));
}

void Headers::append(std::string_view name, std::string value) {
    const std::string key = ascii_lower(name);
    for (auto& [k, v] : items_) {
        if (k == key) {
            v += ", ";
            v += value;
            return;
        }
    }
    items_.emplace_back(key, std::move(value));
}

void Headers::remove(std::string_view name) {
    const std::string key = ascii_lower(name);
    std::erase_if(items_, [&](const auto& kv) { return kv.first == key; });
}

std::optional<std::string> Headers::get(std::string_view name) const {
    const std::string key = ascii_lower(name);
    for (const auto& [k, v] : items_) {
        if (k == key) return v;
    }
    return std::nullopt;
}

namespace {

int hex_value(char c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}

// %XX を復号する。keep_reserved=true なら decodeURI と同じく予約文字は復号しない。
std::optional<std::string> percent_decode(std::string_view s, bool keep_reserved) {
    static constexpr std::string_view reserved = ";/?:@&=+$,#";
    std::string out;
    out.reserve(s.size());
    for (std::size_t i = 0; i < s.size(); ++i) {
        if (s[i] != '%') {
            out.push_back(s[i]);
            continue;
        }
        if (i + 2 >= s.size()) return std::nullopt;
        const int hi = hex_value(s[i + 1]);
        const int lo = hex_value(s[i + 2]);
        if (hi < 0 || lo < 0) return std::nullopt;
        const char c = static_cast<char>(hi * 16 + lo);
        if (keep_reserved && static_cast<unsigned char>(c) < 0x80 && reserved.find(c) != std::string_view::npos) {
            out.append(s.substr(i, 3));
        } else {
            out.push_back(c);
        }
        i += 2;
    }
    // decodeURIComponent は不正な UTF-8 で URIError を投げる。
    if (!is_valid_utf8(out)) return std::nullopt;
    return out;
}

}  // namespace

std::string decode_uri_component(std::string_view s) {
    if (s.find('%') == std::string_view::npos) return std::string(s);
    auto r = percent_decode(s, false);
    return r ? *r : std::string(s);
}

std::string decode_uri(std::string_view s) {
    if (s.find('%') == std::string_view::npos) return std::string(s);
    auto r = percent_decode(s, true);
    return r ? *r : std::string(s);
}

std::string encode_uri_component(std::string_view s) {
    static constexpr char hex[] = "0123456789ABCDEF";
    std::string out;
    for (unsigned char c : s) {
        if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-' || c == '_' ||
            c == '.' || c == '!' || c == '~' || c == '*' || c == '\'' || c == '(' || c == ')') {
            out.push_back(static_cast<char>(c));
        } else {
            out.push_back('%');
            out.push_back(hex[c >> 4]);
            out.push_back(hex[c & 0xF]);
        }
    }
    return out;
}

void split_target(std::string_view target, std::string& path, std::string& raw_query) {
    const auto q = target.find('?');
    std::string_view p = target.substr(0, q);
    raw_query = q == std::string_view::npos ? std::string() : std::string(target.substr(q + 1));
    // hono の getPath: '%25' は decodeURI 前に '%2525' にして二重復号を防ぐ。
    std::string tmp(p);
    if (tmp.find("%25") != std::string::npos) {
        std::string escaped;
        for (std::size_t i = 0; i < tmp.size(); ++i) {
            if (tmp.compare(i, 3, "%25") == 0) {
                escaped += "%2525";
                i += 2;
            } else {
                escaped.push_back(tmp[i]);
            }
        }
        tmp = std::move(escaped);
    }
    path = decode_uri(tmp);
}

namespace {

std::string decode_query_value(std::string_view v) {
    if (v.find_first_of("%+") == std::string_view::npos) return std::string(v);
    std::string s(v);
    for (auto& c : s) {
        if (c == '+') c = ' ';
    }
    return decode_uri_component(s);
}

}  // namespace

std::optional<std::string> Request::query(std::string_view key) const {
    for (const auto& part : split(raw_query, '&')) {
        if (part.empty()) continue;
        const auto eq = part.find('=');
        const std::string name = decode_query_value(std::string_view(part).substr(0, eq));
        if (name != key) continue;
        if (eq == std::string::npos) return std::string();
        return decode_query_value(std::string_view(part).substr(eq + 1));
    }
    return std::nullopt;
}

std::vector<std::pair<std::string, std::string>> Request::query_all() const {
    std::vector<std::pair<std::string, std::string>> out;
    for (const auto& part : split(raw_query, '&')) {
        if (part.empty()) continue;
        const auto eq = part.find('=');
        std::string name = decode_query_value(std::string_view(part).substr(0, eq));
        std::string value = eq == std::string::npos ? std::string() : decode_query_value(std::string_view(part).substr(eq + 1));
        bool seen = false;
        for (const auto& kv : out) {
            if (kv.first == name) seen = true;
        }
        if (!seen) out.emplace_back(std::move(name), std::move(value));
    }
    return out;
}

std::string Request::param(std::string_view name) const {
    auto it = params.find(std::string(name));
    return it == params.end() ? std::string() : it->second;
}

Response Response::json(const Json& value, int status) {
    Response r;
    r.status = status;
    r.headers.set("content-type", "application/json");
    r.body = js_stringify(value);
    return r;
}

Response Response::text(std::string body, int status) {
    return raw(std::move(body), "text/plain; charset=UTF-8", status);
}

Response Response::html(std::string body, int status) {
    return raw(std::move(body), "text/html; charset=UTF-8", status);
}

Response Response::raw(std::string body, std::string content_type, int status) {
    Response r;
    r.status = status;
    r.headers.set("content-type", std::move(content_type));
    r.body = std::move(body);
    return r;
}

std::string_view reason_phrase(int status) {
    switch (status) {
        case 101: return "Switching Protocols";
        case 200: return "OK";
        case 201: return "Created";
        case 202: return "Accepted";
        case 204: return "No Content";
        case 400: return "Bad Request";
        case 401: return "Unauthorized";
        case 403: return "Forbidden";
        case 404: return "Not Found";
        case 409: return "Conflict";
        case 413: return "Payload Too Large";
        case 415: return "Unsupported Media Type";
        case 429: return "Too Many Requests";
        case 431: return "Request Header Fields Too Large";
        case 500: return "Internal Server Error";
        case 501: return "Not Implemented";
        case 502: return "Bad Gateway";
        case 503: return "Service Unavailable";
        default: return "Unknown";
    }
}

}  // namespace tr::http
