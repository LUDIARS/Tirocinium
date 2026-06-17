# コード品質レビュー（共通） — LUDIARS/Tirocinium

| 項目 | 値 |
|------|-----|
| リポジトリ | LUDIARS/Tirocinium |
| 対象ブランチ / PR | main |
| レビュー実施日 | 2026-06-02 |
| 対象コミット範囲 | 2026-05-23 以降 (11 commits) |

---

## 1. コード品質

| 該当箇所 | 問題分類 | 説明 | 推奨修正 |
|----------|---------|------|---------|
| `apps/server/src/ws/session-runtime.ts:136` | 例外握りつぶし | memoria fail が warn のみ、理由コメント無し (§7) | 理由コメント追加 (autofix) |
| `apps/server/src/ws/session-runtime.ts:285` | 例外握りつぶし | judge fail が warn のみ、理由コメント無し (§7) | 理由コメント追加 (autofix) |
| `apps/server/src/index.ts:30` | 機密情報露出 | err.message を 500 で返す | message 省略 (autofix) |
| `apps/server/src/ws/session-runtime.ts` (handleUserTurn) | 関数長大 | 100+ 行で複数の非同期を逐次。orchestrator role で許容範囲だがテスト性低下 | 将来 refactor で部分関数化 |

### RULE_CODE 対応チェック
- [x] §1 SRP: llm/voice/feedback は単一責務。session-runtime は orchestrator (正当)
- [x] §2 ファイル分割: routes/llm/feedback/voice で責任分割
- [x] §3 レイヤー依存: llm/voice → server の一方向、循環なし
- [x] §4 命名: assessAnswer / applyEvaluation など役割明示 (latestSignals は若干 implicit)
- [x] §5 制御フロー: early-return / guard clause でネスト浅い
- [ ] §7 例外: `:397` は理由コメントあり ("評価失敗は session を止めない")、`:136`/`:285` は欠如 (autofix)
- [x] §8 型: 全 tsconfig strict、any 濫用なし、戻り値型明示
- [x] §9 入力検証: training kind 白リスト、frames exhaustive、JSON.parse guard
- [x] §10 資源寿命: MicCapture start/stop 対称、WS open/close、pg 接続池
- [x] §11 並行: background は `void this.run...()` で fire-and-forget だが内部 try/catch あり (swallow 改善余地)
- [x] §13 子プロセス: LLM は SDK 経由、shell spawn なし
- [x] §14 secret: API key/PASETO は env、直書きなし。ただし §脆弱性: err.message レスポンスは要修正
- [x] §16 時刻: ISO8601 / TIMESTAMPTZ 使用
- [x] §19 const 既定 / non-null: 適切

### コメント
- core logic (phase/judge/evaluator/weakness-math) は clean で単体テスト済。
- 改善点は (1) background swallow の理由コメント、(2) err.message レスポンスの sanitize に集約。いずれも bounded。

---

## 総合評価

| # | レビュー観点 | 評価 | 重大指摘数 |
|---|------------|------|-----------|
| 1 | コード品質 | A- | 0 (Medium 1: err leak / Low 2: swallow comment) |
