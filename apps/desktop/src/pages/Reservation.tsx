export function Reservation() {
  return (
    <div>
      <h2>Reservation <span className="todo-tag">scaffold</span></h2>
      <div className="card">
        <p>30 分 slot grid + 混雑 heatmap。 予約 / キャンセル。</p>
        <p>API: <code>GET /api/v1/reservations/slots</code>,
           <code>POST /api/v1/reservations</code>.</p>
      </div>
    </div>
  );
}
