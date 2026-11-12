# Tirocinium — job cpp-lorica-20261111 (W6) の状態

ブランチ `cpp/tirocinium-node-port`。job の着手時の先頭 `b89fc41`、引き継ぎ時の先頭 `9519c6a`。push はしていない。
決まりの正本はまとめ役の `COMMON.md` / `COMMON-2.md` / `NOTE-layers.md`。移植の正本の対応表は `native/PORTING.md`。
最終報告は `/home/user/.cpp-deps/reports/Tirocinium-report.md`。

この job で積んだコミット (古い順):

| SHA | 内容 | 段階 |
|---|---|---|
| 5ea7b8d | 棚卸し: 生成物の .pyc を追跡から外す | 棚卸し (前任) |
| b3422be | 依存: Lorica の固定を 5e8281b にそろえる | Lorica の適用 (前任) |
| 9efd01d | 土台: 全ビルド単位に Lorica、常駐サーバを EXTENDED | Lorica の適用 (前任) |
| fa0c904 | WIP: 入力経路の上限チェック・境界テスト・sanitizer / fuzz の入口 (前任は未コンパイル) | 入力の上限 / sanitizer と fuzz (前任) |
| 9519c6a | 引き継ぎ文書 | 文書 (前任) |
| d86a9d4 | WIP のビルドエラー・ヘッダの数の上限の抜け・深さの境界の期待値 | 入力の上限 (2 代目) |
| c07743f | `io/process.cpp` の stdout の長さを checked_add | 入力の上限 (2 代目) |
| 17766fd | WS 中継の循環参照の漏れ (LeakSanitizer)・線形性のテストの判定 | sanitizer と fuzz (2 代目) |
| ea5e3c3 | `.anatomia/layers.json` (要確認) | 文書 (2 代目) |
| (この文書の commit) | status.md・PORTING.md の更新 | 文書 (2 代目) |

## (a) 確かめたこと (2 代目、新しいコンテナ)

環境: Linux x86_64、GCC 13.3、Clang 18.1.3、CMake 3.28、Ninja、OpenSSL 3.0.13、libpq 16、PostgreSQL 16 (一時クラスタ)。
Lorica は `/home/user/Lorica` (5e8281b)。

- WIP fa0c904 のビルド: エラー 2 件 (`body_object(const Request&)` が非 const の `read_json_body` を呼ぶ。cernere.cpp・alumni_routes.cpp。
  companies_routes.cpp の `body_or_null` も同じ形) を直した。未使用の `<sstream>` / `<fstream>` を外した。GCC の警告 0。
- GCC RelWithDebInfo: ctest 30 本 (前の 21 + materials・input_bounds + fuzz の replay 7)。DB あり 30/30 通過、DB なし 26 通過・4 skip。
- ASan + UBSan (GCC Debug): ctest 30/30 (DB あり)。LeakSanitizer が見つけた漏れを直した後の結果 (下の (e))。
- TSan (GCC Debug): ctest 29/30 → 失敗 1 (線形性のテストの秒の上限) をテストの作りで直し、その 1 本を 3 回再実行して通過。データ競合の報告なし。
- fuzz (Clang 18、libFuzzer + ASan/UBSan): 入口 7 本を各 30 秒 (2 万〜37 万回)。クラッシュ・漏れ・UB なし。
- verify_binary: `tirocinium-server`・`tirocinium-migrate` とも PIE/NX/full RELRO (報告の 5 章に出力)。
- compile_commands.json: 自前の 97 単位すべてに `-fstack-protector-strong -fstack-clash-protection -fcf-protection=full
  -D_FORTIFY_SOURCE=3 -D_GLIBCXX_ASSERTIONS -include …/unsafe_api.hpp -Werror=deprecated-declarations`。
  EXTENDED (`-ftrivial-auto-var-init=zero` あり) 59 単位、baseline 38 単位。打ち消す設定なし。
- 3 つの所見: ssrf-guard・教材の読み込み・正規表現の二乗時間は、どれもテストで確かめた (報告の 9 章の前の節)。

## (b) 確かめていないこと

- MSVC / Windows のビルドと実行、Windows の EXTENDED (MSVC 19.44 x64 が要る)、`io/process.cpp` の Windows 側の分岐の実行。
- 実サービス (Cernere の本物の token、Discord の gateway、LLM の CLI、VOICEVOX など) との結合。

## (c) 途中のこと

なし (WIP fa0c904 の内容はすべてビルドしてテストした)。

## (d) 残り・この job ではやらないこと

- Discord の音声 (UDP) は C++ に受け口が無い (未移植・人間の判断)。上限チェックの対象の経路が存在しない。
- `io/resident_process.cpp` の行分割・`app/companies_worker.cpp` の 1 行 (16 MiB) は既存の上限のまま (予算を通していない)。
- WebSocket のフレームは `parse_json` の内部でメッセージごとに予算を作る (要求の予算とは別。変更なし)。
- catalog: 前回 9bc2840 で切り替え済み (本社テスト後に適用)。この job での変更なし。

## (e) 見つけて直した不具合

1. HTTP のヘッダのフィールド数の上限 (1,024) が、同じ名前を繰り返すと効かなかった (`http::Headers` が同じ名前を 1 件に
   連結するため)。受け口は Beast の受信したままのフィールドを数えて課金するようにした
   (`charge_header_block` / `add_header_line`)。ソケット越しの境界テスト (1,024 は 200 / 1,025 は 431) と単体の回帰を足した。
2. Cernere composite の WS 中継が、上流に繋がらないとき (502) と閉じた後に、relay と両側の接続を循環参照で残していた
   (ASan の LeakSanitizer で検出)。`ws_client` は接続に失敗したら callback を捨て、relay はどちらかが閉じたら参照を外す。
   relay の上流への参照は mutex の下で読み書きする。回帰: 上流が閉じたポートのとき 502 で断る場合を `pg_runtime_tests` に足した。
3. WIP の境界テストの期待値: JSON の深さの境界が 1 ずれていた (65 重の空の配列は、一番内側が深さ 64 = 上限ちょうどで通る)。
   数え方は既存の `core_json_tests` (nlohmann の depth、最上位 = 0) に合わせ、値ありの 64 / 65 重と空の 65 / 66 重の 4 通りにした。
   要素数の境界 (201,024 ちょうど / +1) は期待どおりだった。
4. 線形性のテストが秒の絶対値 (2 秒) で判定していて、TSan のビルドで外れた。入力を倍にした時の時間の比 (3 倍以下。二乗なら約 4 倍) で判定する形にした。

## (f) 人間の判断が要ること

報告の 9 章を参照 (前回の PORTING.md §6 の 7 件、`.anatomia/layers.json` の層の割り当て、JSON の要素数の上限が
ヘッダと共有になった点、Clang の警告の出所 (Lorica の symlink のパス) など)。

## (g) Lorica の適用表と上限チェック

適用表と上限の一覧は `native/PORTING.md` の §4 (「Lorica で課金している外部入力」「Lorica の適用」) と報告の 2・3 章。

## (h) 次にやる順番

1. まとめ役の受け入れテストと push。
2. 本社: Windows / MSVC でのビルドと ctest、実サービスでの確認 (PORTING.md §8)。

## (i) ローカルのビルドとテストの手順

PORTING.md §8 と同じ。共有機械では重いコマンドを `/home/user/.cpp-deps/bin/buildslot` で包み、並列は `-j2` まで。
DB を使うテストは `native/tools/pg_test_cluster.sh start <dir> <port>` の一時クラスタ (使い終わったら `stop` してディレクトリを消す)。

## (j) 追加: 「Lorica を使っているか」の ctest (COMMON-4 の作業 B)

- `tests/lorica_applied.cmake` の 6 本: `tirocinium.lorica_applied.{baseline,extended}` (翻訳単位の中から強制 include の印・`_GLIBCXX_ASSERTIONS`・`_LIBCPP_HARDENING_MODE` の字句・`_FORTIFY_SOURCE=3`・`checked_add` / `input_budget`)、`.unsafe_api_rejected` (`std::strcpy` の単位のコンパイルが Lorica の文言で止まる)、`.compile_commands` (`cmake -P`、自前の全単位のフラグと打ち消しの有無。EXTENDED は `tr_lorica(... SERVER)` のソースで `-ftrivial-auto-var-init=zero`)、`.verify_binary.{tirocinium-server,tirocinium-migrate}` (python3 があるときだけ)。
- configure 時の網羅の確認 `tr_check_lorica_coverage` (native/CMakeLists.txt) は無かったので足した: `tr_lorica()` を通らないコンパイルするターゲットで FATAL_ERROR。`CMAKE_EXPORT_COMPILE_COMMANDS` は top-level のとき ON。
- 壊して確かめた: `tirocinium-migrate` の `tr_lorica` を外す → configure が止まる。テストのターゲットに `-U_GLIBCXX_ASSERTIONS -fno-stack-protector`、`tr_core` に `-fcf-protection=none` → `.baseline` と `.compile_commands` (tr_core の 18 単位とテストの単位を名指し) が落ちる。元に戻した。
- GCC 13 RelWithDebInfo: ctest 36 本 (前の 30 + 6)。DB あり 36/36、DB なし 32 通過・4 skip。MSVC の枝と Visual Studio の generator での skip は未実行。

## (k) 追加: probe の名前をマクロで綴る (COMMON-5、2026-11-12)

- Praesidium の `native.unbounded-copy` (呼び出しの形の文字列の規則) に当たっていた 5 行 (`lorica_applied_tests.cpp` の代役の宣言 2 行と `decltype` 2 行、`lorica_unsafe_api_probe.cpp` の `std::strcpy(...)`) を `TR_PROBE_UNSAFE_NAME(str, cpy)` の形で綴り、使い終わったら `#undef` した。確かめる内容は変えていない。直した後、規則の実物 (`sourceFindings`) での指摘は 0 件。この job が足した・変えた C/C++ のファイル (取り込みの 79afacb で足した・変えた 158 本) でも、当たるのはこの 2 本だけだった (製品のコードは 0 件)。
- `.unsafe_api_rejected` は直した後も、展開後の `std::strcpy` が Lorica の `[[deprecated]]` (`-Werror=deprecated-declarations`) で拒否されて通過する (コンパイラの出力で確かめた。エラーは `'char* strcpy(char*, const char*)' is deprecated: Lorica: unbounded copy` の 1 件だけ)。
- GCC 13 RelWithDebInfo + 一時の Postgres (port 55642): ctest 36/36 (lorica_applied の 6 本を含む)。壊して確かめた: 強制 include を外して手でコンパイルすると、`lorica_applied_tests` は `::strcpy is not declared ...` で落ち (4/5)、`lorica_unsafe_api_probe.cpp` はコンパイルが通る (= `.unsafe_api_rejected` の文言が出ず失敗する)。
