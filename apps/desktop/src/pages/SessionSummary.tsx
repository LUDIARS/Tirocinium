import { useParams } from 'react-router-dom';

export function SessionSummary() {
  const { id } = useParams();
  return (
    <div>
      <h2>Session Summary <span className="todo-tag">scaffold</span></h2>
      <div className="card">
        <p>session id: <code>{id}</code></p>
        <p>headline / highlights / axes_summary / growth_points / carry_over /
           interviewer_note をブロックごとに表示。 各ブロックの横に accept /
           reject / edit のフィードバック UI。</p>
      </div>
    </div>
  );
}
