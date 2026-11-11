#pragma once
// ファイルを上限つきで読む。大きさを先に stat で見てから全部読む形は、見た後に伸びたファイルを
// 無制限に読んでしまう (TOCTOU)。ここでは読みながら Lorica の予算に課金し、上限を 1 バイトでも
// 超えたら途中で止めて「大きすぎる」を返す。正規ファイル以外 (ディレクトリ・FIFO・デバイス) は読まない。

#include <cstddef>
#include <filesystem>
#include <optional>
#include <string>

#include <lorica/input_budget.hpp>

namespace tr::io {

enum class FileReadStatus { ok, not_found, too_large, io_error };

struct FileReadResult {
    FileReadStatus status = FileReadStatus::io_error;
    std::string data;
};

// budget から読んだバイト数と確保 1 回を差し引きながら、最大 max_bytes まで読む。
// 上限ちょうどは ok、上限 + 1 は too_large。budget が尽きても too_large。
FileReadResult read_file_bounded(const std::filesystem::path& path, std::size_t max_bytes, lorica::input_budget& budget);

// 1 ファイル = 1 依頼として、その場で予算を作って読む。
FileReadResult read_file_bounded(const std::filesystem::path& path, std::size_t max_bytes);

// 読めなければ nullopt (無い・大きすぎる・読み取りエラーの区別が要らない呼び出し元向け)。
std::optional<std::string> read_file_text(const std::filesystem::path& path, std::size_t max_bytes);

}  // namespace tr::io
