import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext.js';
import { fetchJson } from './client.js';

export type Interviewer = {
  id: string;
  display_name: string;
  stage: 'hr' | 'peer-tech' | 'lead-tech' | 'final';
  role_lens: string;
  temperament: string;
  pressure: number;
  tics: string[];
  bio: string;
  evaluation_bias: Record<string, number>;
  is_seed: boolean;
};

export function useInterviewers(filter?: { stage?: string; role_lens?: string }) {
  const { token } = useAuth();
  const [data, setData] = useState<Interviewer[] | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const q = new URLSearchParams();
    if (filter?.stage) q.set('stage', filter.stage);
    if (filter?.role_lens) q.set('role_lens', filter.role_lens);
    fetchJson<{ personas: Interviewer[] }>(
      `/api/v1/personas/interviewers${q.toString() ? '?' + q.toString() : ''}`,
      token,
    )
      .then((r) => {
        if (alive) {
          setData(r.personas);
          setError(null);
        }
      })
      .catch((e) => alive && setError(e as Error))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [token, filter?.stage, filter?.role_lens]);

  return { data, error, loading };
}
