// OB 輩出スタジオ + 代表作の結合ビュー (OB→会社→ゲーム)。 集計のみ・個人情報なし (§2.1)。
// GET /api/v1/companies/ob/studios を読み、 就職者数順にスタジオと代表作を出す。
// クリックで企業検索に流す (onPick → 親の setQ)。 OB データ未投入 (空) なら何も描画しない。

import { useEffect, useState } from 'react';
import { useCompaniesApi, type ObStudio } from '../api/companies.js';

export function ObStudios({ onPick }: { onPick?: (name: string) => void }) {
  const api = useCompaniesApi();
  const [studios, setStudios] = useState<ObStudio[] | null>(null);
  const [open, setOpen] = useState(true);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .obStudios(12, 4)
      .then((r) => { if (alive) setStudios(r.studios); })
      .catch(() => { if (alive) setErr(true); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // OB データ未投入 / 取得失敗時は非表示 (ノイズを出さない)。
  if (err) return null;
  if (studios && studios.length === 0) return null;

  return (
    <div className="card" style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <h3 style={{ margin: 0, flex: 1 }}>🎓 OB 輩出スタジオと代表作</h3>
        <button
          className="fd-btn-secondary"
          style={{ fontSize: 12, padding: '4px 12px' }}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? '隠す' : '表示'}
        </button>
      </div>
      <p style={{ opacity: 0.7, fontSize: 12, margin: '4px 0 8px' }}>
        先輩 (OB) が就職したスタジオを就職者数順に。 各社の代表作つき（集計のみ・個人情報なし）。
      </p>
      {!studios && <p style={{ opacity: 0.7 }}>読み込み中…</p>}
      {open && studios && (
        <div>
          {studios.map((s) => (
            <div
              key={s.id}
              style={{
                display: 'flex',
                gap: 10,
                alignItems: 'baseline',
                padding: '6px 0',
                borderTop: '1px solid var(--fd-border, #eee)',
                flexWrap: 'wrap',
              }}
            >
              <button
                className="fd-link-btn"
                style={{ fontWeight: 600 }}
                onClick={() => onPick?.(s.name)}
                title="この企業で絞り込む"
              >
                {s.name}
              </button>
              <span className="fd-chip">OB {s.ob_total}名</span>
              <span style={{ flex: 1, minWidth: 200, opacity: 0.85, fontSize: 13 }}>
                {s.games.length > 0 ? (
                  s.games.map((g) => g.title).join(' / ')
                ) : (
                  <em style={{ opacity: 0.6 }}>代表作データなし</em>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
