#include "http/router.hpp"

#include "core/text.hpp"

namespace tr::http {

void Router::add(std::string method, std::string pattern, Handler h) {
    entries_.push_back(Entry{std::move(method), std::move(pattern), nullptr, std::move(h)});
}

void Router::use(std::string pattern, Middleware mw) {
    entries_.push_back(Entry{"", std::move(pattern), std::move(mw), nullptr});
}

void Router::add_with(std::string method, std::string pattern, Middleware mw, Handler h) {
    Handler combined = [mw = std::move(mw), h = std::move(h)](Request& req, Context& ctx) -> Response {
        if (auto early = mw(req, ctx)) return std::move(*early);
        return h(req, ctx);
    };
    add(std::move(method), std::move(pattern), std::move(combined));
}

bool Router::match(std::string_view pattern, std::string_view path, std::map<std::string, std::string>& params) {
    std::map<std::string, std::string> found;
    bool wildcard = false;
    if (ends_with(pattern, "/*")) {
        wildcard = true;
        pattern.remove_suffix(2);
    } else if (pattern == "*") {
        return true;
    }
    std::size_t pi = 0;
    std::size_t si = 0;
    while (pi < pattern.size()) {
        if (pattern[pi] != '/' || si >= path.size() || path[si] != '/') return false;
        ++pi;
        ++si;
        const auto pend = pattern.find('/', pi);
        const std::string_view pseg = pattern.substr(pi, pend == std::string_view::npos ? std::string_view::npos : pend - pi);
        const auto send = path.find('/', si);
        const std::string_view sseg = path.substr(si, send == std::string_view::npos ? std::string_view::npos : send - si);
        if (!pseg.empty() && pseg[0] == ':') {
            if (sseg.empty()) return false;
            found[std::string(pseg.substr(1))] = decode_uri_component(sseg);
        } else if (pseg != sseg) {
            return false;
        }
        pi += pseg.size();
        si += sseg.size();
    }
    if (si != path.size()) {
        // "/prefix/*" は残りが "/..." のときだけ一致する。
        if (!wildcard || path[si] != '/') return false;
    }
    params = std::move(found);
    return true;
}

Response Router::dispatch(Request& req, Context& ctx) const {
    const bool head = req.method == "HEAD";
    const std::string method = head ? std::string("GET") : req.method;
    for (const auto& e : entries_) {
        if (!e.method.empty() && e.method != method) continue;
        std::map<std::string, std::string> params;
        if (!match(e.pattern, req.path, params)) continue;
        req.params = std::move(params);
        if (e.middleware) {
            if (auto early = e.middleware(req, ctx)) {
                if (head) early->body.clear();
                return std::move(*early);
            }
            continue;
        }
        Response res = e.handler(req, ctx);
        if (head) res.body.clear();
        return res;
    }
    Response res = Response::json(Json{{"error", "not_found"}}, 404);
    if (head) res.body.clear();
    return res;
}

}  // namespace tr::http
