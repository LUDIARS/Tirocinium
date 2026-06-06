import { useAuth } from '../auth/AuthContext.js';
import { fetchJson } from './client.js';

export type RecommendationItem = {
  company_id: string;
  name: string;
  score: number;
  reasons: string[];
  concerns: string[];
};

export type Recommendation = {
  id: string;
  created_at: string;
  query: {
    target_role?: string;
    target_company?: string;
    tags?: string[];
    weak_axes?: string[];
  };
  method: 'llm' | 'heuristic';
  model: string;
  items: RecommendationItem[];
};

export type RecommendResponse = {
  recommendation: Recommendation;
  method: 'llm' | 'heuristic';
  has_es_material: boolean;
};

export function useRecommendApi() {
  const { token } = useAuth();

  return {
    async run(input: {
      target_role?: string;
      target_company?: string;
      tags?: string[];
      es_text?: string;
      topK?: number;
    }): Promise<RecommendResponse> {
      return fetchJson('/api/v1/recommend', token, {
        method: 'POST',
        body: JSON.stringify(input),
      });
    },
    async history(): Promise<{ recommendations: Recommendation[] }> {
      return fetchJson('/api/v1/recommend', token);
    },
  };
}
