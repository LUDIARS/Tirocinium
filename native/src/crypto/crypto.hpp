#pragma once
// 暗号の基本処理はすべて OpenSSL 3 に委ねる (自作しない)。

#include <memory>
#include <optional>
#include <string>
#include <string_view>

namespace tr::crypto {

std::string sha256(std::string_view data);       // 生の 32 バイト
std::string sha256_hex(std::string_view data);   // 小文字 16 進
// 暗号論的乱数。失敗したら例外 (縮退しない)。
std::string random_bytes(std::size_t n);
// crypto.randomUUID() と同じ形 (v4、小文字)。
std::string random_uuid_v4();
// 定数時間比較。
bool equal_constant_time(std::string_view a, std::string_view b);

// Ed25519 公開鍵 (PASETO v4.public の検証用)。
class Ed25519PublicKey {
public:
    // raw 32 バイト。
    static std::optional<Ed25519PublicKey> from_raw(std::string_view raw);
    // paseto 3.1.4 の _checkPublicKey と同じ受け方: "k4.public.<base64url 32 byte>" か PEM
    // (SPKI 公開鍵、または秘密鍵 PEM から公開鍵を導出)。Ed25519 以外は拒否。
    static std::optional<Ed25519PublicKey> from_config_string(std::string_view text);

    [[nodiscard]] bool verify(std::string_view message, std::string_view signature) const;

    Ed25519PublicKey(const Ed25519PublicKey&) = default;
    Ed25519PublicKey& operator=(const Ed25519PublicKey&) = default;
    Ed25519PublicKey(Ed25519PublicKey&&) = default;
    Ed25519PublicKey& operator=(Ed25519PublicKey&&) = default;

private:
    explicit Ed25519PublicKey(std::shared_ptr<void> key) : key_(std::move(key)) {}
    std::shared_ptr<void> key_;  // EVP_PKEY
};

// @ludiars/encrypted-config と同じ鍵導出: scrypt(secret, salt, N=16384, r=8, p=1) → 32 バイト。
std::optional<std::string> scrypt_key(std::string_view secret, std::string_view salt);

struct AesGcmResult {
    std::string ciphertext;
    std::string tag;  // 16 バイト
};
std::optional<AesGcmResult> aes256gcm_encrypt(std::string_view key, std::string_view iv, std::string_view plaintext);
// 改竄・鍵違いは nullopt。
std::optional<std::string> aes256gcm_decrypt(std::string_view key, std::string_view iv, std::string_view ciphertext,
                                             std::string_view tag);

}  // namespace tr::crypto
