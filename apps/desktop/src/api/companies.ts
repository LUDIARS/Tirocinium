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
  crawled_at: string;
  updated_at: string;
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
    async list(params: { role?: string; tag?: string; q?: string } = {}): Promise<{
      companies: Company[];
      total: number;
    }> {
      const qs = new URLSearchParams();
      if (params.role) qs.set('role', params.role);
      if (params.tag) qs.set('tag', params.tag);
      if (params.q) qs.set('q', params.q);
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
  };
}
