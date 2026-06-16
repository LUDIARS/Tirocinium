import { useAuth } from '../auth/AuthContext.js';
import { fetchJson } from './client.js';

export type Company = {
  id: string;
  name: string;
  url: string;
  industry: string;
  description: string;
  roles: string[];
  tags: string[];
  location: string;
  size: string;
  source: string;
  source_url: string;
  is_newgrad: boolean;
  is_game: boolean;
  has_opening: boolean;
  recruit_url: string;
  stock_reason: string;
  crawled_at: string;
  updated_at: string;
  article_count: number;
  has_newgrad_image: boolean;
  has_profile: boolean;
  /** 関与ゲーム数 (0 = どのゲームにも未紐付け) */
  game_count: number;
};

export type NewgradRoleImage = {
  role: string;
  summary: string;
  themes: string[];
  article_count: number;
  model: string;
  fetched_at: string;
};

export type ListingSource = {
  id: string;
  kind: string;
  urls: number;
  active: boolean;
  note?: string;
};

export type CompanyProfile = {
  company_id: string;
  philosophy: string;
  values: string[];
  ir_summary: string;
  business: string;
  sources: string[];
  fetched_at: string;
};

export type ListingCrawlSummary = {
  sources: string[];
  pagesFetched: number;
  discovered: number;
  stocked: number;
  skipped: number;
  robotsBlocked: number;
  errors: { url: string; message: string }[];
};

export type EnrichSummary = {
  targets: number;
  enriched: number;
  skipped: number;
  pagesFetched: number;
  robotsBlocked: number;
  errors: { company: string; message: string }[];
};

export type CrawlSummary = {
  source: string;
  discovered: number;
  fetched: number;
  extracted: number;
  upserted: number;
  skipped: number;
  errors: { url: string; message: string }[];
};

export type ContributeLinkResult = {
  url: string;
  type: 'company' | 'game' | 'newgrad' | 'other';
  applied: boolean;
  detail: string;
};

export type ContributeSummary = {
  company: string;
  processed: number;
  applied: number;
  results: ContributeLinkResult[];
};

export type EnrichQueueStatus = {
  enabled: boolean;
  running: boolean;
  intervalMs: number;
  disabledReason: string;
  processed: number;
  enrichedOk: number;
  lastCompany: string;
  lastDetail: string;
  pending: number;
  attempted: number;
};

export type CompanyGame = {
  id: string;
  title: string;
  series: string;
  platform: string;
  release_year: number;
  role: string;
};

export type CompanyArticle = {
  url: string;
  title: string;
  body: string;
};

export type MapMarker = {
  id: string;
  name: string;
  location: string;
  lat: number;
  lng: number;
  is_smb: boolean;
  is_social: boolean;
  game_count: number;
};

export function useCompaniesApi() {
  const { token } = useAuth();

  return {
    async list(params: { role?: string; tag?: string; industry?: string; q?: string; quality?: boolean; summarized?: boolean; newgrad?: boolean; opening?: boolean; limit?: number; offset?: number } = {}): Promise<{
      companies: Company[];
      total: number;
    }> {
      const qs = new URLSearchParams();
      if (params.role) qs.set('role', params.role);
      if (params.tag) qs.set('tag', params.tag);
      if (params.industry) qs.set('industry', params.industry);
      if (params.q) qs.set('q', params.q);
      if (params.quality) qs.set('quality', '1');
      if (params.summarized) qs.set('summarized', '1');
      if (params.newgrad) qs.set('newgrad', '1');
      if (params.opening) qs.set('opening', '1');
      if (params.limit) qs.set('limit', String(params.limit));
      if (params.offset) qs.set('offset', String(params.offset));
      const suffix = qs.toString() ? `?${qs.toString()}` : '';
      return fetchJson(`/api/v1/companies${suffix}`, token);
    },
    async sources(): Promise<{ sources: string[] }> {
      return fetchJson('/api/v1/companies/sources', token);
    },
    async enrichQueueStatus(): Promise<EnrichQueueStatus> {
      return fetchJson('/api/v1/companies/enrich-queue/status', token);
    },
    async mapConfig(): Promise<{ enabled: boolean; apiKey: string }> {
      return fetchJson('/api/v1/companies/map-config', token);
    },
    async mapMarkers(): Promise<{ enabled: boolean; markers: MapMarker[]; pendingLocations: number }> {
      return fetchJson('/api/v1/companies/map-markers', token);
    },
    async crawl(input: { source: string; urls?: string[]; maxPages?: number }): Promise<{
      summary: CrawlSummary;
    }> {
      return fetchJson('/api/v1/companies/crawl', token, {
        method: 'POST',
        body: JSON.stringify(input),
      });
    },
    async listingSources(): Promise<{ sources: ListingSource[] }> {
      return fetchJson('/api/v1/companies/listing-sources', token);
    },
    async crawlListing(input: { source?: string } = {}): Promise<{ summary: ListingCrawlSummary }> {
      return fetchJson('/api/v1/companies/crawl-listing', token, {
        method: 'POST',
        body: JSON.stringify(input),
      });
    },
    async enrich(input: { company_id?: string; limit?: number } = {}): Promise<{
      summary: EnrichSummary;
    }> {
      return fetchJson('/api/v1/companies/enrich', token, {
        method: 'POST',
        body: JSON.stringify(input),
      });
    },
    async get(id: string): Promise<{ company: Company }> {
      return fetchJson(`/api/v1/companies/${id}`, token);
    },
    async profile(id: string): Promise<{ profile: CompanyProfile }> {
      return fetchJson(`/api/v1/companies/${id}/profile`, token);
    },
    async contribute(id: string, links: string[]): Promise<{ summary: ContributeSummary }> {
      return fetchJson(`/api/v1/companies/${id}/contribute`, token, {
        method: 'POST',
        body: JSON.stringify({ links }),
      });
    },
    async newgrad(id: string): Promise<{ roles: NewgradRoleImage[] }> {
      return fetchJson(`/api/v1/companies/${id}/newgrad`, token);
    },
    async games(id: string): Promise<{ games: CompanyGame[] }> {
      return fetchJson(`/api/v1/companies/${id}/games`, token);
    },
    async articles(id: string): Promise<{ articles: CompanyArticle[] }> {
      return fetchJson(`/api/v1/companies/${id}/articles`, token);
    },
  };
}
