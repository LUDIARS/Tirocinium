import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { CompositeLogin } from '@ludiars/cernere-composite/ui';
import { useAuth } from './AuthContext.js';
import { createCompositePkce, type CompositePkce } from './pkce.js';
import { TrCompositeAuthApi, exchangeAuthCode } from './session-api.js';
import { DEV_AUTH } from '../config.js';

export function LoginGate({ children }: { children: ReactNode }) {
  const { isAuthed, setToken } = useAuth();

  // DEV_AUTH モードではログイン画面をスキップして自動ログイン
  useEffect(() => {
    if (DEV_AUTH && !isAuthed) setToken('dev');
  }, [DEV_AUTH, isAuthed, setToken]);

  if (!isAuthed) return DEV_AUTH ? null : <LoginScreen />;
  return <>{children}</>;
}

/**
 * Cernere の埋め込みログイン (パスキー)。試行ごとに PKCE を作り、challenge を begin/finish に、
 * verifier を authCode の交換に使う。交換で Tirocinium のセッションを受け取る。
 */
function LoginScreen() {
  const { setSession } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const [pkce, setPkce] = useState<CompositePkce | null>(null);
  const [attempt, setAttempt] = useState(0);

  // authCode は 1 回しか交換できない。交換に失敗したら PKCE ごと作り直してやり直す。
  useEffect(() => {
    let alive = true;
    setPkce(null);
    createCompositePkce()
      .then((p) => alive && setPkce(p))
      .catch(() => alive && setError('この環境ではログインを開始できません (Web Crypto が使えません)'));
    return () => {
      alive = false;
    };
  }, [attempt]);

  const authApi = useMemo(() => (pkce ? new TrCompositeAuthApi(pkce) : null), [pkce]);

  const onAuthCode = async (authCode: string) => {
    if (!pkce) return;
    setError(null);
    try {
      setSession(await exchangeAuthCode(authCode, pkce.codeVerifier));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ログインに失敗しました');
      setAttempt((n) => n + 1);
    }
  };

  return (
    <div className="app-shell">
      <main className="app-main" style={{ maxWidth: 420, margin: '0 auto' }}>
        <h2>Tirocinium にログイン</h2>
        <p style={{ fontSize: 13, opacity: 0.8 }}>LUDIARS 共通アカウント (Cernere) のパスキーでログインします。</p>
        {authApi && (
          <CompositeLogin key={attempt} authApi={authApi} onAuthCode={(code) => void onAuthCode(code)} />
        )}
        {error && <p style={{ color: '#c62828' }}>{error}</p>}
      </main>
    </div>
  );
}
