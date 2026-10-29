#pragma once
// 依存を増やさない最小のテスト枠。1 実行ファイル = 1 ctest。各ケースは名前つきで実行し、
// 失敗したケース名と理由を標準エラーに出す (テスト名は PORTING.md の対応表で TS のテストと結ぶ)。

#include <cstdlib>
#include <functional>
#include <iostream>
#include <sstream>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace trtest {

struct Failure : std::runtime_error {
    using std::runtime_error::runtime_error;
};

inline void check(bool condition, const std::string& what) {
    if (!condition) throw Failure(what);
}

template <class A, class B>
void check_eq(const A& actual, const B& expected, const std::string& what) {
    if (!(actual == expected)) {
        std::ostringstream os;
        os << what << "\n    actual:   " << actual << "\n    expected: " << expected;
        throw Failure(os.str());
    }
}

template <class F>
void check_throws(F&& f, const std::string& what) {
    try {
        f();
    } catch (...) {
        return;
    }
    throw Failure("expected an exception: " + what);
}

using Case = std::pair<std::string, std::function<void()>>;

inline std::vector<Case>& registry() {
    static std::vector<Case> cases;
    return cases;
}

struct Register {
    Register(std::string name, std::function<void()> fn) { registry().emplace_back(std::move(name), std::move(fn)); }
};

inline int run_all() {
    int failed = 0;
    for (auto& [name, fn] : registry()) {
        try {
            fn();
            std::cout << "ok   " << name << '\n';
        } catch (const std::exception& e) {
            ++failed;
            std::cerr << "FAIL " << name << "\n    " << e.what() << '\n';
        }
    }
    std::cout << registry().size() - static_cast<std::size_t>(failed) << "/" << registry().size() << " passed\n";
    return failed == 0 ? 0 : 1;
}

}  // namespace trtest

#define TR_CONCAT_INNER(a, b) a##b
#define TR_CONCAT(a, b) TR_CONCAT_INNER(a, b)
#define TEST_CASE(name)                                                                 \
    static void TR_CONCAT(tr_test_fn_, __LINE__)();                                     \
    static ::trtest::Register TR_CONCAT(tr_test_reg_, __LINE__)(name, TR_CONCAT(tr_test_fn_, __LINE__)); \
    static void TR_CONCAT(tr_test_fn_, __LINE__)()

#define TEST_MAIN() \
    int main() { return ::trtest::run_all(); }
