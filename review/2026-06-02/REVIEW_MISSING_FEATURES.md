# 不足機能評価（共通） — LUDIARS/Tirocinium

| 項目 | 値 |
|------|-----|
| リポジトリ | LUDIARS/Tirocinium |
| 対象ブランチ / PR | main |
| レビュー実施日 | 2026-06-02 |
| 対象コミット範囲 | 2026-05-23 以降 (11 commits) |

---

## 1. 機能の改善提案

| 対象機能 | 改善提案 | 期待効果 | 優先度 |
|---------|---------|---------|--------|
| 評価軸 | 逆質問 (closing phase) を separate turn として capture・評価 (6軸→7軸) | 実面接の印象要素を反映 | Medium |
| coaching | GPT refine を拡張し session 中の low-latency coaching hint を UI emit | 練習中の即時フィードバック | Medium |
| weakness profile | hint 適用後の改善度を別 table で追跡 | hint 有効性分析 | Low |
| persona | session に experiment metadata 記録 → persona 別スコア比較 | persona 効果測定 | Low |

## 2. 不足機能の提案

| 提案機能 | 必要性の根拠 | 実装優先度 | 想定影響範囲 |
|---------|------------|-----------|------------|
| TTS 結線 | `iv-client.ts` の tts() が TODO empty。音声「聴く→話す」cycle 未成立 | High | voice / session-runtime / desktop AudioContext |
| data retention / user deletion | 個人データ (ES/面接ログ) の削除・保持期限が未定義 (DESIGN deferred) | High | migration (CASCADE) + Memoria sync + 手順書 |
| integration test | session-runtime + judge + phase の連携 / Memoria fail path が未テスト | Medium | test 基盤新設 |
| GDPR export | user が自分の面接ログ/評価を export | Medium | GET /api/v1/export |
| overload protection | live session の overcapacity handling (予約誘導は実装済) | Medium | tick-rules |

### 観点
- TTS と data retention は本番前の Must。逆質問評価 / coaching hint は UX 向上の Should。
- 既知制限は DESIGN.md / spec に概ね記載され forward-compatible。

---

## 総合評価

| # | レビュー観点 | 指摘数 | 優先度別内訳 |
|---|------------|--------|------------|
| 1 | 機能改善 | 4 | High: 0 / Medium: 2 / Low: 2 |
| 2 | 不足機能 | 5 | High: 2 / Medium: 3 / Low: 0 |
