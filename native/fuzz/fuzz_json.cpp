// fuzz の入口: 上限つき JSON の読み取り (HTTP 本文・WS フレーム・外部応答・LLM 出力が通る共通の関数)。
#include <cstddef>
#include <cstdint>
#include <string_view>

#include "core/json.hpp"

extern "C" int LLVMFuzzerTestOneInput(const std::uint8_t* data, std::size_t size) {
    const std::string_view text(reinterpret_cast<const char*>(data), size);
    tr::JsonLimits limits;
    limits.max_bytes = 1024 * 1024;
    limits.max_elements = 10'000;
    limits.max_depth = 32;
    (void)tr::parse_json(text, limits);
    return 0;
}
