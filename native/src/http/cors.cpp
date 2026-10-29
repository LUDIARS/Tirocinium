#include "http/cors.hpp"

#include "core/text.hpp"

namespace tr::http {
namespace {

bool is_regex_space(char c) { return c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\f' || c == '\v'; }

// "a , b,c ".split(/\s*,\s*/) と同じ: 区切りに隣接する空白だけを除き、先頭要素の先頭・最終要素の末尾は残す。
std::vector<std::string> split_comma_list(const std::string& s) {
    std::vector<std::string> parts;
    std::string current;
    for (std::size_t i = 0; i <= s.size(); ++i) {
        if (i < s.size() && s[i] != ',') {
            current.push_back(s[i]);
            continue;
        }
        const bool is_first = parts.empty();
        const bool is_last = i == s.size();
        std::size_t b = 0;
        std::size_t e = current.size();
        if (!is_first) {
            while (b < e && is_regex_space(current[b])) ++b;
        }
        if (!is_last) {
            while (e > b && is_regex_space(current[e - 1])) --e;
        }
        parts.push_back(current.substr(b, e - b));
        current.clear();
    }
    return parts;
}

}  // namespace

Response with_cors(const Request& req, const std::function<Response()>& next) {
    if (req.method == "OPTIONS") {
        Response r;
        r.status = 204;
        r.headers.set("access-control-allow-origin", "*");
        r.headers.set("access-control-allow-methods", "GET,HEAD,PUT,POST,DELETE,PATCH");
        if (auto requested = req.header("access-control-request-headers"); requested && !requested->empty()) {
            r.headers.set("access-control-allow-headers", join(split_comma_list(*requested), ","));
            r.headers.append("vary", "Access-Control-Request-Headers");
        }
        return r;
    }
    Response r = next();
    r.headers.set("access-control-allow-origin", "*");
    return r;
}

}  // namespace tr::http
