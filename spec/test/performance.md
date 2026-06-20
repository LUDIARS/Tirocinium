# パフォーマンス SLI / SLO

Tirocinium server (`apps/server`) のパフォーマンス目標 (SLO) と、それを測る指標
(SLI) の正本。面接練習という用途上、**対話のリアルタイム性**が最重要 KPI。

## 対象と非対象

- 対象: REST API / WS シグナリングの応答性、予約コーディネータの整合性。
- 非対象 (ここでは SLO を定めない): LLM 生成そのものの所要時間 (モデル依存)、
  音声 STT/TTS のレイテンシ (Imperativus 側の責務)。これらは「ユーザ体感」
  指標として別途 e2e で観測する。

## SLI (測定指標)

| SLI | 定義 | 計測点 |
|-----|------|--------|
| API latency | リクエスト受信〜レスポンス送出の所要時間 (LLM 待ちを除く) | server |
| WS turn latency | 発話確定〜AI 応答 first byte | server + LLM |
| Availability | 5xx を除く成功レスポンス率 | server |
| Reservation correctness | スロット capacity を超えて start しない | coordinator |
| Request overhead | ルーティング+ミドルウェアのインプロセス処理時間 | bench |

## SLO (目標値)

ローカル / サーバーモードの 1 台構成 (現フェーズ) を前提とする初期目標。実測が
貯まり次第見直す。

| 指標 | 目標 | 測定窓 |
|------|------|--------|
| 非 LLM API p95 latency | **< 150 ms** | 直近 1h |
| 非 LLM API p99 latency | < 400 ms | 直近 1h |
| Availability (非 LLM 5xx 率) | **≥ 99.5%** | 日次 |
| WS turn first-byte (LLM 込み) | p95 < 6 s (情報指標、モデル依存で gate しない) | 直近 1h |
| Request overhead p95 (bench) | **< 10 ms** (CI gate) | per-commit |
| セッション作成 rate limit | 既定 10 req / 60s / user (`SESSION_RATELIMIT_*`) | — |

## 計測手段

### CI: インプロセス退行ガード (DB/LLM 非依存)

`npm --workspace apps/server run bench` が Hono ルーティング + ミドルウェアの
リクエスト処理レイテンシ (p50/p95/p99 + ops/sec) を計測し、p95 が予算
(`BENCH_P95_BUDGET_MS`、既定 10ms) を超えると CI を fail させる。コミット毎に
フレームワーク層の退行を捕捉する。実装: `apps/server/bench/request-latency.ts`。

```
npm --workspace apps/server run bench
# => {"n":20000,"p50_ms":..,"p95_ms":..,"p99_ms":..,"ops_per_sec":..}
```

### 端から端 (DB + LLM 込み) の SLO 検証

DB (Postgres) と LLM バックエンドが要るため CI の unit job では回さない。
standalone プロファイル (`docker-compose.yml` + `.env.local`) を起動し、
代表シナリオ (セッション作成 → 数ターン → サマリ) を負荷ツール (oha / k6 等) で
叩いて上表の p95/p99/availability を確認する。手順は将来 `spec/setup/` に追記する。

## 運用メモ

- SLO 違反が定常化したら、まず SLI のどれが劣化したか (API 層 / LLM / DB) を
  切り分ける。bench が緑なのに体感が遅い場合は LLM/DB 側を疑う。
- 目標値は「2026-06 時点の 1 台構成」の初期値。水平スケール導入時に再設定する。
