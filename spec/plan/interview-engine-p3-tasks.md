# 面接エンジン P3 タスク分解 — OB 接地 + 判定の卒業 + リプレイ

[`spec/feature/inference/interviewer-reproduction.md`](../feature/inference/interviewer-reproduction.md)
§6.2 / §6.4 / §7 表 8 / §7.1 / §8 の **P3** を実装するタスク分解 (着手前 task md)。
P1+P2 = [`interview-engine-voicevox-tasks.md`](./interview-engine-voicevox-tasks.md) (PR #141)。
本ブランチ (`feat/interview-engine-p3`) は PR #141 にスタックする。

- **スコープ外**: LLM 充足ゲート (決定的カウント版で当面十分 — spec §6.4 の「後回しでよい」を維持)、
  judge blackbox のレビュー Web UI (CLI レビューで開始)、Imperativus 本体の TTS。

## U1 OB 仮名化 serializer (spec §6.2)

- [x] U1.1 `apps/server/src/ob-patterns/ob-alias.ts` — `obAlias(cernereUserId)` =
      `OB#` + sha256 先頭 6 hex (決定的)。生 ID の露出はここで遮断
- [x] U1.2 ブリーフの「過去の質問傾向」行に contributor_alias を表示
      (`sources.getObPatterns` → brief-builder)

## U2 OB コーパス → 質問パターン抽出バッチ (spec §6.2)

- [x] U2.1 `apps/server/src/ob-patterns/extract.ts` — Memoria RAG 抜粋 (kind=past_qa、
      per-user スコープ) から質問の**型**を抽出する LLM 呼び出し (EXTRACTOR ロール) +
      出力の型検証 (coerce 流: 構造違反 throw / 値 clamp)。回答本文は保存しない
- [x] U2.2 `apps/server/src/ob-patterns/repo.ts` — `ob_question_patterns` upsert
      (company_id + theme + question_pattern で重複畳み込み)
- [x] U2.3 `scripts/ob-patterns/index.ts` — バッチ本体。`backdoor_alumni`
      (cernere_user_id, current_company_id 解決済み) を走査 → 各 OB の past_qa を
      Memoria RAG で引き (検索語は role-aliases で展開) → 抽出 → 仮名化して upsert。
      `--company <name>` 絞り込み / `--dry-run` / Memoria 未設定時は明示エラー

## U3 judge の卒業 — blackbox (spec §7.1)

- [x] U3.1 `@ludiars/blackbox` (npm.pkg.github.com 0.2.0) を apps/server に依存追加
- [x] U3.2 `apps/server/src/judge-blackbox/features.ts` — Q&A から決定的特徴量
      (回答長 / 文数 / 数字の有無 / 具体化マーカー / 質問との語彙重なり) を抽出
- [x] U3.3 `apps/server/src/judge-blackbox/index.ts` — 専用 sidecar SQLite
      (`data/judge-blackbox.sqlite`、本体 DB が PG でも動く) で `makeSqliteBlackBox`。
      domain=`judge-signals`。LLM フォールバック = Brain.assessAnswer
      (followupHint は構造外なので LLM 経路のみ)。seed ルール数件を candidate 投入
      (例: 極短回答 → synthesis 不成立)
- [x] U3.4 SessionRuntime 配線 — flag `TIROCINIUM_JUDGE_BLACKBOX=1` (既定 off)。
      on のとき judge 経路を blackbox.decide 経由に (ルール hit なら LLM スキップ)
- [x] U3.5 `scripts/judge-blackbox/index.ts` — レビュー CLI:
      `stats` / `pending` / `verdict <id> ok|ng` / `rules` (卒業状況の確認と人間 OK/NG)

## U4 リプレイ CLI (spec §7 表 8)

- [x] U4.1 `scripts/replay/index.ts` — `--session <id>`: interview_briefs から
      brief + seed を読み、質問プランを決定的に再構築 + StubBrain で一巡再生。
      記録済み turn がある場合はプランとの対応 (スロット消化順) を md で出力
- [x] U4.2 `--judge llm|stub` — 記録済み Q&A を指定 judge で再判定し、
      当時の phase 進行との A/B 比較表を出力 (judge 差し替え比較)

## U5 sparse → 自動学習ループ (spec §6.4)

- [x] U5.1 充足ゲートが sparse/moderate かつ企業解決済み + companies.url ありのとき、
      `enqueueCrawl` (source=interview-brief) を非同期投入 (面接開始は待たせない、
      重複は既存 dedup に任せる)

## U6 テスト

- [x] U6.1 ob-alias (決定性 / 形式) / extract の型検証 (LLM mock)
- [x] U6.2 ob-patterns repo — 実 SQLite (crawl-queue-repo.test.ts のパターン) で
      upsert / 重複畳み込み
- [x] U6.3 judge-blackbox — features の決定性、seed ルールの short-circuit
      (memory store)、LLM フォールバック経路 (mock)
- [x] U6.4 replay — 同 seed 再構築の一致 (実 SQLite)

## U7 spec / ドキュメント

- [x] U7.1 interviewer-reproduction.md の実装状況を P3 込みに更新
- [x] U7.2 spec/setup に judge-blackbox / ob-patterns バッチの運用手順
- [x] U7.3 新 env (`TIROCINIUM_JUDGE_BLACKBOX`) の記載

## 完了条件 (DoD)

- 全 workspace build + vitest green
- 実 SQLite で ob-patterns upsert → ブリーフ供給源に乗る (P2 経路との結合を裏取り)
- blackbox: seed ルールが short-circuit し、LLM フォールバックが ledger に記録される
- replay: PR #141 の verify セッション相当を `--session` で決定的再生できる
- PR 作成 (base = feat/interview-engine-voicevox、マージは指示待ち)
