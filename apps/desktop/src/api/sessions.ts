import { useAuth } from '../auth/AuthContext.js';
import { fetchJson } from './client.js';

export type SessionStartResult =
  | { session_id: string; ws_url: string }
  | { reservation_offer: { slot_start: string; eta_min: number; slot_duration_min: number } }
  | { error: string };

export function useSessionApi() {
  const { token } = useAuth();

  return {
    async start(opts: {
      target_company?: string;
      target_role?: string;
      interviewer_id?: string;
    }): Promise<SessionStartResult> {
      return fetchJson<SessionStartResult>('/api/v1/sessions', token, {
        method: 'POST',
        body: JSON.stringify(opts),
      });
    },
    async end(id: string): Promise<{ ok: boolean }> {
      return fetchJson<{ ok: boolean }>(`/api/v1/sessions/${id}/end`, token, {
        method: 'POST',
      });
    },
    async generateSummary(id: string): Promise<{ summary?: unknown }> {
      return fetchJson<{ summary?: unknown }>(`/api/v1/sessions/${id}/summary`, token, {
        method: 'POST',
      });
    },
    async getSummary(id: string): Promise<{ summary?: unknown }> {
      return fetchJson<{ summary?: unknown }>(`/api/v1/sessions/${id}/summary`, token);
    },
    async submitFeedback(id: string, block: string, action: unknown): Promise<{ ok: boolean }> {
      return fetchJson<{ ok: boolean }>(`/api/v1/sessions/${id}/feedback`, token, {
        method: 'POST',
        body: JSON.stringify({ block, action }),
      });
    },
  };
}
