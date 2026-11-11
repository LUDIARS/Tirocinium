// libpq adapter と migration runner (db/migrate.ts の Postgres 側) の結合テスト。一時クラスタを使う。
#include "check.hpp"
#include "support/pg_fixture.hpp"
#include "db/pg_decode.hpp"

using namespace tr;
using trtest::check;
using trtest::check_eq;

TEST_CASE("migrate: applies all Postgres migrations once, second run is a no-op") {
    auto pool = trtest::fresh_database();
    const int again = app::run_migrations(*pool, trtest::repo_migrations_dir(), nullptr);
    check_eq(again, 0, "idempotent");
    auto rows = pool->query("SELECT count(*) AS n FROM _tirocinium_migrations");
    check(rows[0]["n"].is_string(), "count(*) is int8 → string like postgres.js");
    check(std::stoi(rows[0]["n"].get<std::string>()) >= 26, "all files recorded");
}

TEST_CASE("decode: postgres.js conventions for timestamptz, int8, jsonb, text[], bool") {
    auto pool = trtest::fresh_database();
    pool->query("INSERT INTO users (id) VALUES ($1)", {std::string("00000000-0000-0000-0000-0000000000aa")});
    auto rows = pool->query(
        "INSERT INTO interviewer_personas (id, display_name, stage, temperament, pressure, tics, bio, evaluation_bias) "
        "VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *",
        {std::string("p1"), std::string("面接官"), std::string("hr"), std::string("calm"), std::int64_t{3},
         db::StringArray{{"えーと", "a\"b"}}, std::string("bio"), db::JsonParam{Json{{"clarity", 1.2}}}});
    const auto& r = rows.at(0);
    check(r["pressure"].is_number_integer() && r["pressure"] == 3, "smallint → number");
    check(r["tics"].is_array() && r["tics"][1] == "a\"b", "text[] → array");
    check(r["evaluation_bias"]["clarity"] == 1.2, "jsonb → object");
    check(r["is_seed"] == false, "bool");
    const std::string created = r["created_at"].get<std::string>();
    check(created.size() == 24 && created.back() == 'Z' && created[10] == 'T', "timestamptz → toISOString: " + created);
    auto big = pool->query("SELECT 9007199254740993::bigint AS b, 1.50::numeric AS n, NULL::text AS z");
    check_eq(big[0]["b"].get<std::string>(), std::string("9007199254740993"), "int8 string");
    check_eq(big[0]["n"].get<std::string>(), std::string("1.50"), "numeric string");
    check(big[0]["z"].is_null(), "null");
}

TEST_CASE("transaction: rollback on exception, unique violation carries SQLSTATE 23505") {
    auto pool = trtest::fresh_database();
    trtest::check_throws(
        [&] {
            pool->transaction([&](db::Database& tx) {
                tx.query("INSERT INTO users (id) VALUES ($1)", {std::string("00000000-0000-0000-0000-0000000000bb")});
                throw std::runtime_error("abort");
            });
        },
        "fn throws");
    check(pool->query("SELECT 1 FROM users WHERE id = $1", {std::string("00000000-0000-0000-0000-0000000000bb")}).empty(),
          "rolled back");
    pool->query("INSERT INTO users (id) VALUES ($1)", {std::string("00000000-0000-0000-0000-0000000000cc")});
    try {
        pool->query("INSERT INTO users (id) VALUES ($1)", {std::string("00000000-0000-0000-0000-0000000000cc")});
        check(false, "duplicate should fail");
    } catch (const db::DbError& e) {
        check_eq(e.sqlstate(), std::string("23505"), "unique_violation");
        check(std::string(e.what()).find("duplicate key") != std::string::npos, "message like postgres.js");
    }
    check(pool->ping(), "pool still usable");
}

TEST_MAIN()
