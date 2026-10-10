import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { CompositeLogin } from '@ludiars/cernere-composite/ui';
import { useAuth } from './AuthContext.js';
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

/** Cernere の埋め込みログイン。成功すると authCode をサーバで Tirocinium 向け token に交換する。 */
function LoginScreen() {
  const { setSession } = useAuth();
  const [error, setError] = useState<string | null>(null);
  // パスワード後の本人確認 (WS) はこの画面が持つ。離れるときに閉じる
  const authApi = useMemo(() => new TrCompositeAuthApi(), []);
  useEffect(() => () => authApi.dispose(), [authApi]);

  const onAuthCode = async (authCode: string) => {
    setError(null);
    try {
      setSession(await exchangeAuthCode(authCode));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'ログインに失敗しました');
    }
  };

  return (
    <div className="app-shell">
      <main className="app-main" style={{ maxWidth: 420, margin: '0 auto' }}>
        <h2>Tirocinium にログイン</h2>
        <p style={{ fontSize: 13, opacity: 0.8 }}>LUDIARS 共通アカウント (Cernere) でログインします。</p>
        <CompositeLogin authApi={authApi} onAuthCode={(code) => void onAuthCode(code)} />
        {error && <p style={{ color: '#c62828' }}>{error}</p>}
      </main>
    </div>
  );
}
