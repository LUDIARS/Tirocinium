# AI Code Review — LUDIARS/Tirocinium

| 項目 | 値 |
|------|-----|
| リポジトリ | LUDIARS/Tirocinium |
| 対象ブランチ | main |
| レビュー実施日 | 2026-05-23 |
| 対象コミット範囲 | 2026-05-20 以降 (2 commits) |

## ステータス

設計フェーズから実装フェーズへ移行。最新 2 commit (5/22) で ft-loop を Claude Code CLI 駆動化、ES/面接データ解析を Lector 統合で実装。

## 完成度

約 70%。Sonnet streaming + Opus 評価 + GPT-5.5 深掘り補正、予約スロット管理、弱点プロファイル EMA、WS session runtime の基盤完成。

**未実装**:
- Imperativus STT/TTS 本結線 (型定義のみ)
- DesktopUI 大部分実装済みも組み込み未確認
- CI/test 基盤完備

## 主要達成

- LLM 複合オーケストレーション完了 (Sonnet+Opus+GPT-5.5)
- 面接官/受験者ペルソナシステム (8+5 種テンプレート)
- 予約スロット 30 分単位 + Nuntius 通知スタブ
- 弱点軸 6 本 EMA (§3.2.2 仕様)
- training パッケージで Notion/Chat parser (Lector) 統合
- ft-loop の claude CLI 駆動化 (stdin/env 経由 ENAMETOOLONG 回避)

## 主要懸念

1. Imperativus STT/TTS パイプ TODO のまま
2. WS token 認証で query param 許容 → URL logging/referer leak リスク
3. eval/summary/critique LLM prompt の JSON parse 失敗時 throw (上流 catch 不十分)
4. session-runtime が memoria/iv health failure 時 silent skip
5. desktop UI の foundation tokens 導入済だが wire-up 確認なし

## 総合評価

| # | レビュー観点 | 評価 |
|---|------------|------|
| 1 | 設計適合度 | 8.5/10 (A-) |
| 2 | コード品質 | 7.5/10 (B+) |
| 3 | セキュリティ | 6.5/10 (B) |
| 4 | 保守性・拡張性 | 7/10 (B+) |
