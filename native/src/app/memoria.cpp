#include "app/memoria.hpp"

#include "core/text.hpp"

namespace tr::app {

std::optional<std::string> memoria_base_url(const Services& s) {
    for (const auto& [k, v] : s.env) {
        if (k == "MEMORIA_URL" && !v.empty()) {
            std::string u = v;
            if (u.back() == '/') u.pop_back();
            return u;
        }
    }
    return std::nullopt;
}

Json memoria_rag(const Services& s, const std::string& user_id, const std::string& query,
                 const std::vector<std::string>& kinds, const std::optional<std::vector<std::string>>& tags, int top_k) {
    auto base = memoria_base_url(s);
    if (!base) throw std::runtime_error("MEMORIA_URL is not set");
    io::HttpClientRequest req;
    req.method = "POST";
    req.url = *base + "/api/v1/tirocinium/rag/search";
    req.headers = {{"content-type", "application/json"}};
    for (const auto& [k, v] : s.env) {
        if (k == "MEMORIA_PROJECT_TOKEN" && !v.empty()) req.headers.emplace_back("authorization", "Bearer " + v);
    }
    Json filter{{"kinds", kinds}};
    if (tags) filter["tags"] = *tags;
    req.body = js_stringify(Json{{"user_id", user_id}, {"query", query}, {"filter", filter}, {"topK", top_k}});
    req.timeout = std::chrono::milliseconds(15'000);
    req.max_response_bytes = 4 * 1024 * 1024;
    auto res = s.fetch(req);
    if (!res.ok()) throw std::runtime_error("memoria rag failed: " + std::to_string(res.status));
    auto body = parse_json(res.body);
    if (!body) throw std::runtime_error("memoria rag: invalid JSON");
    return *body;
}

std::string render_rag_block(const Json& result) {
    const Json* items = member(result, "items");
    if (!items || !items->is_array() || items->empty()) return "";
    std::vector<std::string> lines;
    int i = 0;
    for (const auto& it : *items) {
        ++i;
        auto text = [&](const char* k) {
            const Json* v = member(it, k);
            if (!v || v->is_null()) return std::string("undefined");
            return v->is_string() ? v->get<std::string>() : js_stringify(*v);
        };
        lines.push_back(std::to_string(i) + ". (" + text("kind") + ") " + text("excerpt"));
    }
    return join(lines, "\n");
}

}  // namespace tr::app
