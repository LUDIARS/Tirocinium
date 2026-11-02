#include "app/voice.hpp"

#include <cstdint>

#include "app/config.hpp"
#include "core/text.hpp"
#include "http/message.hpp"

namespace tr::app {

namespace {

std::optional<std::string> get(const EnvList& env, const std::string& k) {
    for (const auto& [key, v] : env) {
        if (key == k) return v;
    }
    return std::nullopt;
}

}  // namespace

VoiceConfig load_voice_config(const EnvList& env) {
    VoiceConfig c;
    const std::string tts = ascii_lower(get(env, "TIROCINIUM_TTS_BACKEND").value_or("off"));
    if (tts == "voicevox") {
        c.tts_enabled = true;
        std::string url = get(env, "TIROCINIUM_VOICEVOX_URL").value_or("http://127.0.0.1:50021");
        if (!url.empty() && url.back() == '/') url.pop_back();
        c.voicevox_url = url;
        const std::string raw = get(env, "TIROCINIUM_VOICEVOX_SPEAKER").value_or("13");
        auto n = js_parse_int(raw);
        if (!n || *n < 0) throw std::runtime_error("TIROCINIUM_VOICEVOX_SPEAKER が不正: \"" + raw + "\" (非負整数のみ)");
        c.default_speaker = static_cast<int>(*n);
    } else if (tts != "off") {
        throw std::runtime_error("Unknown TIROCINIUM_TTS_BACKEND: " + tts + " (voicevox | off のみ)");
    }
    const auto raw_stt = get(env, "TIROCINIUM_STT_BACKEND");
    std::string stt = raw_stt ? ascii_lower(*raw_stt) : (get(env, "TIROCINIUM_STT_GRPC") ? "grpc" : "off");
    if (stt == "grpc") {
        throw std::runtime_error(
            "TIROCINIUM_STT_BACKEND=grpc (Imperativus stt-service の gRPC) は C++ 版では未対応です "
            "(native/PORTING.md「人間の判断が要ること」)。STT を使う間は Node 版で起動してください");
    }
    if (stt == "api") {
        if (get(env, "TIROCINIUM_STT_API_KEY").value_or("").empty() && get(env, "OPENAI_API_KEY").value_or("").empty()) {
            throw std::runtime_error("TIROCINIUM_STT_BACKEND=api requires TIROCINIUM_STT_API_KEY (or OPENAI_API_KEY).");
        }
    } else if (stt != "off") {
        throw std::runtime_error("Unknown TIROCINIUM_STT_BACKEND: " + (raw_stt ? *raw_stt : stt));
    }
    c.stt_backend = stt;
    c.iv_client = !get(env, "IV_URL").value_or("").empty() || stt != "off" || c.tts_enabled;
    return c;
}

std::string extract_wav_data(const std::string& wav) {
    auto u32 = [&](std::size_t off) {
        return static_cast<std::uint32_t>(static_cast<unsigned char>(wav[off])) |
               (static_cast<std::uint32_t>(static_cast<unsigned char>(wav[off + 1])) << 8) |
               (static_cast<std::uint32_t>(static_cast<unsigned char>(wav[off + 2])) << 16) |
               (static_cast<std::uint32_t>(static_cast<unsigned char>(wav[off + 3])) << 24);
    };
    if (wav.size() < 12 || wav.compare(0, 4, "RIFF") != 0 || wav.compare(8, 4, "WAVE") != 0) {
        throw std::runtime_error("voicevox synthesis 応答が WAV (RIFF/WAVE) でない");
    }
    std::size_t off = 12;
    while (off + 8 <= wav.size()) {
        const std::string id = wav.substr(off, 4);
        const std::uint64_t size = u32(off + 4);
        if (id == "data") {
            const std::uint64_t end = std::min<std::uint64_t>(off + 8 + size, wav.size());
            return wav.substr(off + 8, static_cast<std::size_t>(end - (off + 8)));
        }
        // チャンクは 2 byte 境界に padding される (オーバーフローしないよう 64bit で進める)
        const std::uint64_t next = static_cast<std::uint64_t>(off) + 8 + size + (size % 2);
        if (next > wav.size()) break;
        off = static_cast<std::size_t>(next);
    }
    throw std::runtime_error("voicevox WAV に data チャンクが見つからない");
}

std::vector<std::string> voicevox_tts(const VoiceConfig& cfg, const HttpFetch& fetch, const std::string& text,
                                      const std::optional<std::string>& voice, int sample_rate, int channels,
                                      const std::atomic<bool>* cancel) {
    int speaker = cfg.default_speaker;
    if (voice) {
        if (auto n = js_parse_int(*voice)) speaker = static_cast<int>(*n);
    }
    io::HttpClientRequest q;
    q.method = "POST";
    q.url = cfg.voicevox_url + "/audio_query?text=" + http::encode_uri_component(text) + "&speaker=" + std::to_string(speaker);
    q.timeout = std::chrono::milliseconds(30'000);
    q.max_response_bytes = 4 * 1024 * 1024;
    auto qr = fetch(q);
    if (!qr.ok()) throw std::runtime_error("voicevox audio_query failed: HTTP " + std::to_string(qr.status));
    JsonLimits limits;
    limits.max_bytes = 4 * 1024 * 1024;
    auto query = parse_json(qr.body, limits);
    if (!query || !query->is_object()) throw std::runtime_error("voicevox audio_query: invalid JSON");
    (*query)["outputSamplingRate"] = sample_rate;
    (*query)["outputStereo"] = channels == 2;
    if (cancel && cancel->load()) return {};
    io::HttpClientRequest s;
    s.method = "POST";
    s.url = cfg.voicevox_url + "/synthesis?speaker=" + std::to_string(speaker);
    s.headers = {{"content-type", "application/json"}, {"accept", "audio/wav"}};
    s.body = js_stringify(*query);
    s.timeout = std::chrono::milliseconds(30'000);
    s.max_response_bytes = 64 * 1024 * 1024;
    auto sr = fetch(s);
    if (!sr.ok()) throw std::runtime_error("voicevox synthesis failed: HTTP " + std::to_string(sr.status));
    const std::string pcm = extract_wav_data(sr.body);
    std::vector<std::string> chunks;
    for (std::size_t i = 0; i < pcm.size(); i += 8192) chunks.push_back(pcm.substr(i, 8192));
    return chunks;
}

std::vector<std::string> split_sentences(const std::string& text) {
    // text.split(/(?<=[。！？!?\n])/).map(trim).filter(len > 0)
    std::vector<std::string> parts;
    std::string cur;
    for (char32_t cp : decode_utf8(text)) {
        append_utf8(cur, cp);
        if (cp == U'。' || cp == U'！' || cp == U'？' || cp == U'!' || cp == U'?' || cp == U'\n') {
            parts.push_back(cur);
            cur.clear();
        }
    }
    if (!cur.empty()) parts.push_back(cur);
    std::vector<std::string> out;
    for (const auto& p : parts) {
        std::string t = js_trim(p);
        if (!t.empty()) out.push_back(t);
    }
    if (out.empty()) out.push_back(js_trim(text));
    return out;
}

}  // namespace tr::app
