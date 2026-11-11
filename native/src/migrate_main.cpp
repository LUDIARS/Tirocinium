// tirocinium-migrate: `npm run migrate` の Postgres 側の C++ 版。DATABASE_URL (postgres://) を使う。
#include <exception>
#include <iostream>

#include "app/migrate.hpp"
#include "app/paths.hpp"
#include "app/version.hpp"
#include "io/pg_pool.hpp"

int main() {
    try {
        const auto env = tr::app::process_env();
        const auto url = env("DATABASE_URL").value_or("");
        if (tr::io::is_sqlite_url(url)) {
            std::cerr << "[migrate] DATABASE_URL must be postgres:// (the C++ build has no SQLite backend)\n";
            return 2;
        }
        tr::io::PgPool pool(url);
        const auto dir = tr::app::repo_root(env) / "apps" / "server" / "migrations";
        const int n = tr::app::run_migrations(pool, dir, [](const std::string& line) { std::cout << line << '\n'; });
        std::cout << "done. " << n << " migration(s) applied." << std::endl;
        return 0;
    } catch (const std::exception& e) {
        std::cerr << "[migrate] " << e.what() << '\n';
        return 1;
    }
}
