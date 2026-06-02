import { useAuth } from '../auth/AuthContext.js';
import { fetchJson } from './client.js';

export type TrainingKind = 'es' | 'portfolio' | 'past_qa' | 'self_intro';

export type TrainingRef = {
  id: string;
  user_id: string;
  kind: TrainingKind;
  memoria_uri: string;
  embedding_id: string;
  tags: string[];
};

export function useTrainingApi() {
  const { token } = useAuth();

  return {
    async list(): Promise<{ refs: TrainingRef[] }> {
      return fetchJson<{ refs: TrainingRef[] }>('/api/v1/training', token);
    },
    async add(input: {
      kind: TrainingKind;
      body?: string;
      tags?: string[];
    }): Promise<{ ref: TrainingRef }> {
      return fetchJson<{ ref: TrainingRef }>('/api/v1/training', token, {
        method: 'POST',
        body: JSON.stringify(input),
      });
    },
    async remove(id: string): Promise<{ ok: boolean }> {
      return fetchJson<{ ok: boolean }>(`/api/v1/training/${id}`, token, {
        method: 'DELETE',
      });
    },
  };
}
