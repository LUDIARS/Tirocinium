import 'dotenv/config';

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

function num(name: string, fallback: number): number {
  const v = process.env[name];
  return v ? Number.parseInt(v, 10) : fallback;
}

export const config = {
  port: num('TIROCINIUM_PORT', 8084),
  host: process.env.TIROCINIUM_HOST ?? '0.0.0.0',
  databaseUrl: req('DATABASE_URL'),
  cernerePublicKey: process.env.CERNERE_PUBLIC_KEY ?? '',
  cernereAudience: process.env.CERNERE_AUDIENCE ?? 'tirocinium',
  slotDurationMin: num('SLOT_DURATION_MIN', 30),
  slotCapacity: num('SLOT_CAPACITY', 4),
  noShowTimeoutMin: num('NO_SHOW_TIMEOUT_MIN', 5),
  notifyLeadMin: num('NOTIFY_LEAD_MIN', 15),
  nuntiusUrl: process.env.NUNTIUS_URL ?? '',
  nuntiusApiKey: process.env.NUNTIUS_API_KEY ?? '',
} as const;
