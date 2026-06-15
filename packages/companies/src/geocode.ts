// Google Geocoding API レスポンスの純パーサ。 lat/lng のみ取り出す (LLM・IO 不使用)。
// 所在地文字列 → 緯度経度。 status!=OK や結果なしは null。

export type LatLng = { lat: number; lng: number };

/** Geocoding API の JSON から先頭結果の lat/lng を取り出す。 失敗時 null。 */
export function parseGeocodeResult(json: unknown): LatLng | null {
  if (!json || typeof json !== 'object') return null;
  const obj = json as Record<string, unknown>;
  if (obj['status'] !== 'OK') return null;
  const results = obj['results'];
  if (!Array.isArray(results) || results.length === 0) return null;
  const loc = (results[0] as Record<string, unknown>)?.['geometry'] as Record<string, unknown> | undefined;
  const ll = loc?.['location'] as Record<string, unknown> | undefined;
  const lat = Number(ll?.['lat']);
  const lng = Number(ll?.['lng']);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}
