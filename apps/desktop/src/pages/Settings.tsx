import { useAuth } from '../auth/AuthContext.js';
import { SERVER_URL } from '../config.js';

export function Settings() {
  const { setToken } = useAuth();
  return (
    <div>
      <h2>Settings</h2>
      <div className="card">
        <p>サーバ URL: <code>{SERVER_URL}</code></p>
        <p>変更は <code>VITE_SERVER_URL</code> 環境変数で。</p>
      </div>
      <div className="card">
        <button onClick={() => setToken(null)}>ログアウト</button>
      </div>
    </div>
  );
}
