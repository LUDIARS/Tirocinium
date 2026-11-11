# Tirocinium — job cpp-lorica-20261111 (W6) 引き継ぎの状態

ブランチ `cpp/tirocinium-node-port`。着手時の先頭 `b89fc41`。push はしていない。
指示書の正本はまとめ役の `briefs/W6-Tirocinium.md` と `COMMON.md`。前回の正本の対応表は `native/PORTING.md`。

この job で積んだコミット (古い順):

| SHA | 内容 | 確認 |
|---|---|---|
| 5ea7b8d | 棚卸し: 生成物の .pyc を追跡から外す | — (コードの変更なし) |
| b3422be | 依存: Lorica の固定を 5e8281b にそろえる | GCC ビルド + ctest 済み |
| 9efd01d | 土台: 全ビルド単位に Lorica、常駐サーバを EXTENDED | GCC ビルド + ctest + verify_binary 済み |
| fa0c904 | **WIP(未完・未検証)**: 入力経路の上限チェック・境界テスト・sanitizer / fuzz | **一度もコンパイルしていない** |
| (この文書の commit) | 引き継ぎ文書 | — |

## (a) 済んで確かめたこと

環境: Linux x86_64、GCC 13.3、CMake 3.28、Ninja、OpenSSL 3.0.13、libpq 16。Lorica は `/home/user/Lorica` (5e8281b)。

1. Lorica の固定 `cab4f12…` → `5e8281b0e60fa16f814e16eaa620715937e8618d` (b3422be)。
   - `cmake --build build -j2`: 警告 0・エラー 0。
   - `ctest --test-dir build -j2`: 21 本中 17 通過、`pg_*` 4 本は `TR_TEST_DATABASE_URL` が無いため skip (77)。失敗 0。
2. 全ビルド単位への Lorica (9efd01d)。`tr_lorica()` (native/CMakeLists.txt) で Lorica::boundary (PRIVATE)・
   `lorica_harden_target`・`lorica_deprecate_unsafe_apis`。常駐サーバ側は EXTENDED。
   - configure: `Tirocinium: EXTENDED hardening for the server: ON` (AUTO で判定、この環境は対応)。
   - ビルド: 警告 0・エラー 0 (既存のソースに strcpy 等は無く、deprecate を入れてもコンパイルが通った)。
   - ctest: 17 通過・4 skip・失敗 0。
   - compile_commands.json で確認したフラグ:
     - `src/main.cpp`・`src/app/ws_routes.cpp` (EXTENDED): `-D_GLIBCXX_ASSERTIONS -fstack-protector-strong
       -fstack-clash-protection -fcf-protection=full -U_FORTIFY_SOURCE -D_FORTIFY_SOURCE=3
       -ftrivial-auto-var-init=zero -include …/lorica/unsafe_api.hpp -Werror=deprecated-declarations`
     - `src/migrate_main.cpp`・テスト (baseline): 上から `-ftrivial-auto-var-init=zero` を除いたもの。
     - `-U_FORTIFY_SOURCE` は Lorica 自身が直後に `-D_FORTIFY_SOURCE=3` を付け直すためのもの (打ち消しではない)。
   - `python3 /home/user/Lorica/tools/verify_binary.py`: `tirocinium-server`・`tirocinium-migrate` とも
     「ELF PIE/NX-stack/full-RELRO metadata present (instruction coverage not verified)」。
3. 指示書 10 章 W6 の 3 所見の **確認** (コードを読んだ結果。テストの追加は WIP 側):
   - ssrf-guard: `io/http_client.cpp` は名前を 1 回解決し、全 IP を検査し、検査した endpoint にそのまま接続する
     (再解決しない)。リダイレクトは各ホップで同じ検査。`io/ws_client.cpp` も同じ。既存テスト
     `io_http_client_tests` の「localhost に解決される名前は接続前に blocked」は通っている。→ 直っていた。
   - 教材の読み込み: `app/materials.cpp` の `reader_cli_args` は `Read(./material.<ext>)` の 1 ファイルだけ +
     `--strict-mcp-config`。→ 所見 (Read を全パスに許す) は直っていた。ただし (1) 一時フォルダ・ファイルが既定の
     権限 (他ユーザが読める)、(2) SKILL.md を大きさを見てから無制限に読む (TOCTOU)、(3) 引数の形のテストが無い、
     の 3 点が残っていた → WIP で修正 (未検証)。
   - 正規表現の二乗時間: C++ に `std::regex` は無い。ES 本文の検査 (`review_body_has_contact`) は前進走査で、
     線形性のテストあり (通過)。`extract_json_block`・`normalize_name` も前進走査だが線形性のテストが無かった →
     WIP で追加 (未実行)。

## (b) 済んだが確かめていないこと

- WIP fa0c904 の全部 (下の (c))。コンパイルもしていない。
- MSVC / Windows のビルド (環境が無い)。Windows の EXTENDED (MSVC 19.44 x64 が要る) も未確認。
- `pg_*` の 4 本 (DB が要る)。`/usr/lib/postgresql/16/bin/initdb` はこの環境にあるので、
  `native/tools/pg_test_cluster.sh start` で一時クラスタを立てれば走らせられるはず (未実施)。

## (c) 途中のこと (WIP fa0c904。すべて未ビルド・未テスト)

| ファイル | 内容 | どこまで |
|---|---|---|
| `src/http/request_budget.{hpp,cpp}` (新規) | 要求ごとの予算の上限 (ヘッダ + 本文×3 + 64 KiB、要素 200,000+1,024、確保 2×要素+16、深さ 64)、`charge_headers` / `charge_body` | 書いただけ |
| `src/http/message.hpp` | `Request::budget` (`std::optional<lorica::input_budget>`) | 書いただけ |
| `src/io/http_server.cpp` | ヘッダで予算を作り課金 (失敗 431)、本文を課金 (失敗 413)、upgrade 要求もヘッダを課金、`req.budget` に渡す | 書いただけ |
| `src/app/services.{hpp,cpp}` | `read_json_body(http::Request&)` (const を外した) が要求の予算で `parse_json_bounded`。予算が無ければ本文の大きさで作る | 書いただけ。呼び出し元はすべて非 const の Request& のはずだが未確認 |
| `src/app/routes/interview_routes.cpp` | 資料提出の本文を `read_json_body` で読む | 書いただけ |
| `src/io/file_read.{hpp,cpp}` (新規) | 読みながら上限で止めるファイル読み (正規ファイルだけ、64 KiB ずつ、予算に課金) | 書いただけ |
| `src/app/materials.cpp` | SKILL.md を `read_file_bounded` (1 MiB)、一時フォルダ 0700・資料 0600 | 書いただけ |
| `src/app/{secrets,companies_repo,brief,migrate}.cpp`, `src/app/routes/alumni_routes.cpp` | 大きさを見てから全部読む形を `io::read_file_*` に置き換え | 書いただけ。使われなくなった `<sstream>` / `std::error_code ec` が残っていて警告になる可能性あり |
| `src/core/ip_policy.{hpp,cpp}` | `vet_resolved_addresses`、IPv4 互換 `::/96` を中の IPv4 で判定 (Node 版より締める) | 書いただけ。既存の `net_policy_tests` と食い違わないか未確認 |
| `src/io/http_client.cpp`, `src/io/ws_client.cpp` | 上の関数で検査 (接続先は検査した一覧のまま) | 書いただけ |
| `src/core/json.cpp` | `parse_json` の予算の計算を `checked_multiply` / `checked_add` に (桁あふれは拒否) | 書いただけ |
| `src/app/voice.{hpp,cpp}` | WAV の走査を `lorica::byte_reader` / `byte_view` (上限 `kMaxWavBytes` = 64 MiB) に | 書いただけ。挙動は旧実装と同じつもり (境界テストで確かめる) |
| `tests/materials_tests.cpp` (新規) | 引数の形、5 MiB ちょうど / +1、巨大 base64、壊れた base64、フォルダの権限と削除、SKILL.md 1 MiB ちょうど / +1 | 未実行 |
| `tests/input_bounds_tests.cpp` (新規) | ファイル、要求の予算、要素数の境界 (201,024)、JSON 上限の桁あふれ、WAV、SSRF、線形性 | 未実行。要素数の境界は nlohmann の callback の数え方 (配列の終わりで value が来るか) 次第で 1 ずれる可能性 |
| `CMakeLists.txt` (top) | `TR_SANITIZE`、`TR_FUZZ` (Clang、`-fsanitize=fuzzer-no-link` を全体に)、`add_subdirectory(fuzz)` | 未 configure |
| `fuzz/` (新規) | 入口 7 本 (json・http_request・material・wav・url・paseto・text)、`replay_main.cpp`、合成 corpus 24 件、`CMakeLists.txt` (replay を ctest に) | 未ビルド。`fuzz_http_request.cpp` は Beast の parser を直接使う |

## (d) 未着手のこと

- `io/process.cpp` の stdout の長さの加算 (`out.size() + r > max_stdout`、POSIX と Windows の 2 か所) を `checked_add` に。
- `io/resident_process.cpp` の行分割・`app/companies_worker.cpp` の 1 行 (16 MiB) は既存の上限のまま (予算を通していない)。
- WebSocket のフレームは `parse_json` の内部でメッセージごとに予算を作っている (変更なし)。フレームの大きさの課金を同じ予算に入れるかは未判断。
- sanitizer ビルド (ASan+UBSan、TSan) の実行、fuzz の短時間実行 (Clang)。
- `PORTING.md` の更新 (Lorica の適用表・上限の一覧・テストの対応表に新しいテストを足す)。
- まとめ役への最終報告 `reports/Tirocinium-report.md` (11 章の形)。
- Discord の音声 (UDP) は C++ に受け口が無い (未移植・前回の人間の判断)。上限チェックの対象の経路が存在しない。
- catalog: 前回 9bc2840 で切り替え済み (本社テスト後に適用)。この job での変更なし。

## (e) 分かっている失敗や落ちるテスト

- 確かめた範囲 (9efd01d まで) で失敗は無い。
- WIP は未コンパイルなので、ビルドが通らない可能性がある。

## (f) 人間の判断が要ること

- 前回の `PORTING.md` §6 の 7 件 (SQLite→Postgres、Discord 音声、gRPC STT、blackbox、worker の LLM、worker の起動、
  crawl-job-news の認証) は未解決のまま。
- コミットの Co-Authored-By の行: COMMON.md 6 の指定と、作業環境から指定された行が食い違った。この job のコミットは
  作業環境の指定に従った。どちらに合わせるかはまとめ役の判断。
- 許可リストに当たらない依存は無い。

## (g) いま時点の Lorica の適用表と上限チェック

固定: `5e8281b0e60fa16f814e16eaa620715937e8618d`。

| ビルド単位 | boundary | harden | deprecate_unsafe_apis | 状態 |
|---|---|---|---|---|
| tr_core / tr_crypto / tr_io / tr_app | ○ | EXTENDED (AUTO) | ○ | 確認済み (9efd01d) |
| tirocinium-server | ○ | EXTENDED (AUTO) | ○ | 確認済み。verify_binary: PIE/NX/full RELRO |
| tirocinium-migrate | ○ | baseline | ○ | 確認済み。verify_binary: PIE/NX/full RELRO |
| テスト 21 本 | ○ | baseline | ○ | 確認済み |
| テスト 2 本 (materials・input_bounds) | ○ | baseline | ○ | WIP・未ビルド |
| fuzz の replay 7 本 / fuzz 7 本 (TR_FUZZ) | ○ | baseline | ○ | WIP・未ビルド |
| OpenSSL・libpq | 対象外 (システムのビルド済み) | | | |
| Boost・nlohmann_json | ヘッダのみ (使う側の単位で守りが入る) | | | |

上限チェック (確認済み = 前回から入っていて ctest が通るもの / WIP = 未検証):

| 経路 | 場所 | 部品・上限 | 状態 |
|---|---|---|---|
| JSON 全般 | `src/core/json.cpp` `parse_json_bounded` / `parse_json` | input_budget (大きさ・要素・深さ・復号後の文字列) | 確認済み。checked 化は WIP |
| DB の結果 | `src/io/pg_pool.cpp`, `src/db/pg_decode.cpp` | input_budget | 確認済み (pg テストは skip) |
| 資料の base64 | `src/core/domain/domain.cpp` `parse_material_upload` | checked_multiply + input_budget (復号後 5 MiB) | 確認済み (境界テストは WIP) |
| HTTP 受信 | `src/io/http_server.cpp`, `src/http/request_budget.cpp`, `src/app/services.cpp` | 要求ごとの input_budget (ヘッダ 16 KiB・本文 2 MiB / 資料 7 MiB) | WIP |
| ファイル (教材の SKILL.md 1 MiB・data/*.json 8 MiB・secrets 1 MiB / token 64 KiB・qa-seed 4 MiB・migration 4 MiB) | `src/io/file_read.cpp` と各呼び出し元 | input_budget + checked_add | WIP |
| WAV (VOICEVOX) | `src/app/voice.cpp` | byte_view (64 MiB)・byte_reader・checked_add | WIP (旧: contains_range / checked_add は確認済み) |
| SSRF の解決結果 | `src/core/ip_policy.cpp`, `src/io/http_client.cpp`, `src/io/ws_client.cpp` | (Lorica ではない) 全 IP 検査 + 接続先固定 | 固定は確認済み、関数化は WIP |
| 外向き HTTP / WS / 子プロセス / worker の行 | `io/http_client.cpp` / `io/ws_client.cpp` / `io/process.cpp` / `io/resident_process.cpp` | Beast の上限・行上限 (Lorica 不使用) | 前回のまま |

## (h) 次にやる順番

1. WIP をビルドして警告・エラーを直す (`-Wall -Wextra -Wpedantic`、`-Werror=deprecated-declarations`)。
2. ctest を走らせ、新しい 2 本と fuzz の replay 7 本の期待値を確かめる (要素数の境界・IPv4 互換の判定・WAV)。
   通ったら WIP を段階ごとのコミットに分け直す (入力経路の上限 / sanitizer と fuzz)。rebase はしない方針なので、
   WIP の上に修正を積み、説明でどの段階かを書く形が安全。
3. `io/process.cpp` の checked_add。
4. sanitizer: `-DTR_SANITIZE=address,undefined` と `thread` の別ビルドで ctest。Clang で `-DTR_FUZZ=ON` を
   ビルドし各入口を 30 秒ずつ。結果を記録したらビルドディレクトリを消す。
5. `pg_test_cluster.sh` で一時クラスタを立てて `pg_*` 4 本 (ローカルの使い捨てクラスタ。本物の DB ではない)。
6. `PORTING.md` と最終報告。

## (i) ローカルのビルドとテストの手順 (新しいコンテナで)

```sh
# 前提: GCC 13 か Clang 18、CMake 3.24+、Ninja、OpenSSL 3 / libpq の開発パッケージ、Python 3
cd Tirocinium
# 共有キャッシュが無い環境では FETCHCONTENT_SOURCE_DIR_* と LORICA_SOURCE_DIR を外す (固定 SHA で取得される)
cmake -S native -B native/build -G Ninja -DCMAKE_BUILD_TYPE=RelWithDebInfo \
  -DLORICA_SOURCE_DIR=/home/user/Lorica \
  -DFETCHCONTENT_SOURCE_DIR_BOOST=/home/user/.cpp-deps/src/boost-1.87.0 \
  -DFETCHCONTENT_SOURCE_DIR_JSON=/home/user/.cpp-deps/src/nlohmann_json/json \
  -DCMAKE_EXPORT_COMPILE_COMMANDS=ON \
  -DTR_EXTENDED_HARDENING=AUTO          # AUTO / ON / OFF
# (任意) -DCMAKE_C_COMPILER_LAUNCHER=ccache -DCMAKE_CXX_COMPILER_LAUNCHER=ccache
cmake --build native/build -j2
ctest --test-dir native/build -j2 --output-on-failure
python3 /home/user/Lorica/tools/verify_binary.py native/build/bin/tirocinium-server
python3 /home/user/Lorica/tools/verify_binary.py native/build/bin/tirocinium-migrate

# DB を使うテスト (一時クラスタ、port 55433)
native/tools/pg_test_cluster.sh start
TR_TEST_DATABASE_URL=postgres://tirocinium@127.0.0.1:55433/tirocinium_test ctest --test-dir native/build --output-on-failure

# sanitizer (WIP の CMake option。未検証)
cmake -S native -B native/build-asan -G Ninja -DCMAKE_BUILD_TYPE=Debug -DTR_SANITIZE=address,undefined [上と同じ -D…]
cmake -S native -B native/build-tsan -G Ninja -DCMAKE_BUILD_TYPE=Debug -DTR_SANITIZE=thread [上と同じ -D…]
# fuzz (Clang。WIP。未検証)
CC=clang CXX=clang++ cmake -S native -B native/build-fuzz -G Ninja -DCMAKE_BUILD_TYPE=Debug -DTR_FUZZ=ON [上と同じ -D…]
native/build-fuzz/fuzz/fuzz_json -max_total_time=30 native/fuzz/corpus/json
```

まとめ役の共有機械では、重いビルドとテストを `/home/user/.cpp-deps/bin/buildslot` で包み、並列は `-j2` まで。
