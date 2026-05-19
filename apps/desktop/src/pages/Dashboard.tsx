import { Link } from 'react-router-dom';
import { useMyReservations } from '../api/reservations.js';
import { useAuth } from '../auth/AuthContext.js';

export function Dashboard() {
  const { setToken } = useAuth();
  const reservations = useMyReservations();
  return (
    <div>
      <h2>Dashboard</h2>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>クイックアクション</h3>
        <div style={{ display: 'flex', gap: 12 }}>
          <Link to="/start" className="nav-link active">面接を始める</Link>
          <Link to="/personas" className="nav-link active">面接官を選ぶ</Link>
          <Link to="/reservation" className="nav-link active">予約を見る</Link>
        </div>
      </div>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>自分の予約</h3>
        {reservations === null ? (
          <p>読み込み中…</p>
        ) : reservations.length === 0 ? (
          <p>予約はありません</p>
        ) : (
          <ul>
            {reservations.map((r) => (
              <li key={r.id}>
                {r.slot_start} — <code>{r.status}</code>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>セッション</h3>
        <p>サーバー側 sessions 一覧 API は未追加。 直近を表示できるようになり次第ここに表示。</p>
      </div>
      <div className="card">
        <button onClick={() => setToken(null)}>ログアウト</button>
      </div>
    </div>
  );
}
