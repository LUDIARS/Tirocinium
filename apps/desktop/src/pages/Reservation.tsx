import { useReservationSlots, useMyReservations } from '../api/reservations.js';

export function Reservation() {
  const { data: slots, error } = useReservationSlots(48);
  const mine = useMyReservations();
  return (
    <div>
      <h2>Reservation</h2>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>自分の予約</h3>
        {mine === null ? <p>読み込み中…</p> : mine.length === 0 ? <p>無し</p> : (
          <ul>
            {mine.map((r) => (
              <li key={r.id}>
                {r.slot_start} — <code>{r.status}</code>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="card">
        <h3 style={{ marginTop: 0 }}>直近 48 時間の slot</h3>
        {error && <p style={{ color: '#c62828' }}>取得失敗: {error.message}</p>}
        {slots && (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: 6 }}>slot start (UTC)</th>
                <th style={{ textAlign: 'right', padding: 6 }}>used / capacity</th>
              </tr>
            </thead>
            <tbody>
              {slots.map((s) => (
                <tr key={s.slot_start}>
                  <td style={{ padding: 6, fontFamily: 'monospace' }}>{s.slot_start}</td>
                  <td style={{ padding: 6, textAlign: 'right' }}>
                    {s.used} / {s.capacity}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
