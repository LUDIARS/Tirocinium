#pragma once
// OS の信頼ストアを OpenSSL の検証に読み込む。Linux は既定の場所 (SSL_CERT_FILE / SSL_CERT_DIR も効く)、
// Windows は CryptoAPI の ROOT ストア。TIROCINIUM_CA_FILE があれば追加で読む。

#include <boost/asio/ssl/context.hpp>

namespace tr::io {

void load_system_roots(boost::asio::ssl::context& ctx);

}  // namespace tr::io
