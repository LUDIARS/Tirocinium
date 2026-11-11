// fuzz の入口: 正規表現を置き換えた前進走査 (ES 本文の連絡先検査・LLM 出力の JSON 取り出し・社名の正規化)。
#include <cstddef>
#include <cstdint>
#include <stdexcept>
#include <string>

#include "app/discord_bridge.hpp"
#include "core/domain/domain.hpp"
#include "core/llm/output.hpp"

extern "C" int LLVMFuzzerTestOneInput(const std::uint8_t* data, std::size_t size) {
    const std::string text(reinterpret_cast<const char*>(data), size);
    (void)tr::app::review_body_has_contact(text);
    (void)tr::domain::normalize_name(text);
    try {
        (void)tr::llm::extract_json_block(text);
    } catch (const std::runtime_error&) {
    }
    return 0;
}
