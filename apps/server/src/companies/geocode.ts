// 企業所在地のジオコーディング (Google Geocoding API) + マップマーカー構築。
// 所在地文字列単位でキャッシュ (geocode_cache, migration 015) し API 呼び出しを最小化。
// パースは @tirocinium/companies (純粋)。 key 未設定なら geocode せず空で返す。

import { sql } from '../db/index.js';
import { config } from '../config.js';
import { parseGeocodeResult, type LatLng } from '@tirocinium/companies';

const GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';

type CacheRow = { location: string; lat: number; lng: number; ok: number | boolean };

const toBool = (v: unknown): boolean => v === true || v === 1 || v === '1' || v === 't';

/** キャッシュから 1 件。 未取得は null。 */
async function getCache(location: string): Promise<{ lat: number; lng: number; ok: boolean } | null> {
  const rows = await sql<CacheRow[]>`SELECT location, lat, lng, ok FROM geocode_cache WHERE location = ${location}`;
  const r = rows[0];
  return r ? { lat: Number(r.lat), lng: Number(r.lng), ok: toBool(r.ok) } : null;
}

async function putCache(location: string, v: { lat: number; lng: number; ok: boolean }): Promise<void> {
  await sql`
    INSERT INTO geocode_cache (location, lat, lng, ok)
    VALUES (${location}, ${v.lat}, ${v.lng}, ${v.ok})
    ON CONFLICT (location) DO UPDATE SET lat = EXCLUDED.lat, lng = EXCLUDED.lng, ok = EXCLUDED.ok, geocoded_at = now()
  `;
}

/** 1 所在地を geocode する (API)。 結果は cache へ。 失敗は ok=false で記録 (再試行抑制)。 */
async function geocodeViaApi(location: string, apiKey: string): Promise<LatLng | null> {
  const url = `${GEOCODE_URL}?address=${encodeURIComponent(location)}&language=ja&region=jp&key=${apiKey}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    return parseGeocodeResult(await res.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export type MapMarker = {
  id: string;
  name: string;
  location: string;
  lat: number;
  lng: number;
  is_smb: boolean;
  is_social: boolean;
  game_count: number;
};

type CompanyLoc = { id: string; name: string; location: string; is_smb: unknown; is_social: unknown; game_count: number | string };

/** location を持つゲーム関連企業を取得 (マップ対象)。 */
async function companiesWithLocation(): Promise<CompanyLoc[]> {
  return sql<CompanyLoc[]>`
    SELECT c.id, c.name, c.location, c.is_smb, c.is_social,
      (SELECT count(*) FROM company_game cg WHERE cg.company_id = c.id) AS game_count
    FROM companies c
    WHERE c.location <> ''
      AND EXISTS (SELECT 1 FROM company_game cg WHERE cg.company_id = c.id)
  `;
}

export type MapMarkersResult = {
  enabled: boolean;
  markers: MapMarker[];
  /** 未 geocode で今回保留した所在地数 (再呼び出しで解決) */
  pendingLocations: number;
};

/**
 * マップマーカーを返す。 未キャッシュの所在地を最大 maxGeocode 件だけ今回 geocode する
 * (残りは pendingLocations、 再呼び出しで順次解決)。 key 未設定なら enabled:false。
 */
export async function buildMapMarkers(maxGeocode = 60): Promise<MapMarkersResult> {
  const apiKey = config.googleMaps.apiKey;
  if (!apiKey) return { enabled: false, markers: [], pendingLocations: 0 };

  const companies = await companiesWithLocation();
  const distinct = [...new Set(companies.map((c) => c.location))];

  // 未キャッシュを今回分だけ geocode。
  const coords = new Map<string, { lat: number; lng: number; ok: boolean }>();
  let geocoded = 0;
  let pending = 0;
  for (const loc of distinct) {
    const cached = await getCache(loc);
    if (cached) {
      coords.set(loc, cached);
      continue;
    }
    if (geocoded >= maxGeocode) {
      pending++;
      continue;
    }
    const ll = await geocodeViaApi(loc, apiKey);
    geocoded++;
    const v = ll ? { ...ll, ok: true } : { lat: 0, lng: 0, ok: false };
    await putCache(loc, v);
    coords.set(loc, v);
  }

  const markers: MapMarker[] = [];
  for (const c of companies) {
    const ll = coords.get(c.location);
    if (!ll || !ll.ok) continue;
    markers.push({
      id: c.id, name: c.name, location: c.location, lat: ll.lat, lng: ll.lng,
      is_smb: toBool(c.is_smb), is_social: toBool(c.is_social), game_count: Number(c.game_count),
    });
  }
  return { enabled: true, markers, pendingLocations: pending };
}
