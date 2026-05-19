import type { RagQuery, RagResult, TrainingDocInput, TrainingDocRef } from './types.js';

export type MemoriaClientConfig = {
  /** 例: http://localhost:3300 (port は実 API 確認後に固定) */
  baseUrl: string;
  /** Cernere PASETO project token (Bearer) */
  token?: string;
};

/** Memoria の RAG / embedding API client。
 *  仕様未確定の部分は TODO のまま、 HTTP の path と body shape の interface を固定する。 */
export class MemoriaClient {
  constructor(private readonly cfg: MemoriaClientConfig) {}

  /** 本文を Memoria に永続化 + embedding 計算してもらう。 Tirocinium 側は ref を保存。 */
  async upsertTrainingDoc(input: TrainingDocInput): Promise<TrainingDocRef> {
    const res = await fetch(this.cfg.baseUrl + '/api/v1/tirocinium/training/upsert', {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      throw new Error(`memoria upsert failed: ${res.status} ${await res.text()}`);
    }
    return (await res.json()) as TrainingDocRef;
  }

  /** vector search。 RAG ブロックの素材取得用。 */
  async rag(query: RagQuery): Promise<RagResult> {
    const res = await fetch(this.cfg.baseUrl + '/api/v1/tirocinium/rag/search', {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(query),
    });
    if (!res.ok) {
      throw new Error(`memoria rag failed: ${res.status} ${await res.text()}`);
    }
    return (await res.json()) as RagResult;
  }

  async health(): Promise<boolean> {
    try {
      const res = await fetch(this.cfg.baseUrl + '/health', {
        headers: this.headers(),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'content-type': 'application/json' };
    if (this.cfg.token) h['authorization'] = `Bearer ${this.cfg.token}`;
    return h;
  }
}

export function createMemoriaClient(env: NodeJS.ProcessEnv = process.env): MemoriaClient | null {
  const url = env['MEMORIA_URL'];
  if (!url) return null;
  return new MemoriaClient({
    baseUrl: url.replace(/\/$/, ''),
    token: env['MEMORIA_PROJECT_TOKEN'],
  });
}

/** RAG 結果を system prompt の (3) スロット用 Markdown に整形 */
export function renderRagBlock(result: RagResult): string {
  if (result.items.length === 0) return '';
  return result.items
    .map((it, i) => `${i + 1}. (${it.kind}) ${it.excerpt}`)
    .join('\n');
}
