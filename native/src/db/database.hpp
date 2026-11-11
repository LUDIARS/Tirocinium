#pragma once
// DB の port。業務側 (repo) はこの interface だけを使い、libpq には触れない。
// 行は postgres.js の既定の変換と同じ JSON で返す (int8/numeric は文字列、json/jsonb は値、
// timestamptz は toISOString の文字列、text[] は配列)。Node 版の応答 JSON と同じ形にするため。

#include <cstdint>
#include <functional>
#include <stdexcept>
#include <string>
#include <string_view>
#include <variant>
#include <vector>

#include "core/json.hpp"

namespace tr::db {

struct Null {};
struct JsonParam {
    Json value;
};
struct StringArray {
    std::vector<std::string> items;
};
// postgres.js と同じく、文字列・数値は型を付けずに送り (サーバが文脈から推論)、真偽値は bool、
// sql.json(x) は jsonb として送る。
using Param = std::variant<Null, std::string, std::int64_t, double, bool, StringArray, JsonParam>;
using Params = std::vector<Param>;
using Rows = std::vector<Json>;

class DbError : public std::runtime_error {
public:
    DbError(std::string message, std::string sqlstate)
        : std::runtime_error(std::move(message)), sqlstate_(std::move(sqlstate)) {}
    // 23505 = unique_violation
    [[nodiscard]] const std::string& sqlstate() const { return sqlstate_; }

private:
    std::string sqlstate_;
};

class Database {
public:
    virtual ~Database() = default;
    // 1 文を実行して行を返す (行を返さない文は空)。失敗は DbError。
    virtual Rows query(std::string_view sql, const Params& params = {}) = 0;
    // BEGIN → fn → COMMIT。fn が例外なら ROLLBACK して再送出 (sql.begin と同じ)。
    virtual void transaction(const std::function<void(Database& tx)>& fn) = 0;
    // 複文 (migration 用、パラメータなし)。
    virtual void exec_script(std::string_view sql) = 0;
};

// 補助: 1 行目 (無ければ nullptr)。
inline const Json* first(const Rows& rows) { return rows.empty() ? nullptr : &rows.front(); }

}  // namespace tr::db
