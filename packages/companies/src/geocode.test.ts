import { describe, it, expect } from 'vitest';
import { parseGeocodeResult } from './geocode.js';

describe('parseGeocodeResult', () => {
  it('status=OK の先頭結果の lat/lng を返す', () => {
    const json = { status: 'OK', results: [{ geometry: { location: { lat: 35.68, lng: 139.76 } } }] };
    expect(parseGeocodeResult(json)).toEqual({ lat: 35.68, lng: 139.76 });
  });

  it('ZERO_RESULTS / OVER_QUERY_LIMIT は null', () => {
    expect(parseGeocodeResult({ status: 'ZERO_RESULTS', results: [] })).toBeNull();
    expect(parseGeocodeResult({ status: 'OVER_QUERY_LIMIT', results: [] })).toBeNull();
  });

  it('結果なし / 不正形状 / null は null', () => {
    expect(parseGeocodeResult({ status: 'OK', results: [] })).toBeNull();
    expect(parseGeocodeResult({ status: 'OK' })).toBeNull();
    expect(parseGeocodeResult(null)).toBeNull();
    expect(parseGeocodeResult({ status: 'OK', results: [{}] })).toBeNull();
  });

  it('lat/lng が数値でない / (0,0) は null', () => {
    expect(parseGeocodeResult({ status: 'OK', results: [{ geometry: { location: { lat: 'x', lng: 1 } } }] })).toBeNull();
    expect(parseGeocodeResult({ status: 'OK', results: [{ geometry: { location: { lat: 0, lng: 0 } } }] })).toBeNull();
  });
});
