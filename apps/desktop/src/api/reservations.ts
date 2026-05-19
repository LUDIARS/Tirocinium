import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext.js';
import { fetchJson } from './client.js';

export type Slot = { slot_start: string; capacity: number; used: number };
export type Reservation = { id: string; slot_start: string; status: string };

export function useReservationSlots(hours = 24) {
  const { token } = useAuth();
  const [data, setData] = useState<Slot[] | null>(null);
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => {
    let alive = true;
    fetchJson<{ slots: Slot[] }>(`/api/v1/reservations/slots?hours=${hours}`, token)
      .then((r) => alive && setData(r.slots))
      .catch((e) => alive && setError(e as Error));
    return () => {
      alive = false;
    };
  }, [token, hours]);
  return { data, error };
}

export function useMyReservations() {
  const { token } = useAuth();
  const [data, setData] = useState<Reservation[] | null>(null);
  useEffect(() => {
    let alive = true;
    fetchJson<{ reservations: Reservation[] }>('/api/v1/reservations/me', token)
      .then((r) => alive && setData(r.reservations))
      .catch(() => alive && setData([]));
    return () => {
      alive = false;
    };
  }, [token]);
  return data;
}
