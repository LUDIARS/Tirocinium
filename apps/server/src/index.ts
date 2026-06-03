import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { config } from './config.js';
import { health } from './routes/health.js';
import { reservations } from './routes/reservations.js';
import { sessions } from './routes/sessions.js';
import { personas } from './routes/personas.js';
import { summary } from './routes/summary.js';
import { feedback } from './routes/feedback.js';
import { ftRuns } from './routes/ft_runs.js';
import { training } from './routes/training.js';
import { attachSessionWs } from './ws/handler.js';
import { startTickScheduler, stopTickScheduler } from './reservation/tick.js';

const app = new Hono();

app.route('/health', health);
app.route('/api/v1/reservations', reservations);
app.route('/api/v1/sessions', sessions);
app.route('/api/v1/sessions', summary);
app.route('/api/v1/personas', personas);
app.route('/api/v1/feedback', feedback);
app.route('/api/v1/ft-runs', ftRuns);
app.route('/api/v1/training', training);

app.notFound((c) => c.json({ error: 'not_found' }, 404));

app.onError((err, c) => {
  // 内部エラー詳細 (err.message: stack/内部状態を含み得る) はレスポンスに出さず stderr のみに留める。
  // クライアントには汎用コードのみ返し、情報漏洩を防ぐ。
  console.error(err);
  return c.json({ error: 'internal' }, 500);
});

const server = serve(
  { fetch: app.fetch, port: config.port, hostname: config.host },
  (info) => {
    console.log(`tirocinium server listening on ${info.address}:${info.port}`);
  },
);

attachSessionWs(server as unknown as Parameters<typeof attachSessionWs>[0]);
startTickScheduler();

const shutdown = () => {
  console.log('shutting down');
  stopTickScheduler();
  server.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
