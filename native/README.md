# Tirocinium native (C++ 常駐サーバ)

Tirocinium のサーバ (`tirocinium-server`) と migration (`tirocinium-migrate`) の C++ 実装。
移植の経緯・依存の棚卸し・Linux での手順は [PORTING.md](PORTING.md) を参照。

## Windows でのビルド

### 前提

| もの | 確認した版 | 用途 |
|---|---|---|
| Visual Studio 2026 (Build Tools 14.52 / MSVC 19.52) の「C++ によるデスクトップ開発」 | 18.x | コンパイラ・MSVC ランタイム (VC 再頒布物) |
| CMake | 3.24 以上 | ビルド |
| PostgreSQL (クライアント部分) | 18 (公式インストーラ。以下 `<PostgreSQL>` = インストール先) | `libpq.lib` / `libpq.dll` とその依存 `libintl-9.dll` `libiconv-2.dll` |
| OpenSSL 3 (Win64) | 3.x (Win64 版。以下 `<OpenSSL>`) | `libssl` / `libcrypto` (`find_package(OpenSSL)` が見つける場所) |
| Node.js | PATH 上 | 企業 worker と worker のテスト (無ければ worker のテストは skip) |

PostgreSQL はクライアントのライブラリだけ使う。インストーラが入れるローカルのサービスは止めておいてよい
(DB のテストは下の一時クラスタを使う)。

Lorica・Boost・nlohmann/json は CMake が固定版を取得する。オフラインなら手元の checkout を
`-DLORICA_SOURCE_DIR=` / `-DFETCHCONTENT_SOURCE_DIR_BOOST=` / `-DFETCHCONTENT_SOURCE_DIR_JSON=` で渡す
(`-DFETCHCONTENT_FULLY_DISCONNECTED=ON` と組み合わせる)。

### 手順 (リポ直下で)

```sh
cmake -S native -B native/build -G "Visual Studio 18 2026" -A x64 -DPostgreSQL_ROOT="<PostgreSQL>"
cmake --build native/build --config Release
ctest --test-dir native/build -C Release --output-on-failure
```

- 実行ファイルは `native/build/bin/tirocinium-server.exe` (Excubitor の catalog の `native/build/bin/tirocinium-server`)。
- **実行時 DLL はビルドが実行ファイルの横へ複写する** (`cmake/WindowsRuntimeDlls.cmake`、POST_BUILD)。
  対象は `libpq.dll` `libintl-9.dll` `libiconv-2.dll` (`<PostgreSQL>/bin`) と `libssl-3-x64.dll` `libcrypto-3-x64.dll`
  (`<OpenSSL>/bin`)。見つからなければ configure が止まる。別の場所にあるときは `-DTR_RUNTIME_DLL_DIRS=<dir>` を足す。
  PostgreSQL の `bin` にも libssl があるが、リンクした OpenSSL と同じものを置く。
- VS ジェネレータは `compile_commands.json` を書かないので、`tirocinium.lorica_applied.compile_commands` は skip になる。
  これも確かめるときは「x64 Native Tools Command Prompt for VS」で Ninja を使う
  (`cmake -S native -B native/build-ninja -G Ninja -DCMAKE_BUILD_TYPE=Release ...`)。
- Lorica の EXTENDED (MSVC 19.44 以上) では CRT が「安全でない」とする関数 (`std::getenv`・`sscanf` 等) が
  コンパイルエラーになる。`_CRT_SECURE_NO_WARNINGS` で黙らせず、環境変数は `io::read_env`、
  数の読み取りは `std::from_chars` と Lorica の `checked_*` を使う。

### DB を使うテスト (`pg_*`)

`TR_TEST_DATABASE_URL` が無ければ skip (77)。一時クラスタを利用者権限で作る:

```sh
PG="<PostgreSQL>/bin"; D=<短いパスの空ディレクトリ>
"$PG/initdb" -D "$D" -U tirocinium --auth=trust -E UTF8 --locale=C
# Windows は Unix ソケットのパスが 107 byte を超えると起動しないので、ソケットを使わない
printf "\nunix_socket_directories = ''\nlisten_addresses = '127.0.0.1'\nport = 55433\n" >> "$D/postgresql.conf"
"$PG/pg_ctl" -D "$D" -l "$D/server.log" -w start
"$PG/psql" -h 127.0.0.1 -p 55433 -U tirocinium -d postgres -c "CREATE DATABASE tirocinium_test"
TR_TEST_DATABASE_URL=postgres://tirocinium@127.0.0.1:55433/tirocinium_test ctest --test-dir native/build -C Release --output-on-failure
"$PG/pg_ctl" -D "$D" -m fast stop
```
