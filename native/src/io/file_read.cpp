#include "io/file_read.hpp"

#include <array>
#include <fstream>

#include <lorica/checked_size.hpp>

namespace tr::io {

FileReadResult read_file_bounded(const std::filesystem::path& path, std::size_t max_bytes, lorica::input_budget& budget) {
    FileReadResult out;
    std::error_code ec;
    const auto st = std::filesystem::status(path, ec);
    if (ec || !std::filesystem::exists(st)) {
        out.status = FileReadStatus::not_found;
        return out;
    }
    if (!std::filesystem::is_regular_file(st)) {
        out.status = FileReadStatus::not_found;
        return out;
    }
    std::ifstream in(path, std::ios::binary);
    if (!in) {
        out.status = FileReadStatus::io_error;
        return out;
    }
    if (!budget.consume(0, 0, 1)) {
        out.status = FileReadStatus::too_large;
        return out;
    }
    std::array<char, 64 * 1024> chunk{};
    for (;;) {
        in.read(chunk.data(), static_cast<std::streamsize>(chunk.size()));
        const auto got = static_cast<std::size_t>(in.gcount());
        if (got > 0) {
            const auto total = lorica::checked_add(out.data.size(), got);
            // 上限を超えた分は読み込まない (超えた時点で止める)。
            if (!total || *total > max_bytes || !budget.consume(got, 0, 0)) {
                out.data.clear();
                out.status = FileReadStatus::too_large;
                return out;
            }
            out.data.append(chunk.data(), got);
        }
        if (!in) {
            if (in.eof()) break;
            out.data.clear();
            out.status = FileReadStatus::io_error;
            return out;
        }
    }
    out.status = FileReadStatus::ok;
    return out;
}

FileReadResult read_file_bounded(const std::filesystem::path& path, std::size_t max_bytes) {
    // 1 ファイルの依頼: 読むのは max_bytes まで、確保は読み取り用の 1 回。
    lorica::input_budget budget({max_bytes, 0, 1, 0});
    return read_file_bounded(path, max_bytes, budget);
}

std::optional<std::string> read_file_text(const std::filesystem::path& path, std::size_t max_bytes) {
    auto r = read_file_bounded(path, max_bytes);
    if (r.status != FileReadStatus::ok) return std::nullopt;
    return std::move(r.data);
}

}  // namespace tr::io
