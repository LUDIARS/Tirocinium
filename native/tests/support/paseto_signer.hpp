#pragma once
// テスト専用: OpenSSL で Ed25519 鍵を作り PASETO v4.public を署名する (本体は検証しかしない)。

#include <stdexcept>
#include <string>

#include <openssl/evp.h>

#include "core/encoding.hpp"
#include "core/paseto.hpp"

namespace trtest {

class TestSigner {
public:
    TestSigner() {
        EVP_PKEY_CTX* ctx = EVP_PKEY_CTX_new_id(EVP_PKEY_ED25519, nullptr);
        if (!ctx || EVP_PKEY_keygen_init(ctx) != 1 || EVP_PKEY_keygen(ctx, &key_) != 1) throw std::runtime_error("keygen");
        EVP_PKEY_CTX_free(ctx);
    }
    explicit TestSigner(const std::string& seed32) {
        key_ = EVP_PKEY_new_raw_private_key(EVP_PKEY_ED25519, nullptr,
                                            reinterpret_cast<const unsigned char*>(seed32.data()), seed32.size());
        if (!key_) throw std::runtime_error("raw key");
    }
    ~TestSigner() { EVP_PKEY_free(key_); }
    TestSigner(const TestSigner&) = delete;
    TestSigner& operator=(const TestSigner&) = delete;

    std::string public_raw() const {
        unsigned char pub[32];
        std::size_t len = sizeof pub;
        EVP_PKEY_get_raw_public_key(key_, pub, &len);
        return std::string(reinterpret_cast<const char*>(pub), len);
    }

    std::string sign(const std::string& payload, const std::string& footer = {}) const {
        tr::paseto::V4PublicParts parts{payload, {}, footer};
        const std::string m2 = tr::paseto::signing_input(parts);
        EVP_MD_CTX* ctx = EVP_MD_CTX_new();
        unsigned char sig[64];
        std::size_t len = sizeof sig;
        if (EVP_DigestSignInit(ctx, nullptr, nullptr, nullptr, key_) != 1 ||
            EVP_DigestSign(ctx, sig, &len, reinterpret_cast<const unsigned char*>(m2.data()), m2.size()) != 1)
            throw std::runtime_error("sign");
        EVP_MD_CTX_free(ctx);
        std::string token = "v4.public." + tr::base64url_encode(payload + std::string(reinterpret_cast<char*>(sig), len));
        if (!footer.empty()) token += "." + tr::base64url_encode(footer);
        return token;
    }

private:
    EVP_PKEY* key_ = nullptr;
};

}  // namespace trtest
