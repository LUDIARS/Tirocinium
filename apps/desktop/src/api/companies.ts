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

export function useCompaniesApi() {
  const { token } = useAuth();

  return {
    async list(params: { role?: string; tag?: string; industry?: string; q?: string; limit?: number; offset?: number } = {}): Promise<{
      companies: Company[];
      total: number;
    }> {
      const qs = new URLSearchParams();
      if (params.role) qs.set('role', params.role);
      if (params.tag) qs.set('tag', params.tag);
      if (params.industry) qs.set('industry', params.industry);
      if (params.q) qs.set('q', params.q);
      if (params.limit) qs.set('limit', String(params.limit));
      if (params.offset) qs.set('offset', String(params.offset));
      const suffix = qs.toString() ? `?${qs.toString()}` : '';
      return fetchJson(`/api/v1/companies${suffix}`, token);
    },
    async sources(): Promise<{ sources: string[] }> {
      return fetchJson('/api/v1/companies/sources', token);
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
    async profile(id: string): Promise<{ profile: CompanyProfile }> {
      return fetchJson(`/api/v1/companies/${id}/profile`, token);
    },
    async newgrad(id: string): Promise<{ roles: NewgradRoleImage[] }> {
      return fetchJson(`/api/v1/companies/${id}/newgrad`, token);
    },
  };
}
