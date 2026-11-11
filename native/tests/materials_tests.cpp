// 教材 (提出資料と Consult スキル) の読み込みの境界テスト。指示書 10 章 W6「教材の読み込み」の所見の確認と修正。
// 資料はすべて合成データ (実在の ES は使わない)。
#include <filesystem>
#include <fstream>
#include <string>

#include <sys/stat.h>

#include "check.hpp"
#include "app/materials.hpp"
#include "core/encoding.hpp"
#include "core/json.hpp"

using namespace tr;
using trtest::check;
using trtest::check_eq;
namespace fs = std::filesystem;

namespace {

Json upload_json(const std::string& mime, const std::string& data_base64) {
    return Json{{"kind", "es"}, {"mime", mime}, {"data_base64", data_base64}};
}

std::string error_of(const Json& raw) {
    auto r = domain::parse_material_upload(&raw);
    if (auto* e = std::get_if<std::string>(&r)) return *e;
    return "ok";
}

const char* kDigest = "## 資料の種類\nES\n## 深掘りしたい点\n- 合成\n## 質問の候補\n- 合成?";

struct TempDir {
    fs::path path;
    TempDir() {
        path = fs::temp_directory_path() / ("tr-test-" + std::to_string(::getpid()) + "-" + std::to_string(rand()));
        fs::create_directories(path);
    }
    ~TempDir() {
        std::error_code ec;
        fs::remove_all(path, ec);
    }
};

void write(const fs::path& p, const std::string& s) {
    fs::create_directories(p.parent_path());
    std::ofstream(p, std::ios::binary) << s;
}

unsigned mode_of(const fs::path& p) {
    struct stat st {};
    if (::stat(p.c_str(), &st) != 0) return 0xFFFF;
    return st.st_mode & 0777;
}

}  // namespace

TEST_CASE("material-reader: Read is limited to the one material file, MCP disabled") {
    const auto args = app::reader_cli_args("material.pdf");
    const std::vector<std::string> expected = {"--tools", "Read", "--allowedTools", "Read(./material.pdf)",
                                               "--strict-mcp-config"};
    check(args == expected, "exact argv (no bare Read, no wildcard)");
}

TEST_CASE("material-policy: decoded size exactly 5 MiB is accepted, 5 MiB + 1 is material_too_large") {
    const std::string at_limit(domain::kMaxMaterialBytes, 'a');
    check_eq(error_of(upload_json("text/plain", base64_encode(at_limit))), std::string("ok"), "at limit");
    const std::string over(domain::kMaxMaterialBytes + 1, 'a');
    check_eq(error_of(upload_json("text/plain", base64_encode(over))), std::string("material_too_large"), "limit + 1");
}

TEST_CASE("material-policy: huge base64 is refused by the pre-decode estimate, broken input is 400") {
    // 24 MiB の base64 (復号すると 18 MiB)。見積もりで弾くので復号しない。
    const std::string huge(24 * 1024 * 1024, 'A');
    check_eq(error_of(upload_json("text/plain", huge)), std::string("material_too_large"), "estimate");
    check_eq(error_of(upload_json("text/plain", "@@@@")), std::string("invalid_material_request"), "bad alphabet");
    check_eq(error_of(upload_json("text/plain", "QQ===")), std::string("invalid_material_request"), "3 pads");
    check_eq(error_of(upload_json("application/x-msdownload", "QQ==")), std::string("unsupported_material_type"), "mime");
    check_eq(error_of(Json("not an object")), std::string("invalid_material_request"), "not an object");
}

TEST_CASE("material-reader: the work folder is owner-only and removed after success and failure") {
    domain::MaterialUpload up{"es", "text/plain", "txt", "合成の志望動機"};
    fs::path seen_dir;
    unsigned dir_mode = 0;
    unsigned file_mode = 0;
    std::string file_body;
    auto run = [&](const std::string&, const app::CliRunOptions& o) {
        seen_dir = o.cwd;
        dir_mode = mode_of(o.cwd);
        file_mode = mode_of(o.cwd / "material.txt");
        std::ifstream in(o.cwd / "material.txt", std::ios::binary);
        file_body.assign(std::istreambuf_iterator<char>(in), {});
        return std::string(kDigest);
    };
    const auto digest = app::read_material(up, "skill", run);
    check(digest.find("## 質問の候補") != std::string::npos, "digest");
    check_eq(dir_mode, 0700u, "folder is owner-only (personal data)");
    check_eq(file_mode, 0600u, "file is owner-only");
    check_eq(file_body, up.bytes, "material written as is");
    check(!fs::exists(seen_dir), "removed after success");

    auto failing = [&](const std::string&, const app::CliRunOptions& o) -> std::string {
        seen_dir = o.cwd;
        throw std::runtime_error("cli failed");
    };
    trtest::check_throws([&] { (void)app::read_material(up, "skill", failing); }, "failure propagates");
    check(!fs::exists(seen_dir), "removed after failure");
}

TEST_CASE("consult-skills: SKILL.md over 1 MiB is refused; exactly 1 MiB is read") {
    TempDir root;
    const auto reader = root.path / "interviewer" / ".agents" / "skills" / "interviewer-material-reader" / "SKILL.md";
    const auto mock = root.path / "interviewer" / ".agents" / "skills" / "interviewer-mock-interview" / "SKILL.md";
    write(reader, "---\nname: r\n---\n" + std::string(1024 * 1024 - 16, 'r'));
    write(mock, "---\nname: m\n---\nmock");
    check_eq(fs::file_size(reader), std::uintmax_t{1024 * 1024}, "fixture is exactly 1 MiB");
    auto skills = app::load_interviewer_skills(root.path);
    check(!skills.reader.empty() && skills.interviewer == "mock", "read at limit");
    write(reader, std::string(1024 * 1024 + 1, 'r'));
    trtest::check_throws([&] { (void)app::load_interviewer_skills(root.path); }, "limit + 1");
    fs::remove(reader);
    fs::create_directories(reader);  // ファイルの代わりにディレクトリ
    trtest::check_throws([&] { (void)app::load_interviewer_skills(root.path); }, "not a regular file");
}

TEST_MAIN()
