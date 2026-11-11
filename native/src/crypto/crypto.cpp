#include "crypto/crypto.hpp"

#include <stdexcept>

#include <openssl/bio.h>
#include <openssl/crypto.h>
#include <openssl/evp.h>
#include <openssl/kdf.h>
#include <openssl/pem.h>
#include <openssl/rand.h>

#include "core/encoding.hpp"
#include "core/text.hpp"

namespace tr::crypto {
namespace {

std::shared_ptr<void> own(EVP_PKEY* key) {
    return std::shared_ptr<void>(key, [](void* p) { EVP_PKEY_free(static_cast<EVP_PKEY*>(p)); });
}

}  // namespace

std::string sha256(std::string_view data) {
    unsigned char md[EVP_MAX_MD_SIZE];
    unsigned int len = 0;
    if (EVP_Digest(data.data(), data.size(), md, &len, EVP_sha256(), nullptr) != 1) {
        throw std::runtime_error("sha256 failed");
    }
    return std::string(reinterpret_cast<const char*>(md), len);
}

std::string sha256_hex(std::string_view data) { return hex_encode(sha256(data)); }

std::string random_bytes(std::size_t n) {
    std::string out(n, '\0');
    if (n > 0 && RAND_bytes(reinterpret_cast<unsigned char*>(out.data()), static_cast<int>(n)) != 1) {
        throw std::runtime_error("RAND_bytes failed");
    }
    return out;
}

std::string random_uuid_v4() {
    std::string b = random_bytes(16);
    b[6] = static_cast<char>((static_cast<unsigned char>(b[6]) & 0x0F) | 0x40);
    b[8] = static_cast<char>((static_cast<unsigned char>(b[8]) & 0x3F) | 0x80);
    const std::string h = hex_encode(b);
    return h.substr(0, 8) + "-" + h.substr(8, 4) + "-" + h.substr(12, 4) + "-" + h.substr(16, 4) + "-" + h.substr(20, 12);
}

bool equal_constant_time(std::string_view a, std::string_view b) {
    if (a.size() != b.size()) return false;
    return CRYPTO_memcmp(a.data(), b.data(), a.size()) == 0;
}

std::optional<Ed25519PublicKey> Ed25519PublicKey::from_raw(std::string_view raw) {
    if (raw.size() != 32) return std::nullopt;
    EVP_PKEY* key = EVP_PKEY_new_raw_public_key(EVP_PKEY_ED25519, nullptr,
                                                reinterpret_cast<const unsigned char*>(raw.data()), raw.size());
    if (!key) return std::nullopt;
    return Ed25519PublicKey(own(key));
}

std::optional<Ed25519PublicKey> Ed25519PublicKey::from_config_string(std::string_view text) {
    if (starts_with(text, "k4.public.")) {
        // Node の Buffer.from(x, 'base64url') は寛容なので同じく寛容に読む。32 バイトでなければ PEM として試す。
        const std::string raw = base64_decode_lenient(text.substr(10));
        if (raw.size() == 32) return from_raw(raw);
    }
    BIO* bio = BIO_new_mem_buf(text.data(), static_cast<int>(text.size()));
    if (!bio) return std::nullopt;
    EVP_PKEY* key = PEM_read_bio_PUBKEY(bio, nullptr, nullptr, nullptr);
    if (!key) {
        BIO_free(bio);
        bio = BIO_new_mem_buf(text.data(), static_cast<int>(text.size()));
        if (!bio) return std::nullopt;
        EVP_PKEY* priv = PEM_read_bio_PrivateKey(bio, nullptr, nullptr, nullptr);
        if (priv && EVP_PKEY_get_id(priv) == EVP_PKEY_ED25519) {
            unsigned char pub[32];
            std::size_t len = sizeof pub;
            if (EVP_PKEY_get_raw_public_key(priv, pub, &len) == 1 && len == 32) {
                key = EVP_PKEY_new_raw_public_key(EVP_PKEY_ED25519, nullptr, pub, len);
            }
        }
        if (priv) EVP_PKEY_free(priv);
    }
    BIO_free(bio);
    if (!key) return std::nullopt;
    if (EVP_PKEY_get_id(key) != EVP_PKEY_ED25519) {
        EVP_PKEY_free(key);
        return std::nullopt;
    }
    return Ed25519PublicKey(own(key));
}

bool Ed25519PublicKey::verify(std::string_view message, std::string_view signature) const {
    if (signature.size() != 64 || !key_) return false;
    EVP_MD_CTX* ctx = EVP_MD_CTX_new();
    if (!ctx) return false;
    bool ok = EVP_DigestVerifyInit(ctx, nullptr, nullptr, nullptr, static_cast<EVP_PKEY*>(key_.get())) == 1 &&
              EVP_DigestVerify(ctx, reinterpret_cast<const unsigned char*>(signature.data()), signature.size(),
                               reinterpret_cast<const unsigned char*>(message.data()), message.size()) == 1;
    EVP_MD_CTX_free(ctx);
    return ok;
}

std::optional<std::string> scrypt_key(std::string_view secret, std::string_view salt) {
    std::string out(32, '\0');
    // Node の scryptSync の既定 (N=16384, r=8, p=1, maxmem=32 MiB)。
    if (EVP_PBE_scrypt(secret.data(), secret.size(), reinterpret_cast<const unsigned char*>(salt.data()), salt.size(),
                       16384, 8, 1, 32 * 1024 * 1024, reinterpret_cast<unsigned char*>(out.data()), out.size()) != 1) {
        return std::nullopt;
    }
    return out;
}

std::optional<AesGcmResult> aes256gcm_encrypt(std::string_view key, std::string_view iv, std::string_view plaintext) {
    if (key.size() != 32 || iv.empty()) return std::nullopt;
    EVP_CIPHER_CTX* ctx = EVP_CIPHER_CTX_new();
    if (!ctx) return std::nullopt;
    AesGcmResult r;
    r.ciphertext.resize(plaintext.size() + 16);
    int len = 0;
    int total = 0;
    bool ok = EVP_EncryptInit_ex(ctx, EVP_aes_256_gcm(), nullptr, nullptr, nullptr) == 1 &&
              EVP_CIPHER_CTX_ctrl(ctx, EVP_CTRL_GCM_SET_IVLEN, static_cast<int>(iv.size()), nullptr) == 1 &&
              EVP_EncryptInit_ex(ctx, nullptr, nullptr, reinterpret_cast<const unsigned char*>(key.data()),
                                 reinterpret_cast<const unsigned char*>(iv.data())) == 1 &&
              EVP_EncryptUpdate(ctx, reinterpret_cast<unsigned char*>(r.ciphertext.data()), &len,
                                reinterpret_cast<const unsigned char*>(plaintext.data()),
                                static_cast<int>(plaintext.size())) == 1;
    total = len;
    if (ok) ok = EVP_EncryptFinal_ex(ctx, reinterpret_cast<unsigned char*>(r.ciphertext.data()) + total, &len) == 1;
    total += len;
    r.tag.resize(16);
    if (ok) ok = EVP_CIPHER_CTX_ctrl(ctx, EVP_CTRL_GCM_GET_TAG, 16, r.tag.data()) == 1;
    EVP_CIPHER_CTX_free(ctx);
    if (!ok) return std::nullopt;
    r.ciphertext.resize(static_cast<std::size_t>(total));
    return r;
}

std::optional<std::string> aes256gcm_decrypt(std::string_view key, std::string_view iv, std::string_view ciphertext,
                                             std::string_view tag) {
    if (key.size() != 32 || iv.empty() || tag.size() != 16) return std::nullopt;
    EVP_CIPHER_CTX* ctx = EVP_CIPHER_CTX_new();
    if (!ctx) return std::nullopt;
    std::string out(ciphertext.size() + 16, '\0');
    int len = 0;
    int total = 0;
    std::string tag_copy(tag);
    bool ok = EVP_DecryptInit_ex(ctx, EVP_aes_256_gcm(), nullptr, nullptr, nullptr) == 1 &&
              EVP_CIPHER_CTX_ctrl(ctx, EVP_CTRL_GCM_SET_IVLEN, static_cast<int>(iv.size()), nullptr) == 1 &&
              EVP_DecryptInit_ex(ctx, nullptr, nullptr, reinterpret_cast<const unsigned char*>(key.data()),
                                 reinterpret_cast<const unsigned char*>(iv.data())) == 1 &&
              EVP_DecryptUpdate(ctx, reinterpret_cast<unsigned char*>(out.data()), &len,
                                reinterpret_cast<const unsigned char*>(ciphertext.data()),
                                static_cast<int>(ciphertext.size())) == 1;
    total = len;
    if (ok) ok = EVP_CIPHER_CTX_ctrl(ctx, EVP_CTRL_GCM_SET_TAG, 16, tag_copy.data()) == 1;
    if (ok) ok = EVP_DecryptFinal_ex(ctx, reinterpret_cast<unsigned char*>(out.data()) + total, &len) == 1;
    total += len;
    EVP_CIPHER_CTX_free(ctx);
    if (!ok) return std::nullopt;
    out.resize(static_cast<std::size_t>(total));
    return out;
}

}  // namespace tr::crypto
