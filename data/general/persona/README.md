# persona/ — ペルソナ seed

LUDIARS 提供の seed ペルソナ。 起動時 (or migration の seed phase) で
`interviewer_personas` / `examinee_personas` テーブルに `is_seed=true` で
流し込む。

DESIGN.md §3.5 (面接官) / §3.6 (受験者) 参照。

---

## ディレクトリ

| ディレクトリ | 中身 | 件数 |
|---|---|---|
| `interviewer/` | 面接官ペルソナ (stage × 性格傾向) | 8 |
| `examinee/`    | 受験者ペルソナ (テスト / FT loop 用) | 5 |

---

## ペルソナ frontmatter (interviewer)

```yaml
---
id: hr-warm-40f
display_name: 田中 (人事)
stage: hr             # hr | peer-tech | lead-tech | final
role_lens: any        # planner | programmer | designer | sound | any
temperament: warm     # warm | neutral | strict | sharp | nurturing
pressure: 2           # 1-5
tics:
  - "なるほど、 〜なんですね"
  - "もし差し支えなければ"
bio: |
  人事部 採用担当 15 年。 元営業職、 育休後復職。
  カルチャーフィットを重視するタイプ。
evaluation_bias:
  demeanor: 1.3
  self_understanding: 1.2
  target_fit: 1.1
locale: ja-JP
generated_at: 2026-05-19
license: internal-use-only
---
```

## ペルソナ frontmatter (examinee)

```yaml
---
id: examinee-newgrad-programmer-shy
display_name: 中村 (新卒・プログラマ志望)
background: |
  情報系大学 4 年。 個人で Unity 触歴 2 年、 チーム開発は学校課題のみ。
target_role: programmer
weakness_axes:
  clarity: 3          # 0-5、 大きいほど弱い (= 弱点として表出)
  demeanor: 4
  depth_resilience: 3
strengths:
  - "技術話に強い"
  - "事前準備をしっかりやる"
speech_style: nervous  # formal | casual | nervous | verbose
intentional_flaws:
  - "結論より先に経緯から話してしまう"
  - "詰められると沈黙が長くなる"
  - "自己 PR が薄い"
bio: |
  ゲームプログラマーを目指して 2 年。 個人で 3D アクションのプロトを 1 本完成、
  ポートフォリオは GitHub + デモ動画。
  集団面接が苦手。
locale: ja-JP
generated_at: 2026-05-19
license: internal-use-only
---
```

---

## 本文の役割

frontmatter の下に Markdown 本文を 200-400 字。 「この人物は何を話しがちか」 を
具体的なフレーズで描写する。 これは LLM の system prompt に「役柄ガイド」 として
注入される。
