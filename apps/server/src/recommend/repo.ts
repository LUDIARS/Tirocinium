import { sql } from '../db/index.js';
import type { RecommendationItem, RecommendationResult } from '@tirocinium/companies';

export type RecommendationQuery = {
  target_role?: string;
  target_company?: string;
  tags?: string[];
  weak_axes?: string[];
};

export type SavedRecommendation = {
  id: string;
  user_id: string;
  created_at: string;
  query: RecommendationQuery;
  method: 'llm' | 'heuristic';
  model: string;
  items: RecommendationItem[];
};

const SELECT_COLS = sql`id, user_id, created_at, query, method, model, items`;

export async function saveRecommendation(
  userId: string,
  query: RecommendationQuery,
  result: RecommendationResult,
): Promise<SavedRecommendation> {
  const rows = await sql<SavedRecommendation[]>`
    INSERT INTO company_recommendations (user_id, query, method, model, items)
    VALUES (
      ${userId}, ${sql.json(query)}, ${result.method}, ${result.model}, ${sql.json(result.items)}
    )
    RETURNING ${SELECT_COLS}
  `;
  return rows[0]!;
}

export async function listRecommendations(userId: string, limit = 10): Promise<SavedRecommendation[]> {
  return sql<SavedRecommendation[]>`
    SELECT ${SELECT_COLS} FROM company_recommendations
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
    LIMIT ${Math.min(Math.max(limit, 1), 50)}
  `;
}
