// packages/voice の tts-voicevox-provider.test.ts / stt-provider.test.ts と
// apps/server/src/brief/qa-seed-loader.test.ts の移植。
// qa-seed は Node 版のテストがリポの実ファイルを読んでいたが、ここでは一時フォルダに合成の seed を置く
// (data/ の実データは読まない)。VOICEVOX には接続しない (偽の fetch)。
#include <filesystem>
#include <fstream>
#include <random>

#include "check.hpp"
#include "app/brief.hpp"
#include "app/voice.hpp"
#include "core/llm/engine.hpp"
#include "http/message.hpp"

using namespace tr;
using trtest::check;
using trtest::check_eq;
using trtest::check_throws;

namespace {

std::string u32le(std::uint32_t v) {
    std::string s(4, '\0');
    for (int i = 0; i < 4; ++i) s[static_cast<std::size_t>(i)] = static_cast<char>((v >> (8 * i)) & 0xff);
    return s;
}

std::string build_wav(const std::string& pcm, bool extra_chunk = false) {
    std::string w = "RIFF" + u32le(0) + "WAVE";
    w += "fmt " + u32le(16) + std::string(16, '\0');
    if (extra_chunk) w += "LIST" + u32le(4) + "abcd";
    w += "data" + u32le(static_cast<std::uint32_t>(pcm.size())) + pcm;
    return w;
}

TEST_CASE("extractWavData: PCM of the data chunk (not a fixed 44-byte header)") {
    const std::string pcm{1, 2, 3, 4, 5, 6};
    check(app::extract_wav_data(build_wav(pcm)) == pcm, "plain");
    check(app::extract_wav_data(build_wav(pcm, true)) == pcm, "chunk between fmt and data");
}

TEST_CASE("extractWavData: non-RIFF bytes and oversized chunk sizes throw") {
    check_throws([] { (void)app::extract_wav_data(std::string{0, 1, 2, 3}); }, "not RIFF");
    std::string w = "RIFF" + u32le(0) + "WAVE" + "LIST" + u32le(0xFFFFFFF0u) + "x";
    check_throws([&] { (void)app::extract_wav_data(w); }, "chunk size beyond the buffer, no data chunk");
    // data の長さが実際より長い宣言でも、バッファの範囲だけを返す
    std::string t = "RIFF" + u32le(0) + "WAVE" + "data" + u32le(1000) + "abc";
    check(app::extract_wav_data(t) == "abc", "clamped to buffer");
}

struct FakeVoicevox {
    std::vector<io::HttpClientRequest> calls;
    std::string pcm;
    int status = 200;
    app::HttpFetch fetch() {
        return [this](const io::HttpClientRequest& r) {
            calls.push_back(r);
            io::HttpClientResponse res;
            res.status = status;
            if (status != 200) {
                res.body = "boom";
            } else if (r.url.find("/audio_query") != std::string::npos) {
                res.body = R"({"accent_phrases":[],"outputSamplingRate":24000,"outputStereo":false})";
            } else {
                res.body = build_wav(pcm);
            }
            return res;
        };
    }
};

app::VoiceConfig vv(int speaker) {
    app::VoiceConfig c;
    c.tts_enabled = true;
    c.voicevox_url = "http://vv:50021";
    c.default_speaker = speaker;
    return c;
}

std::string joined(const std::vector<std::string>& chunks) {
    std::string out;
    for (const auto& c : chunks) out += c;
    return out;
}

TEST_CASE("VoicevoxTtsProvider: audio_query then synthesis, yields PCM") {
    FakeVoicevox f;
    for (int i = 0; i < 100; ++i) f.pcm.push_back(static_cast<char>(i));
    const auto out = app::voicevox_tts(vv(13), f.fetch(), "こんにちは。面接を始めます", std::nullopt, 24000, 1, nullptr);
    check(joined(out) == f.pcm, "pcm");
    check_eq(f.calls.size(), std::size_t{2}, "two calls");
    check(f.calls[0].url.find("/audio_query?") != std::string::npos, "audio_query");
    check(f.calls[0].url.find(http::encode_uri_component("こんにちは。面接を始めます")) != std::string::npos, "text encoded");
    check(f.calls[0].url.find("speaker=13") != std::string::npos, "speaker");
    check(f.calls[1].url.find("/synthesis?speaker=13") != std::string::npos, "synthesis");
}

TEST_CASE("VoicevoxTtsProvider: output format is applied; numeric voice overrides the speaker") {
    FakeVoicevox f;
    f.pcm = std::string(2, '\0');
    (void)app::voicevox_tts(vv(3), f.fetch(), "a", std::nullopt, 48000, 2, nullptr);
    auto body = parse_json(f.calls[1].body);
    check(body && (*body)["outputSamplingRate"] == 48000 && (*body)["outputStereo"] == true, "format");
    FakeVoicevox g;
    g.pcm = std::string(2, '\0');
    (void)app::voicevox_tts(vv(3), g.fetch(), "a", std::string("47"), 24000, 1, nullptr);
    check(g.calls[0].url.find("speaker=47") != std::string::npos, "voice override");
}

TEST_CASE("VoicevoxTtsProvider: large PCM is chunked; engine errors throw") {
    FakeVoicevox f;
    f.pcm = std::string(20000, '\0');
    const auto out = app::voicevox_tts(vv(3), f.fetch(), "a", std::nullopt, 24000, 1, nullptr);
    check(out.size() > 1 && joined(out).size() == 20000, "chunked");
    FakeVoicevox e;
    e.status = 500;
    try {
        (void)app::voicevox_tts(vv(3), e.fetch(), "a", std::nullopt, 24000, 1, nullptr);
        check(false, "should throw");
    } catch (const std::runtime_error& err) {
        check(std::string(err.what()).find("audio_query failed") != std::string::npos, "message");
    }
}

TEST_CASE("createTtsProvider / createSttProvider: config validation (grpc is refused in the C++ build)") {
    check(!app::load_voice_config({}).tts_enabled, "default off");
    check(!app::load_voice_config({{"TIROCINIUM_TTS_BACKEND", "off"}}).tts_enabled, "explicit off");
    check(app::load_voice_config({{"TIROCINIUM_TTS_BACKEND", "voicevox"}}).tts_enabled, "voicevox");
    check_throws([] { (void)app::load_voice_config({{"TIROCINIUM_TTS_BACKEND", "polly"}}); }, "unknown backend");
    check_throws([] { (void)app::load_voice_config({{"TIROCINIUM_TTS_BACKEND", "voicevox"}, {"TIROCINIUM_VOICEVOX_SPEAKER", "abc"}}); },
                 "bad speaker");
    check_eq(app::load_voice_config({}).stt_backend, std::string("off"), "stt off");
    check_eq(app::load_voice_config({{"TIROCINIUM_STT_BACKEND", "off"}}).stt_backend, std::string("off"), "stt explicit off");
    check_throws([] { (void)app::load_voice_config({{"TIROCINIUM_STT_GRPC", "localhost:50051"}}); }, "grpc inferred → refused");
    check_throws([] { (void)app::load_voice_config({{"TIROCINIUM_STT_BACKEND", "grpc"}}); }, "grpc explicit → refused");
    check_eq(app::load_voice_config({{"TIROCINIUM_STT_BACKEND", "api"}, {"OPENAI_API_KEY", "synthetic"}}).stt_backend, std::string("api"),
             "api with key");
    check_throws([] { (void)app::load_voice_config({{"TIROCINIUM_STT_BACKEND", "api"}}); }, "api without key");
    check_throws([] { (void)app::load_voice_config({{"TIROCINIUM_STT_BACKEND", "bogus"}}); }, "unknown stt");
}

TEST_CASE("splitSentences") {
    check(app::split_sentences("はい。そうです！本当？ok") == std::vector<std::string>{"はい。", "そうです！", "本当？", "ok"}, "split");
    check(app::split_sentences("  ") == std::vector<std::string>{""}, "blank keeps one");
}

std::filesystem::path seed_dir() {
    static const auto d = [] {
        auto p = std::filesystem::temp_directory_path() / ("tr-qa-seed-" + std::to_string(std::random_device{}()));
        std::filesystem::create_directories(p / "hr");
        std::filesystem::create_directories(p / "final");
        std::ofstream(p / "hr" / "programmer.json")
            << R"({"items":[{"theme":" 合成テーマ ","question":" 合成の質問? ","followups":["f",1],"axes":["clarity","bogus"]},)"
            << R"({"question":"  "},{"theme":"","question":"テーマなし"}]})";
        std::ofstream(p / "hr" / "zz-other.json") << R"({"items":[]})";
        std::ofstream(p / "final" / "programmer.json")
            << R"({"items":[{"theme":"t","question":"q","axes":["consistency","target_fit","x","depth_resilience"]}]})";
        return p;
    }();
    return d;
}

TEST_CASE("loadQaSeed: existing role is read as is (no fallback)") {
    const auto r = app::load_qa_seed(seed_dir(), "hr", "programmer");
    check(!r.fallback_role, "no fallback");
    check_eq(r.items.size(), std::size_t{2}, "blank questions skipped");
    check(r.items[0]["origin"] == "seed" && r.items[0]["question"] == "合成の質問?" && r.items[0]["theme"] == "合成テーマ", "trimmed");
    check(r.items[1]["theme"] == "一般質問", "default theme");
    check(js_stringify(r.items[0]["followups"]) == R"(["f"])", "string followups only");
}

TEST_CASE("loadQaSeed: missing role falls back to the first file of the stage, explicitly") {
    const auto r = app::load_qa_seed(seed_dir(), "hr", "general");
    check(r.fallback_role == std::optional<std::string>("programmer"), "fallback role");
    check(!r.items.empty(), "items");
}

TEST_CASE("loadQaSeed: unknown stage is empty; a non-directory stage throws; axes filtered to the 6 known") {
    const auto r = app::load_qa_seed(seed_dir(), "unknown-stage", "programmer");
    check(r.items.empty() && !r.fallback_role, "unknown stage → empty");
    check_throws([] { (void)app::load_qa_seed(seed_dir(), "final/programmer.json", "programmer"); }, "not a directory → throw");
    check_throws([] { (void)app::load_qa_seed(seed_dir(), "../hr", "programmer"); }, "traversal → throw");
    std::ofstream(seed_dir() / "notdir") << "x";
    check_throws([] { (void)app::load_qa_seed(seed_dir(), "notdir", "programmer"); }, "file as stage → throw");
    for (const auto& item : app::load_qa_seed(seed_dir(), "final", "programmer").items) {
        for (const auto& a : item["axes"]) check(llm::is_axis_key(a.get<std::string>()), "known axis");
    }
}

}  // namespace

TEST_MAIN()
