import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { setTokenRefresher } from '../api/client.js';
import { refreshTrSession, type TrSession } from './session-api.js';

// token = Cernere が発行した Tirocinium 向け user×project token (15 分)。
// refreshToken = Cernere のユーザー refresh token。token が切れたら /api/auth/refresh で取り直す。
// どちらもこのブラウザの localStorage にだけ置く (Tirocinium のサーバには保存しない)。
const STORAGE_KEY = 'tirocinium.token';
const REFRESH_KEY = 'tirocinium.refreshToken';

export type AuthState = {
  token: string | null;
  setToken: (t: string | null) => void;
  /** 埋め込みログインで得た session を保存する。 */
  setSession: (s: TrSession) => void;
  logout: () => void;
  isAuthed: boolean;
};

const AuthCtx = createContext<AuthState | null>(null);

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // ignore (private mode 等)
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenInternal] = useState<string | null>(() => read(STORAGE_KEY));

  const setToken = useCallback((t: string | null) => {
    setTokenInternal(t);
    write(STORAGE_KEY, t);
  }, []);

  const setSession = useCallback((s: TrSession) => {
    write(REFRESH_KEY, s.refreshToken);
    setToken(s.token);
  }, [setToken]);

  const logout = useCallback(() => {
    write(REFRESH_KEY, null);
    setToken(null);
  }, [setToken]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setTokenInternal(e.newValue);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // API が 401 を返したときの取り直し。refreshToken が無い・失敗したらログアウトしてログイン画面へ戻す。
  useEffect(() => {
    setTokenRefresher(async () => {
      const refreshToken = read(REFRESH_KEY);
      if (!refreshToken) return null;
      try {
        const s = await refreshTrSession(refreshToken);
        setSession(s);
        return s.token;
      } catch {
        logout();
        return null;
      }
    });
    return () => setTokenRefresher(null);
  }, [setSession, logout]);

  const value = useMemo<AuthState>(
    () => ({ token, setToken, setSession, logout, isAuthed: Boolean(token) }),
    [token, setToken, setSession, logout],
  );

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
