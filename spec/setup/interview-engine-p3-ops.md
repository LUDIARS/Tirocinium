# 面接エンジン P3 運用手順 — OB 抽出 / judge blackbox / リプレイ

設計の正本は
[`spec/feature/inference/interviewer-reproduction.md`](../feature/inference/interviewer-reproduction.md)
§6.2 / §6.4 / §7。ここは運用コマンドだけをまとめる。

## OB 質問パターン抽出バッチ

```bash
npm run ob-patterns                        # 企業解決済みの全 OB を走査
npm run ob-patterns -- --company Example   # 企業で絞る
npm run ob-patterns -- --dry-run           # DB 書込なしで抽出結果を確認
npm run ob-patterns -- --topk 8 --db data/tirocinium.sqlite
```

- **MEMORIA_URL 必須** (未設定は即エラー — OB コーパスの正本は Memoria)。
- LLM は claude CLI (haiku) — API キー不要。
- 保存されるのは**質問の型のみ** (回答本文・生 ID は保存しない。投稿者は `OB#xxxxxx` に仮名化)。
- ログ: `data/training/ob-patterns/<date>-run.log`。
- 抽出結果は次回セッションのブリーフ「過去の質問傾向」と質問プラン (origin=ob) に自動で乗る。

## judge blackbox (判定の卒業)

| env | 値 | 意味 |
|---|---|---|
| `TIROCINIUM_JUDGE_BLACKBOX` | `1` / `0` (既定 `0`) | judge 経路を blackbox 経由に。不正値は throw |

- 判例 DB は sidecar SQLite `data/judge-blackbox.sqlite` (本体 DB が Postgres でも動く)。
- ルールのライフサイクル: seed/LLM 提案 (candidate、発火せず影評価)
  → 影一致が閾値到達で trial (発火 + 毎回レビュー待ち) → 人間 OK 蓄積で auto (卒業 = LLM 不要)。

```bash
npm run judge-blackbox -- stats            # 卒業メトリクス (ルール被覆率)
npm run judge-blackbox -- rules            # ルール一覧 (state / 影評価カウンタ)
npm run judge-blackbox -- pending          # レビュー待ち判断
npm run judge-blackbox -- verdict 12 ok    # 判断 #12 を OK
npm run judge-blackbox -- verdict 13 ng    # NG (閾値到達で撤回)
```

## リプレイ CLI

```bash
npm run replay -- --session <uuid>                 # プラン決定的再構築 + StubBrain 一巡
npm run replay -- --session <uuid> --judge llm     # 記録済み Q&A を stub vs llm で A/B
npm run replay -- --session <uuid> --out replay.md
```

- 対象は P2 プラン面接 (interview_briefs がある session) のみ。
- `--judge llm` は `ANTHROPIC_API_KEY` 必須。

## sparse → 自動学習ループ

充足ゲートが rich 未満 + 企業 URL ありのとき、ブリーフ構築時に `crawl_jobs`
(source=`interview-brief`) へ非同期投入される。面接開始はブロックしない。
投入状況は crawl queue の管理経路 (`recentCrawlJobs`) で確認できる。
