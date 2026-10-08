# scripts/specialist-sim — 専門面接シミュレーション

`spec/feature/inference/specialist-interviews.md` の専門面接 (シニア / 現場、聞きたい要点、逆質問への即答) を、
サーバ・DB・音声経路を使わずに 1 本通しで回す CLI。面接官と受験者の発話はどちらも `claude -p` で生成する。

面接官の指示は本番と同じ部品で組む: `specialistPersona` / `buildSystemPrompt` / `focusPointsPrompt` →
`renderFocusBlock` / `REVERSE_QUESTION_RULE` (専門面接の指示に含まれる)。受験者・企業・ES は `scenarios.ts` の架空データ。

```bash
npx tsx scripts/specialist-sim --scenario designer,programmer --out <出力フォルダ> --work <空の作業フォルダ>
```

| Flag | 既定 | 説明 |
|---|---|---|
| `--scenario` | 全シナリオ | `designer` (現場エンジニア面接) / `programmer` (シニア面接)。カンマ区切りで並行実行 |
| `--out` | `data/training/specialist-sim` | `<scenario>.json` を書く |
| `--work` | OS の一時フォルダ | `claude -p` を起動するフォルダ。リポの CLAUDE.md や hooks を読ませないため、リポ外の空フォルダを渡す |

出力 JSON: `scenario` / `focusPoints` (`senior` と `field`) / `focusSource` (`llm` か `fallback`) /
`turns` (面接官 10 発話: 導入 1・深掘り 4・反論 2・逆質問 3) / `summary` (本番のサマリー形式)。

`claude -p` 1 回は数秒〜十数秒。1 本あたり約 21 回呼ぶ。生成物はスタブではないが、ライブ面接 (音声・WS・再接続) の確認の代わりにはならない。
