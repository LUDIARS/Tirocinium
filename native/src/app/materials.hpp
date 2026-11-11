#pragma once
// 提出資料 (ES / ポートフォリオ) の受付 → Consult スキルで要点化 → セッションのメモリに保持
// (materials/submit-material.ts, material-reader.ts, consult-skills.ts の移植)。資料も要点も DB へ書かない。
//
// material-reader.ts:19 の所見の修正: Node 版は `--allowedTools Read` で Read を全パスに許していたため、
// 資料に埋め込まれた指示で作業フォルダの外 (設定・鍵) を読ませる余地があった。C++ 版は
// `--allowedTools Read(./material.<ext>)` でその 1 ファイルだけを許可する (作業フォルダは資料だけ。
// 他のパスは -p では承認できないので拒否される)。

#include <filesystem>
#include <functional>
#include <optional>
#include <string>

#include "app/llm.hpp"
#include "app/session_state.hpp"
#include "core/domain/domain.hpp"

namespace tr::app {

struct InterviewerSkills {
    std::string reader;
    std::string interviewer;
};

std::filesystem::path consult_root(const EnvList& env, const std::filesystem::path& cwd);
// 2 本とも読めなければ例外 (呼び出し側が 503 consult_skills_unavailable にする)。
InterviewerSkills load_interviewer_skills(const std::filesystem::path& root);

std::vector<std::string> reader_cli_args(const std::string& file_name);

// 資料を一時フォルダに置いて CLI で読ませ、要点 (決まった見出し) を返す。フォルダは成否に関わらず消す。
using MaterialRun = std::function<std::string(const std::string& prompt, const CliRunOptions& options)>;
std::string read_material(const domain::MaterialUpload& upload, const std::string& reader_skill, const MaterialRun& run,
                          std::chrono::milliseconds timeout = std::chrono::milliseconds(120'000));

struct SubmitMaterialResult {
    bool ok = false;
    int status = 200;
    std::string error;
    std::string kind;
    std::size_t digest_chars = 0;
};
struct SubmitMaterialPorts {
    std::function<InterviewerSkills()> load_skills;
    std::function<std::string(const domain::MaterialUpload&, const std::string&)> read;
    std::function<void(const std::string&)> log;
};
SubmitMaterialResult submit_material(MaterialStore& store, const std::string& session_id, const std::string& user_id,
                                     const Json* raw, const SubmitMaterialPorts& ports, EpochMs now);

}  // namespace tr::app
