#pragma once
// DB テストの共通部分。TR_TEST_DATABASE_URL (native/tools/pg_test_cluster.sh が表示) が無ければ
// 77 で終わり、ctest は Skipped と表示する (通ったことにしない)。

#include <cstdlib>
#include <filesystem>
#include <iostream>
#include <memory>
#include <string>

#include "app/migrate.hpp"
#include "io/env.hpp"
#include "io/pg_pool.hpp"

namespace trtest {

inline std::string test_database_url() {
    return tr::io::read_env("TR_TEST_DATABASE_URL").value_or(std::string());
}

inline std::filesystem::path repo_migrations_dir() {
    // tests は native/tests にある。リポ直下は 2 つ上。
#ifdef TR_SOURCE_DIR
    const std::filesystem::path native_dir(TR_SOURCE_DIR);
#else
    // CMake 以外で翻訳単位だけ解析するとき (Praesidium) は、このファイルの場所 native/tests/support から求める。
    const auto native_dir = std::filesystem::path(__FILE__).parent_path().parent_path().parent_path();
#endif
    return native_dir.parent_path() / "apps" / "server" / "migrations";
}

// スキーマを作り直して migration を全部当てたプールを返す。
inline std::unique_ptr<tr::io::PgPool> fresh_database() {
    const auto url = test_database_url();
    if (url.empty()) {
        std::cout << "SKIP: TR_TEST_DATABASE_URL is not set (run native/tools/pg_test_cluster.sh start)\n";
        std::exit(77);
    }
    auto pool = std::make_unique<tr::io::PgPool>(url);
    pool->exec_script("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
    tr::app::run_migrations(*pool, repo_migrations_dir(), nullptr);
    return pool;
}

}  // namespace trtest
