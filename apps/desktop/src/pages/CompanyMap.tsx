import { useEffect, useRef, useState } from 'react';
import { useCompaniesApi, type MapMarker, type Company } from '../api/companies.js';
import { CompanyDetailModal } from './CompanyDetailModal.js';

// Google Maps JS API は型パッケージを入れず any で扱う (依存を増やさない)。
/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window { google?: any; __trMapsLoading?: Promise<void> }
}

/** Google Maps JS を 1 回だけ読み込む (多重 script 注入を防ぐ)。 */
function loadMaps(apiKey: string): Promise<void> {
  if (window.google?.maps) return Promise.resolve();
  if (window.__trMapsLoading) return window.__trMapsLoading;
  window.__trMapsLoading = new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&language=ja&region=JP`;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Google Maps の読み込みに失敗しました (APIキー/参照元制限を確認)'));
    document.head.appendChild(s);
  });
  return window.__trMapsLoading;
}

export function CompanyMap() {
  const api = useCompaniesApi();
  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapObj = useRef<any>(null);
  const drawn = useRef<Set<string>>(new Set());
  const [status, setStatus] = useState<'loading' | 'disabled' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string>('');
  const [count, setCount] = useState(0);
  const [detailFor, setDetailFor] = useState<Company | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const openDetail = async (id: string) => {
    if (loadingId) return;
    setLoadingId(id);
    try {
      const r = await api.get(id);
      setDetailFor(r.company);
    } catch {
      // 取得失敗時は無視
    } finally {
      setLoadingId(null);
    }
  };

  // マーカーを地図に足す (既描画は skip)。
  const addMarkers = (markers: MapMarker[]) => {
    const g = window.google;
    if (!g || !mapObj.current) return;
    for (const m of markers) {
      if (drawn.current.has(m.id)) continue;
      drawn.current.add(m.id);
      const color = m.is_social ? '#6a1b9a' : m.is_smb ? '#1565c0' : '#2e7d32';
      const label = m.name.length > 10 ? `${m.name.slice(0, 10)}…` : m.name;
      const marker = new g.maps.Marker({
        position: { lat: m.lat, lng: m.lng },
        map: mapObj.current,
        title: m.name,
        label: {
          text: label,
          fontSize: '10px',
          fontWeight: '600',
          color: '#1a1a2e',
        },
        icon: {
          path: g.maps.SymbolPath.CIRCLE,
          scale: 6,
          fillColor: color,
          fillOpacity: 0.9,
          strokeColor: '#fff',
          strokeWeight: 1.5,
          labelOrigin: new g.maps.Point(0, -2),
        },
      });
      marker.addListener('click', () => void openDetail(m.id));
    }
    setCount(drawn.current.size);
  };

  useEffect(() => {
    let cancelled = false;
    let pollTimer = 0;

    const fillMarkers = async () => {
      const r = await api.mapMarkers();
      if (cancelled) return;
      addMarkers(r.markers);
      // 未 geocode が残っていれば少し待って再取得 (サーバ側で順次解決)。
      if (r.pendingLocations > 0) pollTimer = window.setTimeout(() => void fillMarkers(), 3000);
    };

    (async () => {
      try {
        const cfg = await api.mapConfig();
        if (cancelled) return;
        if (!cfg.enabled || !cfg.apiKey) {
          setStatus('disabled');
          return;
        }
        await loadMaps(cfg.apiKey);
        if (cancelled || !mapRef.current) return;
        mapObj.current = new window.google.maps.Map(mapRef.current, {
          center: { lat: 36.2, lng: 138.25 }, // 日本全体
          zoom: 5,
          mapTypeControl: false,
          streetViewControl: false,
        });
        setStatus('ready');
        await fillMarkers();
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : '地図の初期化に失敗しました');
          setStatus('error');
        }
      }
    })();

    return () => {
      cancelled = true;
      if (pollTimer) window.clearTimeout(pollTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <h2>企業マップ</h2>
      <p className="company-suggest-count">
        所在地が分かっているゲーム関連企業を地図に配置します。 近さも企業選びの判断材料に。
        {status === 'ready' && ` (${count} 社をプロット)`}
        {loadingId && ' · 読み込み中…'}
      </p>

      {status === 'disabled' && (
        <div className="card">
          Google Maps の API キーが未設定です。 暗号化 config に <code>GOOGLE_MAPS_API_KEY</code> を設定すると有効になります。
        </div>
      )}
      {status === 'error' && <div className="card" style={{ color: '#c62828' }}>⚠ {error}</div>}

      <div
        ref={mapRef}
        style={{
          width: '100%',
          height: '70vh',
          borderRadius: 12,
          border: '1px solid var(--c-border)',
          display: status === 'disabled' ? 'none' : 'block',
        }}
      />
      {detailFor && <CompanyDetailModal c={detailFor} onClose={() => setDetailFor(null)} />}
    </div>
  );
}
