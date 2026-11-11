// fuzz の入口: HTTP/1.1 の要求の読み取り (受け口と同じ上限の Beast パーサ) → 要求ごとの Lorica 予算
// → 本文の JSON。ソケットは使わず、バイト列をそのままパーサに渡す。
#include <cstddef>
#include <cstdint>

#include <boost/beast/http.hpp>

#include "app/services.hpp"
#include "http/message.hpp"
#include "http/request_budget.hpp"

namespace bhttp = boost::beast::http;

extern "C" int LLVMFuzzerTestOneInput(const std::uint8_t* data, std::size_t size) {
    bhttp::request_parser<bhttp::string_body> parser;
    parser.eager(true);
    parser.header_limit(16 * 1024);
    parser.body_limit(64 * 1024);
    boost::beast::error_code ec;
    std::size_t used = 0;
    while (used < size && !parser.is_done()) {
        const std::size_t n = parser.put(boost::asio::buffer(data + used, size - used), ec);
        if (ec == bhttp::error::need_more) break;
        if (ec || n == 0) return 0;
        used += n;
    }
    if (!parser.is_header_done()) return 0;
    const auto& msg = parser.get();
    tr::http::Request req;
    req.method = std::string(msg.method_string());
    req.target = std::string(msg.target());
    tr::http::split_target(req.target, req.path, req.raw_query);
    std::vector<std::pair<std::string, std::string>> fields;
    for (const auto& f : msg) {
        fields.emplace_back(std::string(f.name_string()), std::string(f.value()));
        req.headers.append(fields.back().first, fields.back().second);
    }
    const auto limits = tr::http::request_budget_limits({16 * 1024, 64 * 1024});
    if (!limits) return 0;
    req.budget.emplace(*limits);
    if (!tr::http::charge_headers(*req.budget, fields)) return 0;
    req.body = msg.body();
    if (!tr::http::charge_body(*req.budget, req.body)) return 0;
    (void)req.query_all();
    (void)tr::app::read_json_body(req);
    return 0;
}
