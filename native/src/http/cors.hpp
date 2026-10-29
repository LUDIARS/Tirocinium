#pragma once
// hono/cors の既定 (origin '*'、allowMethods GET,HEAD,PUT,POST,DELETE,PATCH、allowHeaders は要求の
// Access-Control-Request-Headers を反射) と同じ振る舞い。OPTIONS はすべて 204 で返す。

#include <functional>

#include "http/message.hpp"

namespace tr::http {

Response with_cors(const Request& req, const std::function<Response()>& next);

}  // namespace tr::http
