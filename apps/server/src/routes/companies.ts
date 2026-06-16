import { Hono } from 'hono';
import { cernereAuth } from '../auth/cernere.js';
import { listSourceIds } from '@tirocinium/companies';
import { config } from '../config.js';
import { listCompanies, getCompany, countCompanies } from '../companies/repo.js';
import { runCrawl } from '../companies/crawler.js';
import { loadSeedRecords } from '../companies/seeds.js';
import { runListingCrawl } from '../companies/listing-crawler.js';
import { runEnrichment } from '../companies/enrich.js';
import { loadListingSources, selectActiveSources } from '../companies/listing-config.js';
import { getProfile } from '../companies/profile-repo.js';
import { getNewgradRoleImages, listInterviewArticles } from '../companies/newgrad-repo.js';
import { searchGames, relatedCompaniesByGame, companiesByTech, getGamesByCompany } from '../companies/games-repo.js';
import { getObSummary, getObPlacements, topCompaniesByOb, topObStudios } from '../companies/ob-repo.js';
import { syncObFromSheet } from '../companies/ob-sheet-sync-wire.js';
import { runContribute } from '../companies/contribute.js';
import { enrichQueueStatus } from '../companies/enrich-queue.js';
import { buildMapMarkers } from '../companies/geocode.js';

/**
 * 企業プール (companies) の参照とクロール起動。
 * 企業情報は公開情報のため保持可 (DESIGN §6)。 クロールは外部 fetch を伴うため
 * COMPANY_CRAWL_ADMIN_IDS が設定されていればその user のみに制限する。
 */
export const companies = new Hono();

/** クロール許可判定。 admin allowlist 未設定なら全 authed user 可 (dev)。 */
function canCrawl(userId: string): boolean {
  const ids = config.companyCrawl.adminIds;
  return ids.length === 0 || ids.includes(userId);
}

/** GET /api/v1/companies — 企業一覧 (role/tag/industry/q/limit/offset) */
companies.get('/', async (c) => {
  const q = c.req.query();
  // quality=1 でノイズ (どのゲームにも未紐付け) を除外、 summarized=1 で情報なし (概要空) を除外。
  // list/count 双方に適用して total を整合。
  const quality = q['quality'] === '1' || q['quality'] === 'true';
  const summarized = q['summarized'] === '1' || q['summarized'] === 'true';
  // newgrad=1 で新卒採用あり、 opening=1 で募集中だけに絞る (既定の優先ソートとは独立)。
  const newgrad = q['newgrad'] === '1' || q['newgrad'] === 'true';
  const opening = q['opening'] === '1' || q['opening'] === 'true';
  const filter = {
    role: q['role'],
    tag: q['tag'],
    industry: q['industry'],
    q: q['q'],
    quality,
    summarized,
    newgrad,
    opening,
  };
  const rows = await listCompanies({
    ...filter,
    limit: q['limit'] ? Number.parseInt(q['limit'], 10) : undefined,
    offset: q['offset'] ? Number.parseInt(q['offset'], 10) : undefined,
  });
  return c.json({
    companies: rows,
    total: await countCompanies(filter),
  });
});

/** GET /api/v1/companies/sources — 単体取得 (manual/seed-file) クロールソース一覧 */
companies.get('/sources', (c) => c.json({ sources: listSourceIds() }));

/** GET /api/v1/companies/listing-sources — listing クロールの設定済ソース (有効可否つき) */
companies.get('/listing-sources', async (c) => {
  const all = await loadListingSources();
  const active = new Set(selectActiveSources(all).map((s) => s.id));
  return c.json({
    sources: all.map((s) => ({ id: s.id, kind: s.kind, urls: s.urls.length, active: active.has(s.id), note: s.note })),
  });
});

/** GET /api/v1/companies/games/search?q=... — ゲームをタイトルで検索 (関連会社さがしの入口) */
companies.get('/games/search', async (c) => {
  const q = (c.req.query('q') ?? '').trim();
  if (!q) return c.json({ games: [] });
  const limit = c.req.query('limit') ? Number.parseInt(c.req.query('limit')!, 10) : undefined;
  return c.json({ games: await searchGames(q, limit) });
});

/** GET /api/v1/companies/games/:gameId/related — ゲーム起点の関連会社探索 (direct + related) */
companies.get('/games/:gameId/related', async (c) => {
  const truthy = (v: string | undefined): boolean => v === '1' || v === 'true';
  const result = await relatedCompaniesByGame(c.req.param('gameId'), {
    smb: truthy(c.req.query('smb')),
    newgrad: truthy(c.req.query('newgrad')),
    opening: truthy(c.req.query('opening')),
    social: truthy(c.req.query('social')),
    engine: c.req.query('engine') || undefined,
    limit: c.req.query('limit') ? Number.parseInt(c.req.query('limit')!, 10) : undefined,
  });
  return result.game ? c.json(result) : c.json({ error: 'not_found' }, 404);
});

/** GET /api/v1/companies/by-tech?tech=Unreal — 技術名で企業を引く (技術グラフ直接クエリ) */
companies.get('/by-tech', async (c) => {
  const tech = (c.req.query('tech') ?? '').trim();
  if (!tech) return c.json({ companies: [] });
  const truthy = (v: string | undefined): boolean => v === '1' || v === 'true';
  const rows = await companiesByTech(tech, {
    smb: truthy(c.req.query('smb')),
    social: truthy(c.req.query('social')),
    limit: c.req.query('limit') ? Number.parseInt(c.req.query('limit')!, 10) : undefined,
  });
  return c.json({ companies: rows });
});

/** GET /api/v1/companies/map-config — Google Maps の有効可否 + JS API key (referrer 制限前提で公開) */
companies.get('/map-config', (c) => {
  const apiKey = config.googleMaps.apiKey;
  return c.json({ enabled: Boolean(apiKey), apiKey });
});

/** GET /api/v1/companies/map-markers — 企業所在地のマーカー (未 geocode は順次解決) */
companies.get('/map-markers', async (c) => {
  const max = c.req.query('max') ? Number.parseInt(c.req.query('max')!, 10) : undefined;
  return c.json(await buildMapMarkers(max));
});

/** GET /api/v1/companies/enrich-queue/status — 自動 enrich キューの状態 */
companies.get('/enrich-queue/status', async (c) => c.json(await enrichQueueStatus()));

/** GET /api/v1/companies/ob/top — OB 就職者数の多い企業ランキング */
companies.get('/ob/top', async (c) => {
  const limit = c.req.query('limit') ? Number.parseInt(c.req.query('limit')!, 10) : undefined;
  return c.json({ companies: await topCompaniesByOb(limit) });
});

/** GET /api/v1/companies/ob/studios — OB 輩出スタジオ + 代表作 (OB×ゲーム結合ビュー、 個人なし) */
companies.get('/ob/studios', async (c) => {
  const limit = c.req.query('limit') ? Number.parseInt(c.req.query('limit')!, 10) : undefined;
  const games = c.req.query('games') ? Number.parseInt(c.req.query('games')!, 10) : undefined;
  return c.json({ studios: await topObStudios(limit, games) });
});

/** GET /api/v1/companies/:id/ob — 企業の OB 就職実績 (集計サマリ + 内訳セル、 個人なし) */
companies.get('/:id/ob', async (c) => {
  const id = c.req.param('id');
  const [summary, placements] = await Promise.all([getObSummary(id), getObPlacements(id)]);
  return c.json({ summary, placements });
});

/** GET /api/v1/companies/:id/profile — 企業の IR/理念 profile */
companies.get('/:id/profile', async (c) => {
  const profile = await getProfile(c.req.param('id'));
  return profile ? c.json({ profile }) : c.json({ error: 'not_found' }, 404);
});

/** GET /api/v1/companies/:id/newgrad — インタビュー記事由来の役職別新卒像 */
companies.get('/:id/newgrad', async (c) => {
  const roles = await getNewgradRoleImages(c.req.param('id'));
  return c.json({ roles });
});

/** GET /api/v1/companies/:id/games — 企業が関与したゲーム一覧 */
companies.get('/:id/games', async (c) => {
  const games = await getGamesByCompany(c.req.param('id'));
  return c.json({ games });
});

/** GET /api/v1/companies/:id/articles — 企業のインタビュー記事一覧 */
companies.get('/:id/articles', async (c) => {
  const articles = await listInterviewArticles(c.req.param('id'), 50);
  return c.json({ articles });
});

/** GET /api/v1/companies/:id — 企業詳細 */
companies.get('/:id', async (c) => {
  const company = await getCompany(c.req.param('id'));
  return company ? c.json({ company }) : c.json({ error: 'not_found' }, 404);
});

/** POST /api/v1/companies/crawl — クロール起動 { source, urls?, maxPages? } */
companies.post('/crawl', cernereAuth, async (c) => {
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

/** POST /api/v1/companies/crawl-listing — 新卒/ゲーム企業を listing から発見してストック { source? } */
companies.post('/crawl-listing', cernereAuth, async (c) => {
  const user = c.get('user');
  if (!canCrawl(user.id)) return c.json({ error: 'forbidden' }, 403);
  const body = (await c.req.json().catch(() => null)) as { source?: string } | null;
  try {
    const summary = await runListingCrawl(body?.source);
    return c.json({ summary }, 200);
  } catch (err) {
    return c.json({ error: 'listing_crawl_failed', detail: (err as Error).message }, 502);
  }
});

/** POST /api/v1/companies/:id/contribute — ユーザ提供リンクを分類して企業情報を追加 { links: string[] } */
companies.post('/:id/contribute', cernereAuth, async (c) => {
  const user = c.get('user');
  if (!canCrawl(user.id)) return c.json({ error: 'forbidden' }, 403);
  const body = (await c.req.json().catch(() => null)) as { links?: unknown } | null;
  const links = Array.isArray(body?.links) ? body!.links.filter((u): u is string => typeof u === 'string') : [];
  if (links.length === 0) return c.json({ error: 'links_required' }, 400);
  try {
    const summary = await runContribute(c.req.param('id'), links);
    return c.json({ summary }, 200);
  } catch (err) {
    const msg = (err as Error).message;
    return c.json({ error: msg === 'company not found' ? 'not_found' : 'contribute_failed', detail: msg }, msg === 'company not found' ? 404 : 502);
  }
});

/** POST /api/v1/companies/enrich — 企業サイトを巡回し IR/理念を取得 { company_id?, limit? } */
companies.post('/enrich', cernereAuth, async (c) => {
  const user = c.get('user');
  if (!canCrawl(user.id)) return c.json({ error: 'forbidden' }, 403);
  const body = (await c.req.json().catch(() => null)) as { company_id?: string; limit?: number } | null;
  try {
    const summary = await runEnrichment({ companyId: body?.company_id, limit: body?.limit });
    return c.json({ summary }, 200);
  } catch (err) {
    return c.json({ error: 'enrich_failed', detail: (err as Error).message }, 502);
  }
});

/**
 * POST /api/v1/companies/ob/sync — 非公開 Sheet (合格リスト) から OB 集計を差分同期 (admin 専用) { dryRun? }。
 * 氏名は集計に畳む過程で破棄され、 DB / レスポンスには集計しか出ない (個人データ境界 §2.1)。
 */
companies.post('/ob/sync', cernereAuth, async (c) => {
  const user = c.get('user');
  if (!canCrawl(user.id)) return c.json({ error: 'forbidden' }, 403);
  const body = (await c.req.json().catch(() => null)) as { dryRun?: boolean } | null;
  try {
    const summary = await syncObFromSheet({ dryRun: body?.dryRun === true });
    return c.json({ summary }, 200);
  } catch (err) {
    return c.json({ error: 'ob_sync_failed', detail: (err as Error).message }, 502);
  }
});
