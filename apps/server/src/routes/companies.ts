import { Hono } from 'hono';
import { cernereAuth } from '../auth/cernere.js';
import { listSourceIds } from '@tirocinium/companies';
import { config } from '../config.js';
import { listCompanies, getCompany, countCompanies } from '../companies/repo.js';
import { runCrawl } from '../companies/crawler.js';
import { loadSeedRecords } from '../companies/seeds.js';

/**
 * 企業プール (companies) の参照とクロール起動。
 * 企業情報は公開情報のため保持可 (DESIGN §6)。 クロールは外部 fetch を伴うため
 * COMPANY_CRAWL_ADMIN_IDS が設定されていればその user のみに制限する。
 */
export const companies = new Hono();
companies.use('*', cernereAuth);

/** クロール許可判定。 admin allowlist 未設定なら全 authed user 可 (dev)。 */
function canCrawl(userId: string): boolean {
  const ids = config.companyCrawl.adminIds;
  return ids.length === 0 || ids.includes(userId);
}

/** GET /api/v1/companies — 企業一覧 (role/tag/industry/q/limit/offset) */
companies.get('/', async (c) => {
  const q = c.req.query();
  const rows = await listCompanies({
    role: q['role'],
    tag: q['tag'],
    industry: q['industry'],
    q: q['q'],
    limit: q['limit'] ? Number.parseInt(q['limit'], 10) : undefined,
    offset: q['offset'] ? Number.parseInt(q['offset'], 10) : undefined,
  });
  return c.json({ companies: rows, total: await countCompanies() });
});

/** GET /api/v1/companies/sources — 利用可能なクロールソース一覧 */
companies.get('/sources', (c) => c.json({ sources: listSourceIds() }));

/** GET /api/v1/companies/:id — 企業詳細 */
companies.get('/:id', async (c) => {
  const company = await getCompany(c.req.param('id'));
  return company ? c.json({ company }) : c.json({ error: 'not_found' }, 404);
});

/** POST /api/v1/companies/crawl — クロール起動 { source, urls?, maxPages? } */
companies.post('/crawl', async (c) => {
  const user = c.get('user');
  if (!canCrawl(user.id)) return c.json({ error: 'forbidden' }, 403);

  const body = (await c.req.json().catch(() => null)) as {
    source?: string;
    urls?: string[];
    maxPages?: number;
  } | null;

  const source = body?.source ?? 'manual';
  if (!listSourceIds().includes(source)) {
    return c.json({ error: 'invalid_source', sources: listSourceIds() }, 400);
  }

  const urls = Array.isArray(body?.urls) ? body!.urls.filter((u) => typeof u === 'string') : [];
  // seed-file ソースはサーバ側 data から読む。
  const seedRecords = source === 'seed-file' ? await loadSeedRecords() : undefined;

  if (source === 'manual' && urls.length === 0) {
    return c.json({ error: 'urls_required_for_manual' }, 400);
  }

  try {
    const summary = await runCrawl({ source, urls, seedRecords, maxPages: body?.maxPages });
    return c.json({ summary }, 200);
  } catch (err) {
    return c.json({ error: 'crawl_failed', detail: (err as Error).message }, 502);
  }
});
