import { describe, it, expect } from 'vitest';
import { normalizeTechToken, parseTechStack, deriveGraphicsStyle } from './tech.js';

describe('normalizeTechToken', () => {
  it('canonicalizes engines/languages/tools', () => {
    expect(normalizeTechToken('Unreal Engine 4/5')).toEqual({ name: 'Unreal Engine', category: 'engine' });
    expect(normalizeTechToken('Unity (C#)')).toEqual({ name: 'Unity', category: 'engine' });
    expect(normalizeTechToken('C/C++')).toEqual({ name: 'C++', category: 'language' });
    expect(normalizeTechToken('AWS')).toEqual({ name: 'AWS', category: 'cloud' });
    expect(normalizeTechToken('Maya')).toEqual({ name: 'Maya', category: 'dcc' });
  });
  it('returns null for non-tech noise', () => {
    expect(normalizeTechToken('プランナー')).toBeNull();
    expect(normalizeTechToken('自社IP')).toBeNull();
  });
});

describe('parseTechStack', () => {
  it('canonicalizes + dedups (UE4/UE5 → one Unreal)', () => {
    const out = parseTechStack(['Unity', 'C#', 'Unreal Engine 4', 'Unreal Engine 5', 'ベンチャー']);
    const names = out.map((t) => t.name).sort();
    expect(names).toEqual(['C#', 'Unity', 'Unreal Engine']);
  });
});

describe('deriveGraphicsStyle', () => {
  it('Unreal + console + action → high', () => {
    expect(deriveGraphicsStyle(['Unreal Engine'], ['console'], ['アクションRPG'])).toBe('high');
  });
  it('Unity + mobile + puzzle → casual', () => {
    expect(deriveGraphicsStyle(['Unity'], ['mobile'], ['パズル'])).toBe('casual');
  });
  it('no signal → empty', () => {
    expect(deriveGraphicsStyle([], [], [])).toBe('');
  });
});
