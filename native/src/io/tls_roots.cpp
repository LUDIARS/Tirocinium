#include "io/tls_roots.hpp"

#include <string>

#include "io/env.hpp"

#ifdef _WIN32
#include <windows.h>
#include <wincrypt.h>
#include <openssl/x509.h>
#endif

namespace tr::io {

void load_system_roots(boost::asio::ssl::context& ctx) {
#ifdef _WIN32
    HCERTSTORE store = CertOpenSystemStoreW(0, L"ROOT");
    if (store) {
        X509_STORE* x509_store = SSL_CTX_get_cert_store(ctx.native_handle());
        PCCERT_CONTEXT cert = nullptr;
        while ((cert = CertEnumCertificatesInStore(store, cert)) != nullptr) {
            const unsigned char* der = cert->pbCertEncoded;
            X509* x = d2i_X509(nullptr, &der, static_cast<long>(cert->cbCertEncoded));
            if (x) {
                X509_STORE_add_cert(x509_store, x);
                X509_free(x);
            }
        }
        CertCloseStore(store, 0);
    }
#else
    ctx.set_default_verify_paths();
#endif
    if (const auto extra = read_env("TIROCINIUM_CA_FILE")) {
        boost::system::error_code ec;
        ctx.load_verify_file(*extra, ec);
    }
}

}  // namespace tr::io
