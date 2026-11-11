#pragma once
// リポジトリ直下の位置。Node 版はソースの位置から 4 階層上を辿っていた。C++ 版は
// TIROCINIUM_ROOT (指定時) か作業ディレクトリ (Excubitor は cwd=${ARS_ROOT}/Tirocinium で起動する) を使う。

#include <filesystem>

#include "app/version.hpp"

namespace tr::app {

std::filesystem::path repo_root(const EnvLookup& env);

}  // namespace tr::app
