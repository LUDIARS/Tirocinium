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
  relation: 'direct' | 'related';
  role?: string;
  shared_games?: number;
  via_titles?: string[];
};

export type RelatedResult = {
  game: { id: string; title: string; series: string; platform: string; release_year: number } | null;
  direct: RelatedCompany[];
  related: RelatedCompany[];
};

export type RelatedFilters = { smb?: boolean; newgrad?: boolean; opening?: boolean };

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
      const suffix = qs.toString() ? `?${qs.toString()}` : '';
      return fetchJson(`/api/v1/companies/games/${gameId}/related${suffix}`, token);
    },
  };
}
