# GitHub Actions

## ci.yml

main / PR で走る基本 CI。

- node 22 で `npm ci` → 全 workspace の build → 全 workspace の test
- 別ジョブで `scripts/ft-loop --dry-run` を 全 interviewer × shy programmer の組合せで実行
  (gray-matter のパース + persona ファイル整合性チェック)

実 LLM (Anthropic/OpenAI) や DB (Postgres) は **使わない**。
- API key を secrets に置いて nightly で回す統合 CI は別ワークフローで追加 (今後)

## 今後追加するワークフロー (案)

- `ci-db.yml`: Postgres service + migrate + 統合テスト (実 SQL の動作確認)
- `ci-llm.yml`: secrets で API key を取り、 各 piece (evaluator/summarizer/critic/refine) を実 LLM で叩く smoke test (cron で日次)
- `release.yml`: tag push 時に apps/desktop の Tauri build artifacts (Windows / macOS / Linux) を作る
