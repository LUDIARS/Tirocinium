export function SessionStart() {
  return (
    <div>
      <h2>Session Start <span className="todo-tag">scaffold</span></h2>
      <div className="card">
        <p>モード選択 (ローカル / サーバー)、 志望タグ、 面接官ペルソナ選択、
           LLM プロファイル確認。 開始ボタンで <code>POST /api/v1/sessions</code>。</p>
      </div>
    </div>
  );
}
