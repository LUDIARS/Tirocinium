// 企業サイトから「深掘り対象 URL」を発見・分類する。 子クローラ連鎖 (enrich-chain) の入口。
//   works  : 制作実績 / タイトルページ → ゲーム抽出 (contribute) に使う
//   career : 採用 / 求人ページ → recruit-page 求人抽出に使う
//   about  : 会社概要 / IR / 理念ページ → 企業情報 enrich (contribute) に使う
// 取得は sitemap.xml 優先、 無ければトップページのアンカーから拾う (links.ts の語彙を流用)。

import { extractAnchors, selectEnrichmentLinks } from '@tirocinium/companies';

export type DiscoveredSite = {
  worksUrls: string[];
  careerUrls: string[];
  aboutUrls: string[];
};

const PATTERNS = {
  works: /\/(works|product|products|title|titles|portfolio|game|games)\//i,
  career: /\/(career|careers|recruit|saiyo|job|jobs|hiring|entry)\b/i,
  about: /\/(about|company|corporate|profile|ir|philosophy|message)\b/i,
};

/** sitemap の <loc> URL を抽出する (純粋)。 */
export function parseSitemapLocs(xml: string): string[] {
  const out: string[] = [];
  const re = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const u = m[1]!.trim();
    if (/^https?:\/\//i.test(u)) out.push(u);
  }
  return out;
}

/**
 * URL 群を works/career/about に分類する (純粋)。 各カテゴリは上限つき。
 * works は「一覧 (末尾が /works/) ではなく個別ページ (slug 付き)」を優先する
 * — 一覧は JS 描画 SPA で本文が空なことが多いため。
 */
export function categorizeUrls(
  urls: string[],
  caps: { works?: number; career?: number; about?: number } = {},
): DiscoveredSite {
  const dedup = [...new Set(urls.map((u) => u.trim()).filter((u) => /^https?:\/\//i.test(u)))];

  // 一覧 (末尾が /works/ /career/ 等) は JS 描画 SPA で本文が空なことが多いため、
  // 個別ページ (slug 付き) を優先する。 末尾 path セグメントが既知の一覧語なら後回し。
  const INDEX_SEGS = /\/(works|products|product|title|titles|portfolio|games|career|careers|recruit|about|company)\/?$/i;
  const indexLast = (xs: string[]): string[] =>
    [...xs].sort((a, b) => Number(INDEX_SEGS.test(a)) - Number(INDEX_SEGS.test(b)));

  const works = indexLast(dedup.filter((u) => PATTERNS.works.test(u)));
  const career = indexLast(dedup.filter((u) => PATTERNS.career.test(u)));
  const about = dedup.filter((u) => PATTERNS.about.test(u));

  return {
    worksUrls: works.slice(0, caps.works ?? 8),
    careerUrls: career.slice(0, caps.career ?? 3),
    aboutUrls: about.slice(0, caps.about ?? 3),
  };
}

/**
 * sitemap の ページ URL を取りに行く (無ければ空)。 fetchText は HTTP GET (DI)。
 * sitemap index (中身が .xml の sitemap への <loc>) は 1 段だけ再帰してページ URL を集める。
 */
async function fetchSitemapLocs(origin: string, fetchText: (url: string) => Promise<string>): Promise<string[]> {
  const MAX_SUBSITEMAPS = 6;
  for (const path of ['/sitemap.xml', '/sitemap_index.xml']) {
    let locs: string[];
    try {
      locs = parseSitemapLocs(await fetchText(origin + path));
    } catch {
      continue; // 次の候補へ
    }
    if (locs.length === 0) continue;

    // sitemap index 判定: <loc> がすべて (大半) .xml なら sub-sitemap を辿る。
    const subSitemaps = locs.filter((u) => /\.xml(\?|$)/i.test(u));
    if (subSitemaps.length > 0 && subSitemaps.length >= locs.length / 2) {
      const pages: string[] = [];
      for (const sm of subSitemaps.slice(0, MAX_SUBSITEMAPS)) {
        try {
          pages.push(...parseSitemapLocs(await fetchText(sm)));
        } catch {
          // この sub-sitemap は飛ばす
        }
      }
      if (pages.length > 0) return pages;
    }
    return locs;
  }
  return [];
}

/**
 * 企業サイトを発見して works/career/about を返す。
 * 1) sitemap.xml の <loc> を分類。 2) 取れなければトップページのアンカーから about/recruit を拾う。
 */
export async function discoverSite(
  baseUrl: string,
  fetchText: (url: string) => Promise<string>,
  caps: { works?: number; career?: number; about?: number } = {},
): Promise<DiscoveredSite> {
  let origin: string;
  try {
    origin = new URL(baseUrl).origin;
  } catch {
    return { worksUrls: [], careerUrls: [], aboutUrls: [] };
  }

  const locs = await fetchSitemapLocs(origin, fetchText);
  if (locs.length > 0) {
    const fromSitemap = categorizeUrls(locs, caps);
    // sitemap から 1 つでも拾えたら採用。 全カテゴリ空なら トップページ走査にフォールバックする。
    if (fromSitemap.worksUrls.length + fromSitemap.careerUrls.length + fromSitemap.aboutUrls.length > 0) {
      return fromSitemap;
    }
  }

  // フォールバック: トップページのアンカーから about/recruit/works を拾う。
  try {
    const html = await fetchText(baseUrl);
    const anchors: string[] = [];
    for (const a of extractAnchors(html)) {
      try { anchors.push(new URL(a.href, baseUrl).href); } catch { /* 不正 href は捨てる */ }
    }
    const links = selectEnrichmentLinks(baseUrl, html);
    const career = anchors.filter((u) => PATTERNS.career.test(u));
    const dedup = (xs: string[]): string[] => [...new Set(xs)];
    return {
      worksUrls: dedup(anchors.filter((u) => PATTERNS.works.test(u))).slice(0, caps.works ?? 8),
      careerUrls: dedup([...links.recruit, ...career]).slice(0, caps.career ?? 3),
      aboutUrls: dedup([...links.about, ...links.ir, ...links.philosophy]).slice(0, caps.about ?? 3),
    };
  } catch {
    return { worksUrls: [], careerUrls: [], aboutUrls: [] };
  }
}
