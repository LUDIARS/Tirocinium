// fuzz の入口: 資料 (教材) の提出本文。JSON を読み、base64 の検査・復号前の見積もり・復号を通す。
#include <cstddef>
#include <cstdint>
#include <string_view>

#include "core/domain/domain.hpp"
#include "core/json.hpp"

extern "C" int LLVMFuzzerTestOneInput(const std::uint8_t* data, std::size_t size) {
    const std::string_view text(reinterpret_cast<const char*>(data), size);
    tr::JsonLimits limits;
    limits.max_bytes = 8 * 1024 * 1024;
    auto raw = tr::parse_json(text, limits);
    (void)tr::domain::parse_material_upload(raw ? &*raw : nullptr);
    return 0;
}
