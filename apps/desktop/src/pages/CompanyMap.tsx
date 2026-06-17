import { useEffect, useRef, useState } from 'react';
import { useCompaniesApi, type MapMarker, type Company } from '../api/companies.js';
import { CompanyDetailModal } from './CompanyDetailModal.js';

// Google Maps JS API は型パッケージを入れず any で扱う (依存を増やさない)。
/* eslint-disable @typescript-eslint/no-explicit-any */
declare global {
  interface Window {
    google?: any;
    __trMapsLoading?: Promise<void>;
    __trMapSelect?: (id: string) => void;
  }
}

const LABEL_ZOOM = 13; // この zoom 以上で企業名を pin に表示 (Google Maps 店名と同水準)
// 先端が原点 (0,0)、円の中心が (0,-26)、半径 10 の水滴型ピン (Google 標準ピンと同形状)
const PIN_PATH = 'M 0,0 C -2,-17 -10,-19 -10,-26 A 10,10 0 0,1 10,-26 C 10,-19 2,-17 0,0 Z';

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

/** lat/lng を 4 桁に丸めた位置キー (同建物を同一グループにまとめる)。 */
const locKey = (m: MapMarker) => `${m.lat.toFixed(4)},${m.lng.toFixed(4)}`;

export function CompanyMap() {
  const api = useCompaniesApi();
  const mapRef = useRef<HTMLDivElement | null>(null);
  const mapObj = useRef<any>(null);
  const infoObj = useRef<any>(null);
  const drawn = useRef<Set<string>>(new Set());
  const markersRef = useRef<{ marker: any; labelText: string }[]>([]);
  const myMarkerRef = useRef<any>(null);
  const [status, setStatus] = useState<'loading' | 'disabled' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<string>('');
  const [count, setCount] = useState(0);
  const [detailFor, setDetailFor] = useState<Company | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [geoBusy, setGeoBusy] = useState(false);
  const [geoError, setGeoError] = useState<string>('');

  // 現在地を取得して地図をその位置にズーム。 既に全社のピンは描画済みなので、
  // 現在地に寄せるだけで「近くの企業」が画面に集まる。
  const locateMe = () => {
    if (!mapObj.current) return;
    if (!('geolocation' in navigator)) {
      setGeoError('この端末は位置情報に対応していません');
      return;
    }
    setGeoError('');
    setGeoBusy(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeoBusy(false);
        const g = window.google;
        if (!g || !mapObj.current) return;
        const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        mapObj.current.setCenter(here);
        mapObj.current.setZoom(14); // LABEL_ZOOM 以上 → 近隣企業の名前ラベルも表示される
        if (myMarkerRef.current) myMarkerRef.current.setMap(null);
        myMarkerRef.current = new g.maps.Marker({
          position: here,
          map: mapObj.current,
          title: '現在地',
          zIndex: 9999,
          icon: {
            path: g.maps.SymbolPath.CIRCLE,
            scale: 8,
            fillColor: '#1a73e8',
            fillOpacity: 1,
            strokeColor: '#fff',
            strokeWeight: 2,
          },
        });
      },
      (err) => {
        setGeoBusy(false);
        setGeoError(
          err.code === err.PERMISSION_DENIED
            ? '位置情報の利用が許可されませんでした (ブラウザ/OS の設定を確認)'
            : '現在地を取得できませんでした',
        );
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const openDetail = async (id: string) => {
    if (loadingId) return;
    infoObj.current?.close();
    setLoadingId(id);
    try {
      const r = await api.get(id);
      setDetailFor(r.company);
    } catch { /* ignore */ } finally {
      setLoadingId(null);
    }
  };

  const makeLabelObj = (text: string) => ({ text, fontSize: '10px', fontWeight: '600', color: '#1a1a2e' });

  // バッファで受け取ったマーカーを位置でグループ化してピンを立てる。
  // 同一位置に複数社ある場合は InfoWindow でピッカーを表示。
  const addMarkers = (newMarkers: MapMarker[]) => {
    const g = window.google;
    if (!g || !mapObj.current) return;

    // 既描画済みも含めた全マーカーデータを蓄積しておく必要があるので、
    // ここでは新規分だけ位置キー → [MapMarker] に積んでグループを更新する。
    const groups = new Map<string, MapMarker[]>();
    for (const m of newMarkers) {
      if (drawn.current.has(m.id)) continue;
      drawn.current.add(m.id);
      const k = locKey(m);
      const g = groups.get(k) ?? [];
      g.push(m);
      groups.set(k, g);
    }
    if (groups.size === 0) return;

    const currentZoom: number = mapObj.current.getZoom() ?? 5;
    const showLabel = currentZoom >= LABEL_ZOOM;

    for (const group of groups.values()) {
      const first = group[0]!;
      const color = first.is_social ? '#6a1b9a' : first.is_smb ? '#1565c0' : '#2e7d32';
      const labelText = group.length > 1
        ? `${group.length}社`
        : (first.name.length > 10 ? `${first.name.slice(0, 10)}…` : first.name);

      const marker = new g.maps.Marker({
        position: { lat: first.lat, lng: first.lng },
        map: mapObj.current,
        title: group.map((m) => m.name).join(' / '),
        label: showLabel ? makeLabelObj(labelText) : null,
        icon: {
          path: PIN_PATH,
          fillColor: color,
          fillOpacity: 0.92,
          strokeColor: '#fff',
          strokeWeight: 1.5,
          scale: 1,
          anchor: new g.maps.Point(0, 0),
          labelOrigin: new g.maps.Point(0, -36),
        },
      });

      marker.addListener('click', () => {
        if (group.length === 1) {
          void openDetail(group[0]!.id);
        } else {
          // 同一位置に複数社 → InfoWindow でピッカー表示
          const rows = group
            .map((m) => `<div style="padding:5px 0;border-bottom:1px solid #eee;cursor:pointer;font-size:13px"
              onclick="window.__trMapSelect('${m.id}')">${m.name}</div>`)
            .join('');
          infoObj.current.setContent(
            `<div style="min-width:160px;max-height:240px;overflow-y:auto">${rows}</div>`,
          );
          infoObj.current.open(mapObj.current, marker);
        }
      });

      markersRef.current.push({ marker, labelText });
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
      if (r.pendingLocations > 0) pollTimer = window.setTimeout(() => void fillMarkers(), 3000);
    };

    (async () => {
      try {
        const cfg = await api.mapConfig();
        if (cancelled) return;
        if (!cfg.enabled || !cfg.apiKey) { setStatus('disabled'); return; }
        await loadMaps(cfg.apiKey);
        if (cancelled || !mapRef.current) return;
        mapObj.current = new window.google.maps.Map(mapRef.current, {
          center: { lat: 36.2, lng: 138.25 },
          zoom: 5,
          mapTypeControl: false,
          streetViewControl: false,
        });
        infoObj.current = new window.google.maps.InfoWindow();
        // ズーム変化でラベル表示を切り替え
        mapObj.current.addListener('zoom_changed', () => {
          const zoom: number = mapObj.current.getZoom() ?? 5;
          const show = zoom >= LABEL_ZOOM;
          for (const { marker, labelText } of markersRef.current) {
            marker.setLabel(show ? makeLabelObj(labelText) : null);
          }
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

  // InfoWindow の onclick が React の外から openDetail を呼べるよう global に登録
  useEffect(() => {
    window.__trMapSelect = (id: string) => void openDetail(id);
    return () => { delete window.__trMapSelect; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingId]);

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
      {status === 'ready' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '8px 0', flexWrap: 'wrap' }}>
          <button type="button" onClick={locateMe} disabled={geoBusy}>
            {geoBusy ? '現在地を取得中…' : '📍 現在地から近い企業を探す'}
          </button>
          {geoError && <span style={{ color: '#c62828', fontSize: 13 }}>{geoError}</span>}
        </div>
      )}
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
