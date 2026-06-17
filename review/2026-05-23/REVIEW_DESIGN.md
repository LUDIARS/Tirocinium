# 設計レビュー — Tirocinium (2026-05-23) — Score 8.5/10

## 仕様への忠実度

- § 3.2 RAG + 弱点プロファイル: Memoria ref + embedding id 保持、本文不保持 (データ責務分離 OK)
- § 3.3 LLM 構成: 3 層 (Sonnet/GPT-5.5/Opus) 完全実装、stream 並行
- § 3.5 面接官ペルソナ: 8 種 seed personas + system prompt 注入、evaluation_bias 重み対応
- § 3.6 受験者ペルソナ: 5 種 seed + FT loop (simulate/self-critique/human-feedback サイクル)
- § 3.7 サマリ: Opus で headline/highlights/axes_summary/growth_points/carry_over/interviewer_note 生成
- § 3.8 人間フィードバック: human_feedback → weakness_profiles hint_history、training_data_refs weight 局所調整
- § 3.9 FT loop: scripts/ft-loop で examinee/interviewer を claude CLI 化 (§3.9 ①②③④自動化、⑤ JSON 保存)
- § 5 予約フロー: 30 分 slot / per-user 1 件制限 / 15min 前通知 / no-show 5min タイムアウト完了

## 設計からの逸脱

0 件 (仕様を厳密に追跡)。

## 未実装の仕様機能 (2 件)

1. ローカルモード (ollama 軽量モデル選定待ち) → DESIGN § 2.1
2. Imperativus 音声パイプ (Iv API 仕様待ち) → DESIGN § 4

## 曖昧点対応

- § 3.2.3「fine-tune は将来検討」 → prompt+RAG 疑似学習に限定
- § 5.5「局所サーバー v2 以降」 → 未実装
- weak_top3 初期値: initialSnapshot で axis ごと 3.0 デフォルト (適切)
