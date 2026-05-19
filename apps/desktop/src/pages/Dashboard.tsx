export function Dashboard() {
  return (
    <div>
      <h2>Dashboard <span className="todo-tag">scaffold</span></h2>
      <div className="card">
        <p>直近セッション、 予約状況、 未消化評価をここに並べる。</p>
        <p>API: <code>GET /api/v1/sessions</code>, <code>GET /api/v1/reservations/me</code>.</p>
      </div>
    </div>
  );
}
