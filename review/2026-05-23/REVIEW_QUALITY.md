# 品質保証レビュー — Tirocinium (2026-05-23) — Score 7/10

## 強み

- ✓ 関心の分離: packages/llm (orchestration), packages/training (RAG), packages/voice (I/O) 独立、training は @ludiars/lector 依存で汎用化
- ✓ 仕様ドキュメント: README/DESIGN/CLAUDE.md で意図明確、spec/ ディレクトリ AIFormat 準拠
- ✓ データフロー図: DESIGN に ASCII art (voice pipe / RAG flow / FT loop)
- ✓ テストカバー: weakness math (EMA 式) / slot coordinate / persona prompt 等のコアロジック
- ✓ 型定義完全性: Turn / Evaluation / PersonaInput / ServerFrame 等 union type 厳密

## 改善機会

- △ logging 基盤: console.error 散在、pino/winston 未導入 → 本番 trace 困難
- △ configuration management: .env.example minimal (MEMORIA_URL/IV_URL/CERNERE_PUBLIC_KEY 等記述不足)
- △ error recovery: LLM output parse 失敗で session 硬く close (retry/degradation 戦略なし)
- △ observability: 予約 slot tick / session lifetime / eval latency の metric なし
- △ CI/CD 整備: GH Actions (build/test/ft-loop dry-run) はあるが staging deploy 未記述
- △ migration strategy: SQL migration 001/002 append-only 宣言、down migration/rollback 未文書化

## 他リポとの整合

- Cernere: PASETO V4 verify (整合度 高)
- Memoria: API path (@/tirocinium/) 仕様未確定 (integration risk 中)
- Imperativus: client interface 定義済、実装待機 (blocking 高)
- Nuntius: push stub のみ (未統合)

## パフォーマンス

- ✓ WS stream: Sonnet response token 単位 yield (low-latency)
- ✓ async queue: AudioQueue で PCM chunk 効率 (backpressure 対応)
- △ Opus evaluation がバックグラウンド別 channel とあるが、session-runtime では同期待ち (仕様確認推奨)
- △ RAG topK=6 固定 (adaptive K 検討余地)
