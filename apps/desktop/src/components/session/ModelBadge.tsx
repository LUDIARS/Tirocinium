type Props = {
  mode: 'server' | 'local';
};

const SERVER_MODELS = [
  { label: 'Sonnet', role: '応答' },
  { label: 'Opus', role: '評価' },
  { label: 'GPT-5.5', role: '深掘り' },
];

const LOCAL_MODELS = [
  { label: 'Local LLM', role: '応答/評価' },
];

export function ModelBadge({ mode }: Props) {
  const models = mode === 'server' ? SERVER_MODELS : LOCAL_MODELS;
  return (
    <div className="model-badge-row">
      {models.map((m) => (
        <span key={m.label} className="model-badge" title={m.role}>
          {m.label}
          <span className="model-badge-role">{m.role}</span>
        </span>
      ))}
    </div>
  );
}
