import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { setUnauthorizedHandler } from '../api/client.js';
import { logoutTrSession, type TrSession } from './session-api.js';

// token = Tirocinium サーバが発行した自前セッションの token (固定期限、延長しない)。
// Cernere の token は持たない。期限切れ・失効 (401) ならログイン画面へ戻り、パスキーでログインし直す。
const STORAGE_KEY = 'tirocinium.token';
// 旧方式 (Cernere の refresh token) の残りを消すためだけに名前を持つ。
const LEGACY_REFRESH_KEY = 'tirocinium.refreshToken';

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
    setToken(s.sessionToken);
  }, [setToken]);

  // サーバ側のセッションも消す (失敗してもこの端末からは消す)。
  const logout = useCallback(() => {
    const current = read(STORAGE_KEY);
    if (current && current !== 'dev') void logoutTrSession(current).catch(() => undefined);
    setToken(null);
  }, [setToken]);

  // 旧方式で保存された Cernere の refresh token を残さない。
  useEffect(() => write(LEGACY_REFRESH_KEY, null), []);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) setTokenInternal(e.newValue);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // API が 401 を返したら (期限切れ・失効) この端末のセッションを捨ててログイン画面へ戻す。
  useEffect(() => {
    setUnauthorizedHandler(() => setToken(null));
    return () => setUnauthorizedHandler(null);
  }, [setToken]);

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
