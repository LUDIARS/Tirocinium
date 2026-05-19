import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { config } from './config.js';
import { health } from './routes/health.js';
import { reservations } from './routes/reservations.js';
import { sessions } from './routes/sessions.js';

const app = new Hono();

app.route('/health', health);
app.route('/api/v1/reservations', reservations);
app.route('/api/v1/sessions', sessions);

app.notFound((c) => c.json({ error: 'not_found' }, 404));

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'internal', message: err.message }, 500);
});

const server = serve(
  { fetch: app.fetch, port: config.port, hostname: config.host },
  (info) => {
    console.log(`tirocinium server listening on ${info.address}:${info.port}`);
  },
);

const shutdown = () => {
  console.log('shutting down');
  server.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
