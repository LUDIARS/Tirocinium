// インプロセスのリクエスト処理レイテンシ micro-bench。
//
// DB / LLM を持たない経路 (Hono ルーティング + ミドルウェア) のベースライン
// オーバーヘッドを計測する。CI で回せるよう外部依存ゼロ・決定的。
// 端から端まで (DB/LLM 込み) の SLO 検証は standalone プロファイルで別途行う
// (spec/web/performance.md 参照)。
//
// 実行: npm --workspace apps/server run bench
// 退出: p95 が予算超過なら非ゼロ (退行ガード)。予算は BENCH_P95_BUDGET_MS で調整。

import { Hono } from 'hono';
import { rateLimit } from '../src/middleware/rate-limit.js';

const app = new Hono();
// レート制限のオーバーヘッドも込みで測る (max を実質無制限にして 429 を出さない)。
app.use('*', rateLimit({ windowMs: 60_000, max: Number.MAX_SAFE_INTEGER, keyFn: () => 'bench' }));
app.get('/ping', (c) => c.json({ ok: true }));

const N = Number(process.env.BENCH_N ?? 20_000);
const WARMUP = 1_000;

for (let i = 0; i < WARMUP; i++) await app.request('/ping');

const lat: number[] = new Array(N);
for (let i = 0; i < N; i++) {
  const t = performance.now();
  await app.request('/ping');
  lat[i] = performance.now() - t;
}
lat.sort((a, b) => a - b);

const pct = (p: number): number => lat[Math.min(lat.length - 1, Math.floor(lat.length * p))];
const total = lat.reduce((s, x) => s + x, 0);
const result = {
  n: N,
  p50_ms: +pct(0.5).toFixed(4),
  p95_ms: +pct(0.95).toFixed(4),
  p99_ms: +pct(0.99).toFixed(4),
  ops_per_sec: Math.round(N / (total / 1000)),
};
console.log(JSON.stringify(result));

const budget = Number(process.env.BENCH_P95_BUDGET_MS ?? 10);
if (result.p95_ms > budget) {
  console.error(`[bench] p95 ${result.p95_ms}ms exceeds budget ${budget}ms`);
  process.exit(1);
}
