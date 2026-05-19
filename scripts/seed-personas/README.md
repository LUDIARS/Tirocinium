# scripts/seed-personas — ペルソナ seed 流し込み

`data/general/persona/{interviewer,examinee}/<id>.md` から frontmatter を読んで
`interviewer_personas` / `examinee_personas` テーブルに `is_seed=true` で upsert する。

LUDIARS migration ルール (immutable) を守りつつ seed を別管理にするための CLI。

## 使い方

```bash
$ npx tsx scripts/seed-personas
```

env:

- `DATABASE_URL` — apps/server と同じ Postgres を指す
- `DRY_RUN=1` — DB に流さず、 パース結果だけ出力する確認モード

## 冪等性

`ON CONFLICT (id) DO UPDATE` で再実行可能。 seed の内容が変わったら CLI 再実行で
DB を最新に合わせる。

## frontmatter ↔ DB 列マッピング

interviewer:

| frontmatter | DB 列 |
|---|---|
| id / display_name / stage / role_lens / temperament / pressure / tics / bio / evaluation_bias | 同名 |

examinee:

| frontmatter | DB 列 |
|---|---|
| id / display_name / background / target_role / weakness_axes / strengths / speech_style / intentional_flaws / bio | 同名 |

## 依存

- `gray-matter` (frontmatter パーサ) を apps/server の deps に追加
- 流し込み先は apps/server と同じ Postgres
