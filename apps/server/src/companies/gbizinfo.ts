// gBizINFO (経産省 法人情報 REST API) の取得層。 決定論・公開オープンデータ (Canalis 原則準拠)。
// LLM 不使用。 spec/companies/gbizinfo.md §1①。
//
// client は DI 可能 (fake client で discover を単体テストできる)。 実 API 経路は
// createGBizFetchClient が token header + ページネーション + レート間隔を担う。

import type { GBizHojin } from '@tirocinium/companies';

const API_BASE = 'https://info.gbiz.go.jp/hojin/v1/hojin';

/** 法人検索の粗フィルタ (spec §2)。 */
export type GBizQuery = {
  /** 社名キーワード (部分一致) */
  name?: string;
  /** JSIC 系の業種コード (情報通信業など) */
  industry?: string;
  /** 都道府県 */
  prefecture?: string;
};

/** 1 ページ分の検索結果。 */
export type GBizPage = { hojin: GBizHojin[] };

/** gBizINFO 検索クライアント (page は 1 始まり)。 */
export type GBizClient = {
  search(query: GBizQuery, page: number): Promise<GBizPage>;
};

/** レスポンス JSON から法人配列を取り出す (フィールド名揺れに寛容)。 */
export function extractHojinList(json: unknown): GBizHojin[] {
  if (!json || typeof json !== 'object') return [];
  const obj = json as Record<string, unknown>;
  const list = obj['hojin-infos'] ?? obj['hojinInfos'] ?? obj['results'] ?? obj['hojin'];
  return Array.isArray(list) ? (list as GBizHojin[]) : [];
}

/** 実 API を叩く client を作る。 token は header `X-hojinInfo-api-token`、 間隔は minIntervalMs。 */
export function createGBizFetchClient(opts: {
  token: string;
  minIntervalMs?: number;
  timeoutMs?: number;
  userAgent?: string;
}): GBizClient {
  const minInterval = Math.max(opts.minIntervalMs ?? 3_000, 0);
  let lastAt = 0;

  const throttle = async (): Promise<void> => {
    const wait = lastAt + minInterval - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastAt = Date.now();
  };

  return {
    async search(query: GBizQuery, page: number): Promise<GBizPage> {
      await throttle();
      const params = new URLSearchParams();
      if (query.name) params.set('name', query.name);
      if (query.industry) params.set('industry', query.industry);
      if (query.prefecture) params.set('prefecture', query.prefecture);
      params.set('page', String(Math.max(page, 1)));
      const url = `${API_BASE}?${params.toString()}`;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 20_000);
      try {
        const res = await fetch(url, {
          headers: {
            accept: 'application/json',
            'X-hojinInfo-api-token': opts.token,
            'user-agent': opts.userAgent ?? 'TirociniumBot/0.1 (+https://github.com/LUDIARS/Tirocinium)',
          },
          signal: ctrl.signal,
        });
        if (res.status === 401 || res.status === 403) throw new Error('gbizinfo 認証失敗 (token を確認)');
        if (!res.ok) throw new Error(`gbizinfo HTTP ${res.status}`);
        return { hojin: extractHojinList(await res.json()) };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/** client を使って max 件までページ走査し、 法人レコードを集める (法人番号で dedup)。 */
export async function discoverHojin(
  client: GBizClient,
  query: GBizQuery,
  opts: { max?: number; maxPages?: number } = {},
): Promise<GBizHojin[]> {
  const max = Math.min(Math.max(opts.max ?? 100, 1), 5_000);
  const maxPages = Math.min(Math.max(opts.maxPages ?? 50, 1), 500);
  const out: GBizHojin[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= maxPages && out.length < max; page++) {
    const { hojin } = await client.search(query, page);
    if (hojin.length === 0) break;
    for (const h of hojin) {
      // 法人番号があれば dedup キーに、 無ければ名前で代用 (ノイズ回避)。
      const key = (h.corporate_number ?? '').trim() || (h.name ?? '').trim();
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(h);
      if (out.length >= max) break;
    }
  }
  return out;
}
