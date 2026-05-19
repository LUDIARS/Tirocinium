# AI Code Review — Tirocinium (面接練習アプリ)

| 項目 | 値 |
|------|-----|
| リポジトリ | LUDIARS/Tirocinium |
| 対象ブランチ | main (4 commits since 初回) |
| レビュー実施日 | 2026-05-19 |
| 対象コミット範囲 | 6d7a268..2a7ead1 (scaffold + spec + seed data) |
| 段階 | Scaffold (spec 確定、 実装未着手) |

## 総合評価

| # | レビュー観点 | 評価 | 重大指摘数 |
|---|------------|------|-----------|
| 1 | 脆弱性 | C | 0 |
| 2 | 設計強度 | B | 0 |
| 3 | 設計思想の一貫性 | B | 0 |
| 4 | モジュール分割度 | B | 0 |
| 5 | コード品質 | C | 0 |
| 6 | データスキーマ | B | 0 |
| 7 | 機能改善 | A | - |
| 8 | 不足機能 | D | - |
| 9 | SRE | D | 0 |
| 10 | ゼロトラスト | C | 0 |
| 11 | セキュリティ | C | 0 |
| 12 | テスト戦略・カバレッジ | D | 0 |
| 13 | パフォーマンス・ベンチマーク | C | 0 |
| 14 | ライセンス遵守 | B | 0 |
| 15 | クロスプラットフォーム互換 | B | 0 |
| 16 | ドキュメント完備性 | B | 0 |

## サマリー

**初回レビュー** — scaffold 段階。コミット 4 件で spec / DESIGN / CLAUDE / 学習方式仕様 (Method B: RAG + 弱点プロファイル) / host port 割当 (backend 8084, vite 5178) / seed general QA (4 types × 20) を整備。実装本体は未着手 → SRE / テスト / パフォーマンスは D 評価。設計とドキュメントは A-B クラス。

- **モード**: ローカル (ollama 軽量) / サーバー (複合 LLM + 予約枠管理)
- **音声**: Imperativus (Iv) に STT/TTS 委譲
- **個人データ**: Memoria に永続化、 Tirocinium は参照 ID のみ保持
- **実装スタック**: Tauri 2 desktop + Hono server + npm workspaces

## 主な指摘

### High Priority (scaffold 段階の前提として)
1. **実装未着手** — apps/server, apps/desktop, packages/* の骨組のみ、 ロジック未実装
2. **Cernere PASETO verify 実装方針記載なし** — memory `Cernere は /auth しか開かない` 参照だが、 spec に verify logic の記述未追加
3. **LLM キー管理策未記載** — 複合 LLM (GPT-5.5 / Opus / Sonnet) の API key 管理 (Infisical 経路) が spec/llm/ に未明文化

### Medium Priority
1. **error response スキーム未記載** — `spec/web/*.md` に endpoint 列挙はあるが、 標準エラーレスポンスの統一形式が未定義
2. **過負荷時 30 分 slot 予約の競合制御未確定** — `spec/reservation/*.md` に slot 抽象はあるが、 同時予約争奪解決のアルゴリズム未指定
3. **schema v1 の constraint 検証**: 8 表構造化済だが FK / index は実装段階で検証

### Light Priority
- LICENSE が未確認 (scaffold 直後)

**weighted_score: C** (scaffold 段階としては適切、 実装着手後に B+ 以上が期待値)
