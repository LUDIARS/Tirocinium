#include "app/pipeline.hpp"

#include <exception>
#include <map>

#include "http/cors.hpp"

namespace tr::app {

namespace {

bool is_material_upload(const http::Request& req) {
    std::map<std::string, std::string> params;
    return req.method == "POST" && http::Router::match("/api/v1/sessions/:id/materials", req.path, params);
}

}  // namespace

std::size_t body_limit_for(const http::Request& req) {
    // 資料提出は Node 版の bodyLimit (7 MiB) と同じ。超えた分は経路が 413 material_too_large を返す。
    if (is_material_upload(req)) return 7 * 1024 * 1024;
    // それ以外の経路は Node 版では上限が無かった。C++ 版は 2 MiB で打ち切る (Lorica の課金の起点)。
    return 2 * 1024 * 1024;
}

http::Response handle_request(const http::Router& router, http::Request& req, const ErrorLog& log) {
    return http::with_cors(req, [&]() -> http::Response {
        try {
            if (req.body_too_large && !is_material_upload(req)) {
                return http::Response::json(Json{{"error", "payload_too_large"}}, 413);
            }
            http::Context ctx;
            return router.dispatch(req, ctx);
        } catch (const std::exception& e) {
            if (log) log(std::string("[http] unhandled error: ") + e.what());
            return http::Response::json(Json{{"error", "internal"}}, 500);
        } catch (...) {
            if (log) log("[http] unhandled error");
            return http::Response::json(Json{{"error", "internal"}}, 500);
        }
    });
}

}  // namespace tr::app
