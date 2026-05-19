export function PersonaCatalog() {
  return (
    <div>
      <h2>Personas <span className="todo-tag">scaffold</span></h2>
      <div className="card">
        <p>面接官ペルソナ一覧 (stage × role × temperament の絞り込み)。
           自作追加。 受験者ペルソナは admin のみ。</p>
        <p>API: <code>GET /api/v1/personas/interviewers</code> 等。</p>
      </div>
    </div>
  );
}
