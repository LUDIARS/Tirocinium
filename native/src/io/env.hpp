#pragma once
// プロセスの環境変数を 1 つ読む。MSVC の CRT が拒否する std::getenv を使わずに済むよう、
// Windows では _dupenv_s、それ以外では std::getenv を使う (読み出しの分岐はここだけに置く)。

#include <optional>
#include <string>

namespace tr::io {

// 未設定なら nullopt。空文字は設定済みとして "" を返す。
std::optional<std::string> read_env(const std::string& name);

}  // namespace tr::io
