// Wikidata SPARQL から「ある企業が関わったゲーム」と各ゲームの 開発元/発売元/シリーズ を取得する。
// 決定論・公開オープンデータ (Canalis 原則準拠、 ToS クリーン)。 LLM 不使用。
// spec/companies/game-graph.md Phase2 (発見クロール) の発見源。

const ENDPOINT = 'https://query.wikidata.org/sparql';
const UA = 'TirociniumBot/0.1 (https://github.com/LUDIARS/Tirocinium; research)';

/** SPARQL の生 binding。 */
type Binding = Record<string, { value: string } | undefined>;

/** 1 ゲーム分の集約結果 (開発元/発売元/シリーズの社名・名称)。 */
export type WikidataGame = {
  title: string;
  developers: string[];
  publishers: string[];
  series: string[];
};

/** 企業名 (label 突合用) を Wikidata の label に寄せる (法人格/括弧除去)。 */
export function cleanCompanyLabel(name: string): string {
  return name
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/株式会社|有限会社|合同会社|（株）|\(株\)/g, '')
    .trim();
}

const uniqPush = (arr: string[], v: string | undefined): void => {
  const s = (v ?? '').trim();
  if (s && !arr.includes(s)) arr.push(s);
};

/** SPARQL bindings をゲーム単位に集約する (純粋・テスト可能)。 */
export function parseGameRows(bindings: Binding[]): WikidataGame[] {
  const byKey = new Map<string, WikidataGame>();
  for (const b of bindings) {
    const title = b['gameLabel']?.value?.trim();
    const gameUri = b['game']?.value ?? title;
    if (!title || !gameUri) continue;
    let g = byKey.get(gameUri);
    if (!g) {
      g = { title, developers: [], publishers: [], series: [] };
      byKey.set(gameUri, g);
    }
    uniqPush(g.developers, b['devLabel']?.value);
    uniqPush(g.publishers, b['pubLabel']?.value);
    uniqPush(g.series, b['seriesLabel']?.value);
  }
  return [...byKey.values()];
}

/** Wikidata Q-URI ラベルがそのまま QID の場合 (ラベル未解決) は除外する。 */
const isRawQid = (s: string): boolean => /^Q\d+$/.test(s);

/** 企業 label を起点に、 関わったゲーム + 各ゲームの dev/pub/series を取得する。 */
export async function fetchGamesForCompany(
  companyLabel: string,
  opts: { timeoutMs?: number; limit?: number } = {},
): Promise<WikidataGame[]> {
  const label = cleanCompanyLabel(companyLabel);
  if (!label) return [];
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 500);
  const query = `
    SELECT ?game ?gameLabel ?devLabel ?pubLabel ?seriesLabel WHERE {
      ?company rdfs:label ${JSON.stringify(label)}@ja .
      { ?game wdt:P178 ?company } UNION { ?game wdt:P123 ?company } .
      ?game wdt:P31/wdt:P279* wd:Q7889 .
      OPTIONAL { ?game wdt:P178 ?dev }
      OPTIONAL { ?game wdt:P123 ?pub }
      OPTIONAL { ?game wdt:P179 ?series }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "ja,en". }
    } LIMIT ${limit}`;
  const url = `${ENDPOINT}?format=json&query=${encodeURIComponent(query)}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 20_000);
  try {
    const res = await fetch(url, {
      headers: { accept: 'application/sparql-results+json', 'user-agent': UA },
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`wikidata HTTP ${res.status}`);
    const json = (await res.json()) as { results?: { bindings?: Binding[] } };
    const games = parseGameRows(json.results?.bindings ?? []);
    // ラベル未解決 (生 QID) のタイトル/会社は捨てる。
    return games
      .filter((g) => !isRawQid(g.title))
      .map((g) => ({
        ...g,
        developers: g.developers.filter((d) => !isRawQid(d)),
        publishers: g.publishers.filter((p) => !isRawQid(p)),
        series: g.series.filter((s) => !isRawQid(s)),
      }));
  } finally {
    clearTimeout(timer);
  }
}
