#pragma once
// packages/voice の移植 (VOICEVOX TTS は HTTP。STT は Imperativus の gRPC (双方向ストリーム) だけが
// 実装されていたが、gRPC C++ は入れないため C++ 版では未対応 = 設定されていれば起動を拒否する)。

#include <atomic>
#include <optional>
#include <stdexcept>
#include <string>
#include <vector>

#include "app/one_shot.hpp"
#include "app/secrets.hpp"

namespace tr::app {

struct VoiceConfig {
    bool tts_enabled = false;  // TIROCINIUM_TTS_BACKEND=voicevox
    std::string voicevox_url = "http://127.0.0.1:50021";
    int default_speaker = 13;
    std::string stt_backend = "off";  // off | api (未実装は Node 版と同じ)
    bool iv_client = false;           // IV_URL / STT / TTS のどれかがあれば true (createIvClient)
};

// 例外: 不正な TIROCINIUM_TTS_BACKEND / TIROCINIUM_VOICEVOX_SPEAKER、未対応の STT (grpc)、
// api の鍵なし (Node 版の createSttApiProvider と同じ)。
VoiceConfig load_voice_config(const EnvList& env);

// WAV (RIFF) の data チャンクを取り出す (44 byte 固定でなくチャンクを辿る)。形が違えば例外。
std::string extract_wav_data(const std::string& wav);

// VOICEVOX: POST /audio_query → POST /synthesis → WAV → PCM を 8192 byte ごとに返す。
std::vector<std::string> voicevox_tts(const VoiceConfig& cfg, const HttpFetch& fetch, const std::string& text,
                                      const std::optional<std::string>& voice, int sample_rate, int channels,
                                      const std::atomic<bool>* cancel);

// 句点区切りの文分割 (session-runtime.ts splitSentences)。
std::vector<std::string> split_sentences(const std::string& text);

}  // namespace tr::app
