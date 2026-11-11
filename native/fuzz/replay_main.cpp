// libFuzzer を使わないビルド (GCC の CI) で fuzz の入口を固定の入力で 1 回ずつ呼ぶ回帰用の main。
// 引数のファイル・ディレクトリ (直下のファイル) を順に渡す。空の入力も必ず 1 回渡す。
#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <iostream>
#include <vector>

#include "io/file_read.hpp"

extern "C" int LLVMFuzzerTestOneInput(const std::uint8_t* data, std::size_t size);

namespace {

int replay(const std::filesystem::path& p) {
    auto r = tr::io::read_file_bounded(p, 16 * 1024 * 1024);
    if (r.status != tr::io::FileReadStatus::ok) {
        std::cerr << "cannot read " << p << '\n';
        return 1;
    }
    (void)LLVMFuzzerTestOneInput(reinterpret_cast<const std::uint8_t*>(r.data.data()), r.data.size());
    return 0;
}

}  // namespace

int main(int argc, char** argv) {
    (void)LLVMFuzzerTestOneInput(nullptr, 0);
    int failed = 0;
    std::size_t count = 1;
    for (int i = 1; i < argc; ++i) {
        const std::filesystem::path arg(argv[i]);
        std::vector<std::filesystem::path> files;
        if (std::filesystem::is_directory(arg)) {
            for (const auto& e : std::filesystem::directory_iterator(arg)) {
                if (e.is_regular_file()) files.push_back(e.path());
            }
        } else {
            files.push_back(arg);
        }
        for (const auto& f : files) {
            failed += replay(f);
            ++count;
        }
    }
    std::cout << "replayed " << count << " inputs\n";
    return failed == 0 ? 0 : 1;
}
