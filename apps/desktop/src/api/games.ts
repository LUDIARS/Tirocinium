import { useAuth } from '../auth/AuthContext.js';
import { fetchJson } from './client.js';

export type GameSearchRow = {
  id: string;
  title: string;
  series: string;
  platform: string;
  release_year: number;
  company_count: number;
};

export type RelatedCompany = {
  id: string;
  name: string;
  location: string;
  url: string;
  industry: string;
  is_smb: boolean;
  is_listed: boolean;
  employee_count: number;
  listing_market: string;
  is_newgrad: boolean;
  has_opening: boolean;
  recruit_url: string;
  is_social: boolean;
  primary_platform: string;
  ob_total: number;
  relation: 'direct' | 'related';
  role?: string;
  shared_games?: number;
  via_titles?: string[];
  tech?: string[];
};

/** 企業の OB 就職実績 (集計のみ・個人なし)。 */
export type ObSummary = {
  total: number;
  cells: number;
  by_year: { join_year: number; headcount: number }[];
  by_role: { role: string; headcount: number }[];
  by_class: { class_name: string; headcount: number }[];
};

export type ObPlacement = {
  join_year: number;
  class_name: string;
  role: string;
  headcount: number;
  source: string;
};

export type ObResult = { summary: ObSummary; placements: ObPlacement[] };

export type RelatedResult = {
  game: { id: string; title: string; series: string; platform: string; release_year: number } | null;
  direct: RelatedCompany[];
  related: RelatedCompany[];
};

export type RelatedFilters = { smb?: boolean; newgrad?: boolean; opening?: boolean; social?: boolean; engine?: string };

export function useGamesApi() {
  const { token } = useAuth();
  return {
    async search(q: string): Promise<{ games: GameSearchRow[] }> {
      return fetchJson(`/api/v1/companies/games/search?q=${encodeURIComponent(q)}`, token);
    },
    async related(gameId: string, f: RelatedFilters = {}): Promise<RelatedResult> {
      const qs = new URLSearchParams();
      if (f.smb) qs.set('smb', '1');
      if (f.newgrad) qs.set('newgrad', '1');
      if (f.opening) qs.set('opening', '1');
      if (f.social) qs.set('social', '1');
      if (f.engine) qs.set('engine', f.engine);
      const suffix = qs.toString() ? `?${qs.toString()}` : '';
      return fetchJson(`/api/v1/companies/games/${gameId}/related${suffix}`, token);
    },
    async ob(companyId: string): Promise<ObResult> {
      return fetchJson(`/api/v1/companies/${companyId}/ob`, token);
    },
  };
}
