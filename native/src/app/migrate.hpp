#pragma once
// db/migrate.ts (Postgres 側) の移植。apps/server/migrations/*.sql を名前順に、未適用のものだけ
// 1 ファイル 1 トランザクションで適用し、_tirocinium_migrations に記録する。SQL は書き換えない。

#include <filesystem>
#include <functional>
#include <string>

#include "db/database.hpp"

namespace tr::app {

// 適用した数を返す。log には適用したファイル名だけを出す。
int run_migrations(db::Database& database, const std::filesystem::path& migrations_dir,
                   const std::function<void(const std::string&)>& log);

}  // namespace tr::app
