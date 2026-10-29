#include "app/materials.hpp"

#include <fstream>
#include <random>
#include <sstream>

#include "core/encoding.hpp"
#include "core/text.hpp"
#include "crypto/crypto.hpp"

namespace tr::app {

std::filesystem::path consult_root(const EnvList& env, const std::filesystem::path& cwd) {
    for (const auto& [k, v] : env) {
        if (k == "TIROCINIUM_CONSULT_ROOT" && !js_trim(v).empty()) return std::filesystem::path(js_trim(v));
    }
    return (cwd / ".." / ".." / "Consult").lexically_normal();
}

namespace {

std::string read_text(const std::filesystem::path& p) {
    std::error_code ec;
    if (!std::filesystem::is_regular_file(p, ec)) throw std::runtime_error("ENOENT: " + p.filename().string());
    if (std::filesystem::file_size(p, ec) > 1024 * 1024) throw std::runtime_error("skill file too large");
    std::ifstream in(p, std::ios::binary);
    std::stringstream ss;
    ss << in.rdbuf();
    return ss.str();
}

std::filesystem::path skill_path(const std::filesystem::path& root, const std::string& name) {
    return root / "interviewer" / ".agents" / "skills" / name / "SKILL.md";
}

}  // namespace

InterviewerSkills load_interviewer_skills(const std::filesystem::path& root) {
    InterviewerSkills s{domain::strip_frontmatter(read_text(skill_path(root, "interviewer-material-reader"))),
                        domain::strip_frontmatter(read_text(skill_path(root, "interviewer-mock-interview")))};
    if (s.reader.empty() || s.interviewer.empty()) throw std::runtime_error("consult_skills_empty");
    return s;
}

std::vector<std::string> reader_cli_args(const std::string& file_name) {
    return {"--tools", "Read", "--allowedTools", "Read(./" + file_name + ")", "--strict-mcp-config"};
}

std::string read_material(const domain::MaterialUpload& upload, const std::string& reader_skill, const MaterialRun& run,
                          std::chrono::milliseconds timeout) {
    const auto dir = std::filesystem::temp_directory_path() / ("tr-material-" + hex_encode(crypto::random_bytes(8)));
    std::filesystem::create_directory(dir);  // 既にあれば例外 (乱数名の衝突は再試行しない)
    const std::string file_name = "material." + upload.extension;
    struct Cleanup {
        std::filesystem::path dir;
        ~Cleanup() {
            std::error_code ec;
            std::filesystem::remove_all(dir, ec);
        }
    } cleanup{dir};
    {
        std::ofstream out(dir / file_name, std::ios::binary);
        out.write(upload.bytes.data(), static_cast<std::streamsize>(upload.bytes.size()));
        if (!out) throw std::runtime_error("material write failed");
    }
    CliRunOptions o;
    o.model = "sonnet";
    o.cwd = dir;
    o.extra_args = reader_cli_args(file_name);
    o.timeout = timeout;
    std::string output;
    try {
        output = run(domain::build_reader_prompt(reader_skill, upload.kind, file_name), o);
    } catch (const LlmError& e) {
        if (std::string(e.what()).find("timed out") != std::string::npos) throw std::runtime_error("material_read_timeout");
        throw;
    }
    auto digest = domain::normalize_digest(output);
    if (!digest) throw std::runtime_error("material_digest_malformed");
    return *digest;
}

SubmitMaterialResult submit_material(MaterialStore& store, const std::string& session_id, const std::string& user_id,
                                     const Json* raw, const SubmitMaterialPorts& ports, EpochMs now) {
    auto parsed = domain::parse_material_upload(raw);
    if (auto* err = std::get_if<std::string>(&parsed)) {
        int status = 400;
        if (*err == "unsupported_material_type") status = 415;
        if (*err == "material_too_large") status = 413;
        return {false, status, *err, "", 0};
    }
    const auto& upload = std::get<domain::MaterialUpload>(parsed);
    // 1 セッション 1 資料。差し替えは新しいセッションで行う。
    if (store.has(session_id) || !store.begin_reading(session_id)) {
        return {false, 409, "material_already_submitted", "", 0};
    }
    struct Release {
        MaterialStore& s;
        std::string id;
        ~Release() { s.end_reading(id); }
    } release{store, session_id};
    InterviewerSkills skills;
    try {
        skills = ports.load_skills();
    } catch (const std::exception& e) {
        if (ports.log) ports.log(std::string("[materials] consult skills unavailable: ") + e.what());
        return {false, 503, "consult_skills_unavailable", "", 0};
    }
    std::string digest;
    try {
        digest = ports.read(upload, skills.reader);
    } catch (const std::exception& e) {
        // 資料の中身はログに出さない (個人データ)。
        if (ports.log) ports.log(std::string("[materials] read failed: ") + e.what());
        return {false, 503, "material_read_failed", "", 0};
    }
    store.put(session_id, user_id, MaterialDigest{upload.kind, digest, skills.interviewer}, now);
    return {true, 200, "", upload.kind, utf16_length(digest)};
}

}  // namespace tr::app
