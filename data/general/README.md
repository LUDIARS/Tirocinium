# general/ — 一般解 (本人特化前のフォールバック教師データ)

職種別の「想定質問 + 評価される回答の枠組み + 浅い回答 (NG) + 深掘り質問 + 評価軸」 セット。
本人の ES / portfolio が **まだ無い / 不足している** 段階で、 RAG seed として面接 AI に
食わせるためのデータ。

本人データが揃ってきたら、 RAG 検索の重みは **本人素材 > 一般解** に逐次推移する想定。

---

## ファイル

| ファイル | 職種 | 件数 |
|---|---|---|
| `planner.md`    | ゲームプランナー (体験/数値/シナリオ設計) | 20 |
| `programmer.md` | ゲームプログラマー (Unity/UE/自作/ネット) | 20 |
| `designer.md`   | ゲームデザイナー (キャラ/背景/UI/3D/2D) | 20 |
| `sound.md`      | サウンド (BGM/SE/実装/ミックス) | 20 |

---

## 1 件の構造

各質問は `## NNN — <質問>` 見出しで区切る。 中身は次の固定 4 ブロック:

1. **評価軸** — `axes: [<axis1>, <axis2>, ...]`
   - 値は DESIGN §3.4 の 6 軸 (`consistency` / `clarity` / `demeanor`
     `self_understanding` / `target_fit` / `depth_resilience`)
2. **浅い回答 (NG パターン)** — その質問でありがちで Opus 評価が下がる回答群
3. **評価される回答の枠組み** — 「こう組み立てると刺さりやすい」 という方法論。
   具体的な内容ではなく **構造** を示す
4. **深掘り質問例** — Sonnet がそのまま使える follow-up 2-3 個

---

## frontmatter

各ファイル冒頭の YAML frontmatter は以下:

```yaml
---
role: planner | programmer | designer | sound
industry: game
locale: ja-JP
generated_at: 2026-05-19
source: tirocinium/data/general (LUDIARS internal)
license: internal-use-only
---
```

Memoria に流し込むときは、 1 質問 = 1 chunk として embedding する想定。
`role` + `axes` を tag に展開して vector search の filter にする。

---

## 注意

- 本ファイルは **業界一般論** であり、 特定企業・特定タイトルの内部情報は含まない。
- 「正解の暗記」 ではなく 「思考の枠組み」 を提示する。 同じ枠組みでも本人の経験で
  肉付けされた回答が、 評価最上位 (Opus axes 4-5) に乗る想定。
- 質問は新卒〜中途 3 年目を想定。 リード/マネージャ向けは別レイヤで用意する。
