import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { config } from './config.js';
import { health } from './routes/health.js';
import { reservations } from './routes/reservations.js';
import { sessions } from './routes/sessions.js';
import { personas } from './routes/personas.js';
import { summary } from './routes/summary.js';
import { feedback } from './routes/feedback.js';
import { ftRuns } from './routes/ft_runs.js';
import { training } from './routes/training.js';
import { companies } from './routes/companies.js';
import { recommendRoute } from './routes/recommend.js';
import { resources } from './routes/resources.js';
import { analyticsRoute } from './routes/analytics.js';
import { backdoor, backdoorPage, obJobsPage } from './routes/backdoor.js';
import { esRequests, esRequestsPage } from './routes/es-requests.js';
import { attachSessionWs } from './ws/handler.js';
import { startTickScheduler, stopTickScheduler } from './reservation/tick.js';
import { startEnrichQueue, stopEnrichQueue } from './companies/enrich-queue.js';
import { startJobNewsQueue, stopJobNewsQueue } from './companies/job-news-queue.js';
import { startDiscordBridge } from './discord/bridge.js';
import { hydrateSecrets } from './secrets/hydrate.js';
import { initSql } from './db/index.js';
import { assertSafeAuthConfig } from './auth/cernere.js';

// 起動順: hydrateSecrets → initSql → serve → Discord
// hydrateSecrets が失敗 (secret-agent 不通) したら起動を止める。
await hydrateSecrets();
assertSafeAuthConfig();
initSql();

const app = new Hono();

app.use('*', cors());

app.route('/health', health);
app.route('/api/v1/reservations', reservations);
app.route('/api/v1/sessions', sessions);
app.route('/api/v1/sessions', summary);
app.route('/api/v1/personas', personas);
app.route('/api/v1/feedback', feedback);
app.route('/api/v1/ft-runs', ftRuns);
app.route('/api/v1/training', training);
app.route('/api/v1/companies', companies);
app.route('/api/v1/recommend', recommendRoute);
app.route('/api/v1/resources', resources);
app.route('/api/v1/analytics', analyticsRoute);
app.route('/api/v1/backdoor', backdoor);
app.route('/backdoor', backdoorPage);
app.route('/ob-jobs', obJobsPage);
app.route('/api/v1/es-requests', esRequests);
app.route('/es-requests', esRequestsPage);

app.notFound((c) => c.json({ error: 'not_found' }, 404));

app.onError((err, c) => {
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
startEnrichQueue();
startJobNewsQueue();

let stopDiscordBridge: (() => void) | null = null;
void startDiscordBridge()
  .then((stop) => { stopDiscordBridge = stop; })
  .catch((err) => console.error('[discord] start failed', err));

const shutdown = () => {
  console.log('shutting down');
  stopDiscordBridge?.();
  stopTickScheduler();
  stopEnrichQueue();
  stopJobNewsQueue();
  server.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
