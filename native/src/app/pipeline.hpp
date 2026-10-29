#pragma once
// index.ts の app 全体の流れ: CORS → ルート → notFound (404) / onError (500 {error:'internal'})。
// 本文の上限超過は経路が自分で扱う場合 (資料提出の 413 material_too_large) を除き 413 で返す。

#include <functional>
#include <string>

#include "http/router.hpp"

namespace tr::app {

using ErrorLog = std::function<void(const std::string&)>;

http::Response handle_request(const http::Router& router, http::Request& req, const ErrorLog& log);

// 経路ごとの本文の上限 (バイト)。
std::size_t body_limit_for(const http::Request& req);

}  // namespace tr::app
