# 新卒インタビュー記事クロール + 求める新卒像サマリ

新卒採用者インタビュー記事を **1 社最大 100 件**クロール保存し、それらを集約して
**「会社が求める新卒像」** を要約する。記事 raw は他機能 (ES添削/面接質問の素材等) でも
再利用するため保持する。

略称 **Tr**。companies の layer 2.5 (profile の隣)。面接練習の面接官観点づくりに使う。

---

## 1. データ (migration 005)

| テーブル | 役割 |
|---|---|
| `company_interview_articles` | クロールした記事の raw 保存 (`url`/`normalized_url`/`title`/`body`)。`(company_id, normalized_url)` で冪等。**再利用前提で残す** |
| `company_newgrad_images` | 会社が求める新卒像の要約 (`summary`/`themes[]`/`sources[]`/`article_count`/`model`)。companies と 1:1 |

個人特定情報は保持しない (記事本文は公開情報の要約用途、 サマリは人物像に抽象化し個人名を含めない)。

## 2. フロー (`crawlAndSummarizeNewgrad`)

```
seed URL (research.json の interview_urls を社名で company に紐付け)
  → depth0: seed を fetch → 本文保存 + 同種記事リンクを selectInterviewLinks で 1 hop 発見
  → depth1: 発見記事を fetch → 本文保存 (max 100 件で打ち切り)
       PoliteFetcher: robots 遵守 + 1ドメイン逐次 + Crawl-delay/最小間隔 + 礼節UA
  → 保存記事を結合 (総量 60k 字上限) → LLM 要約 (NEWGRAD_IMAGE_INSTRUCTION)
       → {summary, themes[]} を company_newgrad_images に upsert
```

- リンク選定 `selectInterviewLinks` (純粋, packages/companies): インタビュー/社員紹介/voice/member/story 等の語彙一致。seed が wantedly 等の集約サイトのため **cross-host 許可**。
- LLM は backend 非依存の `Completer` (`llm-completer.ts`): `api`=Anthropic / `cli`=claude CLI。ローカル(cli)で鍵不要。

## 3. CLI

```
npm run companies:newgrad-crawl                 # seed を持つ全社
npm run companies:newgrad-crawl -- --limit 3    # 先頭3社 (動作確認)
npm run companies:newgrad-crawl -- --company ネコノメ --max 20
```

- `--max` 1社あたり記事上限 (既定100, 1-100 にクランプ)。冪等 (再実行で記事 upsert・サマリ上書き)。
- 検証 (cli backend, SQLite): グラスホッパー1社で記事5保存・themes10件・summary 生成を確認。

## 4. consumer / 将来

- 面接質問リスト生成 ([[interview-questions.md]]) / ES添削の背景で、`company_newgrad_images.summary` を「この会社の面接官の観点」として注入。
- raw 記事 (`company_interview_articles`) は将来の RAG / 質問抽出の素材。
- robots で弾かれるサイト (大手ナビ等) は対象外。seed の質に依存。
