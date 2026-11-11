#include "app/migrate.hpp"

#include <algorithm>
#include <set>
#include <stdexcept>
#include <vector>

#include "io/file_read.hpp"

namespace tr::app {

int run_migrations(db::Database& database, const std::filesystem::path& dir,
                   const std::function<void(const std::string&)>& log) {
    database.exec_script(R"(
    CREATE TABLE IF NOT EXISTS _tirocinium_migrations (
      name        TEXT PRIMARY KEY,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  )");
    std::set<std::string> applied;
    for (const auto& row : database.query("SELECT name FROM _tirocinium_migrations")) {
        applied.insert(row["name"].get<std::string>());
    }
    std::vector<std::string> files;
    for (const auto& entry : std::filesystem::directory_iterator(dir)) {
        if (!entry.is_regular_file()) continue;
        const std::string name = entry.path().filename().string();
        if (name.size() > 4 && name.compare(name.size() - 4, 4, ".sql") == 0) files.push_back(name);
    }
    std::sort(files.begin(), files.end());
    int count = 0;
    for (const auto& file : files) {
        if (applied.count(file)) continue;
        // migration はリポ内のファイルだが、外から置かれうるファイルとして上限つきで読む (1 本 4 MiB)。
        auto text = io::read_file_text(dir / file, 4 * 1024 * 1024);
        if (!text) throw std::runtime_error("migration unreadable or too large: " + file);
        if (log) log("applying " + file);
        database.transaction([&](db::Database& tx) {
            tx.exec_script(*text);
            tx.query("INSERT INTO _tirocinium_migrations (name) VALUES ($1)", {std::string(file)});
        });
        ++count;
    }
    return count;
}

}  // namespace tr::app
