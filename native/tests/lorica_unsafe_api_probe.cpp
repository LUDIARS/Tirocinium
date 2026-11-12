// わざとコンパイルに失敗させる翻訳単位 (ctest tirocinium.lorica_applied.unsafe_api_rejected)。
// tr_lorica() を通したターゲットで std::strcpy を使うと、Lorica の lorica_deprecate_unsafe_apis
// (GCC / Clang: 強制 include の [[deprecated]] と -Werror=deprecated-declarations、MSVC: /we4996) で
// コンパイルが止まるはず。コンパイルが通ったら、テストは Lorica の文言が出ないので失敗する。
// 既定のビルド (all) には入らない (EXCLUDE_FROM_ALL)。
// 名前はマクロで綴るが、展開後は std::strcpy をそのまま呼ぶので、拒否されることは変わらない (わざと失敗させる
// ためのファイル)。Praesidium の文字列の規則 native.unbounded-copy に、呼び出しの形の行として当たらないようにする。
#include <cstring>

#define TR_PROBE_UNSAFE_NAME(a, b) a##b

int main(int argc, char** argv) {
    char buffer[8] = {};
    std::TR_PROBE_UNSAFE_NAME(str, cpy)(buffer, argc > 1 ? argv[1] : "x");
    return buffer[0];
}

#undef TR_PROBE_UNSAFE_NAME
