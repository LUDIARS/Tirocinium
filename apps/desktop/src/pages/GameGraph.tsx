import { useMemo, useState } from 'react';
import type { RelatedCompany, RelatedResult } from '../api/games.js';

// 依存ライブラリ無しの力学グラフ。 Fruchterman-Reingold で 1 回だけ settle し、
// 結果を SVG に静的描画する (ノード数は数十オーダーなので同期計算で充分)。

type NodeKind = 'game' | 'direct' | 'related';

interface LayoutNode {
  id: string;
  label: string;
  kind: NodeKind;
  company: RelatedCompany | null;
  x: number;
  y: number;
  r: number;
  dx: number; // 力学計算用の累積変位 (iter ごとにリセット)
  dy: number;
}

interface LayoutEdge {
  from: string;
  to: string;
  kind: 'direct' | 'related';
}

interface Layout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  viewBox: string;
}

const CANVAS = 900; // レイアウト計算用の論理領域 (正方)
const ITERATIONS = 320;

/** 企業規模からノード半径を決める (不明は既定)。 */
function nodeRadius(c: RelatedCompany): number {
  const n = c.employee_count;
  if (n <= 0) return 13;
  if (n >= 2000) return 24;
  if (n >= 500) return 20;
  if (n >= 100) return 17;
  return 14;
}

/** RelatedResult から決定論的に力学レイアウトを計算する。 */
function computeLayout(result: RelatedResult): Layout {
  const game = result.game;
  const nodes: LayoutNode[] = [];
  const edges: LayoutEdge[] = [];

  nodes.push({ id: 'game', label: game?.title ?? 'ゲーム', kind: 'game', company: null, x: 0, y: 0, r: 30, dx: 0, dy: 0 });

  // 初期配置は二重リング (direct=内/related=外)。 角度を均等割りして重なりを減らす。
  const place = (companies: RelatedCompany[], kind: 'direct' | 'related', radius: number, phase: number) => {
    companies.forEach((c, i) => {
      const a = phase + (i / Math.max(companies.length, 1)) * Math.PI * 2;
      nodes.push({
        id: `${kind}-${c.id}`,
        label: c.name,
        kind,
        company: c,
        x: Math.cos(a) * radius,
        y: Math.sin(a) * radius,
        r: nodeRadius(c),
        dx: 0,
        dy: 0,
      });
      edges.push({ from: 'game', to: `${kind}-${c.id}`, kind });
    });
  };
  place(result.direct, 'direct', 200, 0);
  place(result.related, 'related', 380, Math.PI / 7);

  // Fruchterman-Reingold relaxation。 累積変位は node.dx/dy に持たせる
  // (インデックスアクセスを避けてオブジェクト参照で回す)。
  const k = 0.9 * Math.sqrt((CANVAS * CANVAS) / Math.max(nodes.length, 1));
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const simEdges = edges.map((e) => ({ a: byId.get(e.from)!, b: byId.get(e.to)!, kind: e.kind }));
  const idealLen = (kind: 'direct' | 'related') => (kind === 'direct' ? k * 0.55 : k * 1.0);
  let temp = CANVAS / 8;

  for (let iter = 0; iter < ITERATIONS; iter++) {
    for (const n of nodes) {
      n.dx = 0;
      n.dy = 0;
    }
    // 斥力 (全ペア)。
    for (let i = 0; i < nodes.length; i++) {
      const a = nodes[i]!;
      for (let j = i + 1; j < nodes.length; j++) {
        const b = nodes[j]!;
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let dist = Math.hypot(dx, dy);
        if (dist < 0.01) {
          // 完全重なりを避けるため決定論的に微小ずらし。
          dx = ((i - j) % 2 === 0 ? 1 : -1) * 0.1;
          dy = 0.1;
          dist = Math.hypot(dx, dy);
        }
        const force = (k * k) / dist;
        const ux = (dx / dist) * force;
        const uy = (dy / dist) * force;
        a.dx += ux;
        a.dy += uy;
        b.dx -= ux;
        b.dy -= uy;
      }
    }
    // 引力 (エッジ)。
    for (const e of simEdges) {
      const dx = e.a.x - e.b.x;
      const dy = e.a.y - e.b.y;
      const dist = Math.max(Math.hypot(dx, dy), 0.01);
      const force = (dist * dist) / idealLen(e.kind);
      const ux = (dx / dist) * force;
      const uy = (dy / dist) * force;
      e.a.dx -= ux;
      e.a.dy -= uy;
      e.b.dx += ux;
      e.b.dy += uy;
    }
    // 変位を temp で制限して適用。 game ノードは中心固定。
    for (const n of nodes) {
      if (n.kind === 'game') continue;
      const len = Math.max(Math.hypot(n.dx, n.dy), 0.01);
      n.x += (n.dx / len) * Math.min(len, temp);
      n.y += (n.dy / len) * Math.min(len, temp);
    }
    temp *= 0.985; // cooling
  }
  // game を (0,0) に固定したままなので中心は揃っている。

  // viewBox を内容に合わせる (ラベル分の余白込み)。
  const pad = 90;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x - n.r);
    minY = Math.min(minY, n.y - n.r);
    maxX = Math.max(maxX, n.x + n.r);
    maxY = Math.max(maxY, n.y + n.r);
  }
  const vbX = minX - pad;
  const vbY = minY - pad;
  const vbW = maxX - minX + pad * 2;
  const vbH = maxY - minY + pad * 2;

  return { nodes, edges, viewBox: `${vbX} ${vbY} ${vbW} ${vbH}` };
}

const KIND_FILL: Record<NodeKind, string> = {
  game: 'var(--c-accent)',
  direct: '#34d399',
  related: '#a78bfa',
};

function truncate(s: string, n = 11): string {
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

interface Props {
  result: RelatedResult;
  selectedId: string | null;
  onSelect: (company: RelatedCompany | null) => void;
}

export function GameGraph({ result, selectedId, onSelect }: Props) {
  // result が変わった時だけレイアウト再計算。
  const layout = useMemo(() => computeLayout(result), [result]);
  const [hoverId, setHoverId] = useState<string | null>(null);

  const total = result.direct.length + result.related.length;

  // hover 優先、 無ければ選択中ノードを「強調起点」にする。
  const activeId = hoverId ?? selectedId;
  const neighborIds = useMemo(() => {
    const set = new Set<string>();
    if (!activeId) return set;
    for (const e of layout.edges) {
      if (e.from === activeId) set.add(e.to);
      if (e.to === activeId) set.add(e.from);
    }
    return set;
  }, [activeId, layout.edges]);

  if (total === 0) {
    return <p className="company-suggest-count">関連会社がまだ見つかりません (データ拡充で増えます)。</p>;
  }

  const isEdgeActive = (e: LayoutEdge) => !!activeId && (e.from === activeId || e.to === activeId);
  const isDimmed = (id: string) => !!activeId && id !== activeId && !neighborIds.has(id);
  const nodeById = (id: string) => layout.nodes.find((n) => n.id === id)!;

  return (
    <div className="game-graph">
      <div className="game-graph-legend">
        <span><i className="dot dot-game" /> ゲーム</span>
        <span><i className="dot dot-direct" /> 直接関与 ({result.direct.length})</span>
        <span><i className="dot dot-related" /> 共作ネットワーク ({result.related.length})</span>
        <span className="game-graph-hint">ノードをクリックで会社詳細</span>
      </div>
      <svg
        className="game-graph-svg"
        viewBox={layout.viewBox}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`${result.game?.title ?? 'ゲーム'} の関連会社グラフ`}
      >
        <g className="graph-edges">
          {layout.edges.map((e) => {
            const a = nodeById(e.from);
            const b = nodeById(e.to);
            const active = isEdgeActive(e);
            return (
              <line
                key={`${e.from}->${e.to}`}
                x1={a.x}
                y1={a.y}
                x2={b.x}
                y2={b.y}
                className={`graph-edge graph-edge-${e.kind}${active ? ' active' : ''}`}
              />
            );
          })}
        </g>
        <g className="graph-nodes">
          {layout.nodes.map((n) => {
            const selected = selectedId === n.id;
            const dimmed = isDimmed(n.id);
            const tip = n.company
              ? `${n.company.name}${n.company.employee_count > 0 ? ` / ${n.company.employee_count}名` : ''}` +
                `${n.company.relation === 'related' && n.company.shared_games ? ` / 共作${n.company.shared_games}本` : ''}`
              : n.label;
            return (
              <g
                key={n.id}
                className={`graph-node graph-node-${n.kind}${selected ? ' selected' : ''}${dimmed ? ' dimmed' : ''}`}
                transform={`translate(${n.x} ${n.y})`}
                onMouseEnter={() => setHoverId(n.id)}
                onMouseLeave={() => setHoverId((h) => (h === n.id ? null : h))}
                onClick={() => onSelect(n.company)}
                tabIndex={0}
                role="button"
                onKeyDown={(ev) => {
                  if (ev.key === 'Enter' || ev.key === ' ') onSelect(n.company);
                }}
              >
                <title>{tip}</title>
                <circle r={n.r} style={{ fill: KIND_FILL[n.kind] }} className="graph-node-circle" />
                {n.company?.has_opening && <circle r={4} cx={n.r - 2} cy={-n.r + 2} className="graph-node-opening" />}
                <text className="graph-node-label" y={n.r + 13} textAnchor="middle">
                  {truncate(n.label)}
                </text>
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
