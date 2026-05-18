# Tirocinium — Claude 向けメモ

面接練習アプリ。LUDIARS 略称 **Tr**。

## 重要ルール

- 個人データ (履歴書 / ポートフォリオ / 面接ログ) は本サービスの責務範囲外。
  Cernere 認証 + 自リポは「セッションメタ + 評価結果」のみ保持。
  生の ES / 面接トランスクリプトの保管先は別途決める (Memoria? Curare?)。
- 音声入出力経路は **Imperativus (Iv)** を流用する。STT を Tirocinium 内に再実装しない。
- LLM 呼び出しはサーバーモードのみ。ローカルモードは ollama 等の軽量モデルで完結。
- AI モデル選定 (GPT-5.5 / Opus / Sonnet) は spec/code/llm-pipeline.md で確定する。

## branch 運用

- substantive な編集は必ず feat/ ブランチを切る (main 直編集禁止)
- 全変更は PR、自動 merge はしない (指示待ち)

## 関連 LUDIARS サービス

| 関係 | サービス | 用途 |
|---|---|---|
| 認証 | Cernere (Cr) | ユーザ identity |
| 通知 | Nuntius (Nt) | 予約成立 / 開始通知 |
| 音声 | Imperativus (Iv) | STT / TTS |
| データ | Memoria (Mm) | ES / 過去面接ログの永続化 (検討) |
| 通信 | Synergos (Sy) | サーバーモードの WS 経路 (検討) |
