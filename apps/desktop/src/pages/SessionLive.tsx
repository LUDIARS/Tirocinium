import { useParams } from 'react-router-dom';

export function SessionLive() {
  const { id } = useParams();
  return (
    <div>
      <h2>Session Live <span className="todo-tag">scaffold</span></h2>
      <div className="card">
        <p>session id: <code>{id}</code></p>
        <p>WS <code>/api/v1/ws/session/:id</code> 経由で音声 + テキスト stream。
           Voice panel / turn timeline / eval panel の 3 枠を並べる予定。</p>
      </div>
    </div>
  );
}
