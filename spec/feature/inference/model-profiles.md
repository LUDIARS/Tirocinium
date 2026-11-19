# モデル構成 (論点 A) — 3 機種分担 vs collapse

## 現行の面接官発話

ユーザー指定により、実面接の Brain.composeUtterance は Sol (既定) または Opus の
subscription CLI を使用する。`TIROCINIUM_INTERVIEWER_MODEL=sol|opus` で選択し、
legacy `llmBackend=api` でも Sonnet API へ代替しない。サービス実行ユーザーの
Codex/Claude CLI インストール・既存認証が必要。失敗時は明示エラーとする。
以下の RESPONSE と profile 表は既存 API helper/旧 simulation の設定であり、
実面接発話のモデル選択には適用されない。他 role は今回変更しない。

面接推論エンジンのモデル割当を env で切り替え可能にし、「Sonnet 応答 / Opus 評価 /
Haiku judge の 3 機種分担」を必要に応じて collapse できるようにする。

## 役割と既定 (`packages/llm/src/model-profiles.ts` / `native/src/app/llm.cpp`)

| 役割 (ModelRole) | 既定 | 用途 |
|---|---|---|
| RESPONSE | Sonnet | 面接官応答 (stream) |
| EVALUATOR | Opus | 6 軸評価 |
| SUMMARIZER | Opus | session サマリ |
| CRITIC | Opus | より良い答え方の提案 |
| EXAMINEE | Haiku | 受験者シミュ (ft-loop) |
| JUDGE | Haiku | reactive 深掘りの回答品質判定 |
| EXTRACTOR | Haiku | 企業ページの構造化抽出 (`spec/companies`) |
| RECOMMENDER | Sonnet | ES × 企業の適合判断 (`spec/companies`) |

> EXTRACTOR / RECOMMENDER は面接エンジン外 (企業クロール + おすすめ企業) の役割。
> 面接ランタイム全体は [`interviewer-engine.md`](./interviewer-engine.md) を参照。

## 切り替え (優先順位: 役割別 env > プロファイル > 既定)

- `TIROCINIUM_MODEL_PROFILE`:
  - `default` — 3 機種分担 (既定)
  - `opus-only` — 応答/受験者/judge も Opus に寄せる (最高品質・高コスト)
  - `economy` — 評価/サマリ/critic を Sonnet に寄せる (低コスト)
- `TIROCINIUM_MODEL_<ROLE>` — 役割を個別に上書き。役割名 (`opus` / `sonnet` / `haiku` / `fable`) か、
  明示のモデル ID (そのまま使う) を書く。

## モデル ID の解決 (2026-11-19)

コードと設定例はモデル ID を持たず、役割名だけを持つ。役割名 → モデル ID は Concordia が
書き出す role map ファイル (`LUDIARS_MODEL_ROLES_FILE`、既定は `%LOCALAPPDATA%/LUDIARS/model-roles.json`
または `$XDG_STATE_HOME/ludiars/model-roles.json`) を Lapilli one-shot が読んで決める。

- Node: `resolveRequestModel(selection, 'claude' | 'codex')` (`packages/llm/src/model-resolution.ts`) が
  `@ludiars/one-shot` の `resolveModel` を呼ぶ。HTTP API は別名を受け付けないため、map が無ければ
  `model_role_unresolved:<role>` で止める。
- native: `lapilli::one_shot::resolve_model` / `prepare`。`app/one_shot.cpp` は Lapilli への委譲だけを持つ。
- 深掘り誘導 (REFINE) は TypeScript で `@ludiars/one-shot`、C++ で `Lapilli::one_shot` を経由して、購読認証済みの Codex CLI を起動する。既定は Codex 役割 `luna`。`OPENAI_MODEL_REFINE` で Codex の役割名または明示 ID を指定できる。
- 面接履歴は標準入力に渡す。起動はツールなしの JSON 出力モードで行い、完了したテキスト応答だけを論点に使う。REFINE の失敗時は既存の面接進行を継続する。
- 関連タスク `actio:75f80b0b-f16f-44dd-a8b2-f8a2c84e7e69`
- STT の API バックエンドは Concordia の役割に当たらないため既定を持たず、`TIROCINIUM_STT_API_MODEL` を必須とする。

## 3 機種分担の是非 (decision-metrics)

| 構成 | AI 学習量 | 作業コスト | 解決度 (面接品質) | 主目的一致 |
|---|---|---|---|---|
| **3 機種分担 (既定)** | 中 | 0 (現状) | 高 (役割最適) | 高 |
| opus-only | 低 | 小 | 最高だが応答レイテンシ増 | 中 (音声でレイテンシ不利) |
| economy | 低 | 小 | 中 (評価が浅くなりうる) | 中 |

結論: **既定は 3 機種分担を維持**。役割ごとに最適 (応答=低レイテンシの Sonnet、
評価=深い Opus、judge=軽量 Haiku) で、音声面接のレイテンシ要件とも噛み合う。
collapse は「品質検証時は opus-only」「コスト抑制時は economy」と**運用で選べる knob**
として用意するに留め、コードの分岐は増やさない。
