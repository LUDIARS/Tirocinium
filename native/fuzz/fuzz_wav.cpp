// fuzz の入口: VOICEVOX の WAV 応答から data チャンクを取り出す (RIFF のチャンク長は外から来る値)。
#include <cstddef>
#include <cstdint>
#include <stdexcept>
#include <string>

#include "app/voice.hpp"

extern "C" int LLVMFuzzerTestOneInput(const std::uint8_t* data, std::size_t size) {
    try {
        (void)tr::app::extract_wav_data(std::string(reinterpret_cast<const char*>(data), size));
    } catch (const std::runtime_error&) {
    }
    return 0;
}
