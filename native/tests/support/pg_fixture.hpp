#pragma once
// DB テストの共通部分。TR_TEST_DATABASE_URL (native/tools/pg_test_cluster.sh が表示) が無ければ
// 77 で終わり、ctest は Skipped と表示する (通ったことにしない)。

#include <cstdlib>
#include <filesystem>
#include <iostream>
#include <memory>
#include <string>

#include "app/migrate.hpp"
#include "io/pg_pool.hpp"

namespace trtest {

inline std::string test_database_url() {
    const char* v = std::getenv("TR_TEST_DATABASE_URL");
    return v ? std::string(v) : std::string();
}

inline std::filesystem::path repo_migrations_dir() {
    // tests は native/tests にある。リポ直下は 2 つ上。
    return std::filesystem::path(TR_SOURCE_DIR).parent_path() / "apps" / "server" / "migrations";
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
