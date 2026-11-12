// Lorica が「この翻訳単位に」掛かっていることを、翻訳単位の中から確かめる (job cpp-lorica-20261111 の作業 B の 1)。
// tests/lorica_applied.cmake が tr_lorica() を通して 2 本作る:
//   lorica_applied_tests          (baseline。テストの実行ファイルと同じ経路)
//   lorica_applied_extended_tests (tr_lorica(... SERVER)。常駐サーバと同じ EXTENDED の経路)
// CMake から渡す期待値:
//   TR_LORICA_EXPECT_FORTIFY   この構成で Lorica が付けるはずの _FORTIFY_SOURCE (0 = 付けない構成)
//   TR_LORICA_EXPECT_EXTENDED  1 = EXTENDED の印も確かめる
//   TR_LORICA_EXTENDED_SKIP    1 = この環境では EXTENDED が使えない (TR_EXTENDED_HARDENING=AUTO の後退)。理由を出して skip (77)

// ---- 強制 include の印 (最初の #include より前に置く) ------------------------------------------------
// lorica/unsafe_api.hpp は #pragma once で include guard のマクロを持たず、自分のマクロ (LORICA_DECLARE_UNSAFE /
// LORICA_NOTHROW) も最後に #undef するので、#ifdef で見られる印は残らない。残る印は、C ライブラリより前に
// 置かれる [[deprecated]] つきの ::strcpy / ::wcscat の宣言そのもの。このファイルはここまで何も include して
// いないので、ここで ::strcpy が見えるのは強制 include (-include .../unsafe_api.hpp) が効いているときだけ。
// 宣言が見えるかは、同じ名前の可変長の代役との多重定義の解決で見分ける (見えなければ代役が選ばれる)。
// MSVC は強制 include を使わず /we4996 (UCRT 自身の非推奨) なので、この印は無い (下の MSVC の枝を参照)。
// 名前は unsafe_api.hpp 自身と同じくマクロで綴る。ここは代役を宣言し、未評価の decltype でどの宣言が
// 見つかるかを聞くだけで、関数を呼んではいない (Praesidium の文字列の規則 native.unbounded-copy は
// 呼び出しの形の行を探すので、呼び出しに見える行を書かない)。
#if !defined(_MSC_VER)
#define TR_PROBE_UNSAFE_NAME(a, b) a##b
namespace tr_lorica_probe {
struct absent {};
absent TR_PROBE_UNSAFE_NAME(str, cpy)(...);
absent TR_PROBE_UNSAFE_NAME(wcs, cat)(...);
}  // namespace tr_lorica_probe
namespace tr_lorica_probe_lookup {
using namespace tr_lorica_probe;
template <class T>
T value();  // std::declval の代わり (<utility> をまだ include しないため。未評価の文脈だけで使う)
#pragma GCC diagnostic push
#pragma GCC diagnostic ignored "-Wdeprecated-declarations"
inline constexpr bool strcpy_declared =
    !__is_same(decltype(TR_PROBE_UNSAFE_NAME(str, cpy)(value<char*>(), value<const char*>())),
               tr_lorica_probe::absent);
inline constexpr bool wcscat_declared =
    !__is_same(decltype(TR_PROBE_UNSAFE_NAME(wcs, cat)(value<wchar_t*>(), value<const wchar_t*>())),
               tr_lorica_probe::absent);
#pragma GCC diagnostic pop
}  // namespace tr_lorica_probe_lookup
#undef TR_PROBE_UNSAFE_NAME
#endif

#include <cstddef>
#include <cstring>  // glibc の __USE_FORTIFY_LEVEL を見るため (上の印の後なので印には影響しない)
#include <limits>
#include <string>

#include <lorica/checked_size.hpp>
#include <lorica/input_budget.hpp>

#include "check.hpp"

#if !defined(TR_LORICA_EXPECT_FORTIFY) || !defined(TR_LORICA_EXPECT_EXTENDED)
#error "tests/lorica_applied.cmake must pass TR_LORICA_EXPECT_FORTIFY and TR_LORICA_EXPECT_EXTENDED"
#endif

using trtest::check;
using trtest::check_eq;

namespace {

#define TR_STR_INNER(x) #x
#define TR_STR(x) TR_STR_INNER(x)

// 最適化で畳まれないように、値は実行時に読む。
std::size_t runtime(std::size_t value) {
    volatile std::size_t v = value;
    return v;
}

}  // namespace

#if !defined(_MSC_VER)
TEST_CASE("unsafe_api.hpp is force-included (::strcpy / ::wcscat declared before any #include)") {
    check(tr_lorica_probe_lookup::strcpy_declared, "::strcpy is not declared ahead of the first #include: -include lorica/unsafe_api.hpp is missing");
    check(tr_lorica_probe_lookup::wcscat_declared, "::wcscat is not declared ahead of the first #include: -include lorica/unsafe_api.hpp is missing");
}
#endif

#if defined(_MSC_VER)
// MSVC: baseline は /GS /sdl /guard:cf と /we4996 (LoricaHardening.cmake)。どれも翻訳単位から見えるマクロを
// 定義しないので、ここでは確かめられない (compile_commands の点検と、unsafe_api_rejected のコンパイル失敗の
// テストで見る)。EXTENDED は _MSVC_STL_HARDENING=1 と _MSVC_STL_DESTRUCTOR_TOMBSTONES=1 を定義する (下)。
// この枝はクラウドの Linux では実行していない。
#else
TEST_CASE("standard library assertions follow Lorica (_GLIBCXX_ASSERTIONS / _LIBCPP_HARDENING_MODE)") {
#if defined(_LIBCPP_VERSION)
#if TR_LORICA_EXPECT_EXTENDED
    check(_LIBCPP_HARDENING_MODE == _LIBCPP_HARDENING_MODE_EXTENSIVE, "libc++ hardening mode is not EXTENSIVE");
#else
    check(_LIBCPP_HARDENING_MODE == _LIBCPP_HARDENING_MODE_FAST, "libc++ hardening mode is not FAST");
#endif
#elif defined(__GLIBCXX__)
#if defined(_GLIBCXX_ASSERTIONS)
    check(true, "");
#else
    check(false, "_GLIBCXX_ASSERTIONS is not defined");
#endif
#else
    check(false, "unknown standard library: Lorica supports libstdc++ and libc++ only");
#endif
    // Lorica は libstdc++ のビルドでも -D_LIBCPP_HARDENING_MODE=<mode> を付ける。libstdc++ では mode の名前が
    // マクロとして定義されていないので、展開した字句がそのまま残る (= Lorica が付けた印)。
#if defined(_LIBCPP_HARDENING_MODE)
#if !defined(_LIBCPP_VERSION)
    const std::string mode = TR_STR(_LIBCPP_HARDENING_MODE);
#if TR_LORICA_EXPECT_EXTENDED
    check_eq(mode, std::string("_LIBCPP_HARDENING_MODE_EXTENSIVE"), "Lorica's -D_LIBCPP_HARDENING_MODE (EXTENDED)");
#else
    check_eq(mode, std::string("_LIBCPP_HARDENING_MODE_FAST"), "Lorica's -D_LIBCPP_HARDENING_MODE (baseline)");
#endif
#endif
#else
    check(false, "_LIBCPP_HARDENING_MODE is not defined (Lorica defines it on Linux for both standard libraries)");
#endif
}

TEST_CASE("_FORTIFY_SOURCE follows Lorica in optimized configurations") {
    // Lorica は Release / RelWithDebInfo / MinSizeRel で -U_FORTIFY_SOURCE -D_FORTIFY_SOURCE=<n> を付ける
    // (GCC / Clang 12 以上で 3)。Debug は付けない。sanitizer や fuzz の構成でも Lorica は除かない
    // (LoricaHardening.cmake の _lorica_linux_capabilities は構成の名前だけで決める) ので、ここも除かない。
#if TR_LORICA_EXPECT_FORTIFY > 0
#if !defined(_FORTIFY_SOURCE)
    check(false, "_FORTIFY_SOURCE is not defined in an optimized configuration");
#else
    check_eq(static_cast<int>(_FORTIFY_SOURCE), TR_LORICA_EXPECT_FORTIFY, "_FORTIFY_SOURCE");
#endif
#if defined(__GLIBC__)
#if defined(__USE_FORTIFY_LEVEL)
    check_eq(static_cast<int>(__USE_FORTIFY_LEVEL), TR_LORICA_EXPECT_FORTIFY, "glibc's effective __USE_FORTIFY_LEVEL");
#else
    check(false, "glibc did not enable fortification (__USE_FORTIFY_LEVEL undefined)");
#endif
#endif
#else
    std::cout << "    (this configuration is not optimized: Lorica adds no _FORTIFY_SOURCE)\n";
#endif
}
#endif

#if TR_LORICA_EXPECT_EXTENDED && defined(_MSC_VER)
TEST_CASE("EXTENDED: MSVC STL hardening definitions") {
#if defined(_MSVC_STL_HARDENING) && defined(_MSVC_STL_DESTRUCTOR_TOMBSTONES)
    check(_MSVC_STL_HARDENING == 1 && _MSVC_STL_DESTRUCTOR_TOMBSTONES == 1, "_MSVC_STL_HARDENING / TOMBSTONES are not 1");
#else
    check(false, "_MSVC_STL_HARDENING / _MSVC_STL_DESTRUCTOR_TOMBSTONES are not defined");
#endif
}
#endif
// GCC / Clang の EXTENDED のもう 1 つの印 -ftrivial-auto-var-init=zero は、翻訳単位の中から見えるマクロを
// 持たない。compile_commands の点検 (tirocinium.lorica_applied.compile_commands) が全ての常駐サーバの単位で見る。

TEST_CASE("Lorica::boundary: checked_add rejects overflow") {
    const std::size_t max = std::numeric_limits<std::size_t>::max();
    check(!lorica::checked_add(runtime(max), runtime(1)).has_value(), "checked_add(SIZE_MAX, 1) must be nullopt");
    auto exact = lorica::checked_add(runtime(max - 1), runtime(1));
    check(exact.has_value() && *exact == max, "checked_add(SIZE_MAX - 1, 1) must be SIZE_MAX");
}

TEST_CASE("Lorica::boundary: input_budget accepts the limit and refuses limit + 1") {
    const lorica::budget_limits limits{runtime(1024), runtime(16), runtime(4), runtime(8)};
    {
        lorica::input_budget budget(limits);
        check(budget.consume(runtime(1024), 0, 0), "exactly the byte limit must pass");
        check(!budget.consume(runtime(1), 0, 0), "one byte past the limit must be refused");
    }
    {
        lorica::input_budget budget(limits);
        check(!budget.consume(runtime(1025), 0, 0), "limit + 1 bytes must be refused");
    }
    {
        lorica::input_budget budget(limits);
        check(budget.consume(0, runtime(16), 0), "exactly the element limit must pass");
        check(!budget.consume(0, runtime(1), 0), "element limit + 1 must be refused");
    }
    lorica::input_budget budget(limits);
    check(budget.permits_depth(runtime(8)), "depth at the limit must pass");
    check(!budget.permits_depth(runtime(9)), "depth limit + 1 must be refused");
}

#if defined(TR_LORICA_EXTENDED_SKIP) && TR_LORICA_EXTENDED_SKIP
int main() {
    std::cout << "SKIP: EXTENDED hardening is not available in this build (TR_EXTENDED_HARDENING=AUTO fell back to baseline): "
              << TR_LORICA_EXTENDED_SKIP_REASON << '\n';
    return 77;
}
#else
TEST_MAIN()
#endif
