import { useState, type ReactNode } from 'react';
import { useAuth } from './AuthContext.js';
import { DEV_AUTH } from '../config.js';

export function LoginGate({ children }: { children: ReactNode }) {
  const { isAuthed } = useAuth();
  if (!isAuthed) return <LoginScreen />;
  return <>{children}</>;
}

function LoginScreen() {
  const { setToken } = useAuth();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) {
      setError('トークンを入力してください');
      return;
    }
    // V4 PASETO は v4.public. or v4.local. プレフィックスを持つ
    if (!/^v4\.(public|local)\./.test(trimmed)) {
      setError('Cernere PASETO V4 トークンの形式ではありません');
      return;
    }
    setError(null);
    setToken(trimmed);
  };

  return (
    <div className="app-shell">
      <main className="app-main">
        <h2>Cernere ログイン</h2>
        <div className="card">
          <p>
            Cernere から発行された <strong>PASETO V4 token</strong> を貼り付けてください。
            開発時は <code>/api/auth/project-token</code> で取得した token を直接入力します。
            (将来は OAuth フローに置換)
          </p>
          <form onSubmit={onSubmit}>
            <textarea
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="v4.public.xxxxxxxx..."
              rows={4}
              style={{
                width: '100%',
                padding: 12,
                borderRadius: 8,
                border: '1px solid rgba(0,0,0,0.18)',
                fontFamily: 'monospace',
                fontSize: 12,
              }}
            />
            {error && <p style={{ color: '#c62828' }}>{error}</p>}
            <button
              type="submit"
              style={{
                marginTop: 12,
                padding: '8px 20px',
                borderRadius: 8,
                border: 'none',
                background: '#2b5cff',
                color: 'white',
                cursor: 'pointer',
              }}
            >
              ログイン
            </button>
          </form>
          {DEV_AUTH && (
            <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px dashed rgba(0,0,0,0.18)' }}>
              <p style={{ fontSize: 12, opacity: 0.8 }}>
                <strong>Dev モード</strong>: server が <code>TIROCINIUM_DEV_AUTH=1</code> のとき、
                Cernere 無しで固定 dev ユーザとして開始できます。
              </p>
              <button
                type="button"
                onClick={() => setToken('dev')}
                style={{
                  padding: '8px 20px',
                  borderRadius: 8,
                  border: '1px solid #2b5cff',
                  background: 'white',
                  color: '#2b5cff',
                  cursor: 'pointer',
                }}
              >
                Dev ログイン (Cernere バイパス)
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
