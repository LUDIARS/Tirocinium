// fuzz の入口: Bearer トークン (PASETO v4.public) の分解と payload の検査。署名の検証より前に外から来る部分。
#include <cstddef>
#include <cstdint>
#include <string_view>

#include "core/paseto.hpp"

extern "C" int LLVMFuzzerTestOneInput(const std::uint8_t* data, std::size_t size) {
    const std::string_view text(reinterpret_cast<const char*>(data), size);
    if (auto parts = tr::paseto::split_v4_public(text)) {
        (void)tr::paseto::signing_input(*parts);
        if (auto payload = tr::paseto::parse_payload(parts->message)) {
            (void)tr::paseto::assert_payload(*payload, std::string("tirocinium"), 0);
        }
    }
    if (auto payload = tr::paseto::parse_payload(text)) {
        (void)tr::paseto::assert_payload(*payload, std::nullopt, 0);
    }
    return 0;
}
