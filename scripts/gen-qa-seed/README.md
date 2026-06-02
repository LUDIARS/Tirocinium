# scripts/gen-qa-seed — 想定質問 QA seed の合成生成

`data/general/` の一般解 QA seed を、**合法な合成生成**で量産する CLI。

## 方針 (合法性)

就活サイトはほぼ全て利用規約でスクレイピング/転載を禁止している。本ツールは
それらを一切取得せず、**定番の質問テーマ (観点) のみ** (`themes.ts`、創作性の低い
一般的テーマ) を種に、質問文・深掘り・評価軸・STAR 模範解答骨子を LLM が生成する。
特定企業・実在サービス名・他者の回答例は含めない。

本人特化データ (実際の ES/過去 Q&A) は別経路 (`POST /api/v1/training`、本人提供) で集める。

## 使い方

```bash
# 1 組だけ
npx tsx scripts/gen-qa-seed --stage hr --role programmer

# 全 16 組 (stage 4 × role 4)
npx tsx scripts/gen-qa-seed --all

# プロンプトだけ確認
npx tsx scripts/gen-qa-seed --stage hr --role programmer --dry-run
```

LLM は **claude CLI 経由** (`ANTHROPIC_API_KEY` 不要)。Windows は
`CLAUDE_CODE_GIT_BASH_PATH` が必要。

## 出力

`data/general/qa-seed/<stage>/<role>.json`:

```json
{
  "stage": "hr", "role": "programmer", "generated_at": "...",
  "items": [
    {
      "theme": "自己紹介",
      "question": "まず、ご自身を 1 分ほどで紹介してください。",
      "followups": ["その中で最も伝えたい強みを一つに絞ると?"],
      "axes": ["clarity", "self_understanding"],
      "answer_outline": "S: … T: … A: … R: …"
    }
  ]
}
```

## 次工程: AI 同士の模擬面接 + FB

QA seed が溜まったら `scripts/ft-loop` で受験者ペルソナ × 面接官ペルソナの
模擬面接を回し、Opus 評価 + サマリ + critique を生成する (シミュレーショントレーニング)。
