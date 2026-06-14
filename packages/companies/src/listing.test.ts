import { describe, it, expect } from 'vitest';
import { parseListing, chunkText } from './listing.js';

describe('parseListing', () => {
  it('parses companies with new is_listed / size_hint fields', () => {
    const json = JSON.stringify({
      companies: [
        {
          name: 'スタジオX',
          recruit_url: 'http://x/recruit',
          url: 'http://x',
          industry: 'ゲーム',
          snippet: '新卒募集中',
          is_newgrad: true,
          is_game: true,
          has_opening: true,
          is_listed: false,
          size_hint: '従業員30名',
        },
      ],
    });
    const [e] = parseListing(json);
    expect(e?.name).toBe('スタジオX');
    expect(e?.isListed).toBe(false);
    expect(e?.sizeHint).toBe('従業員30名');
    expect(e?.flagsHint?.isGame).toBe(true);
  });

  it('leaves isListed undefined when absent', () => {
    const json = JSON.stringify({ companies: [{ name: 'A' }] });
    const [e] = parseListing(json);
    expect(e?.isListed).toBeUndefined();
    expect(e?.sizeHint).toBeUndefined();
  });

  it('skips nameless rows', () => {
    const json = JSON.stringify({ companies: [{ name: '' }, { name: 'B' }] });
    expect(parseListing(json).map((e) => e.name)).toEqual(['B']);
  });
});

describe('chunkText', () => {
  it('returns single chunk when under size', () => {
    expect(chunkText('hello', 100, 5)).toEqual(['hello']);
  });
  it('returns [] for empty', () => {
    expect(chunkText('   ', 100, 5)).toEqual([]);
  });
  it('splits large text into multiple chunks within maxChunks', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `company-${i}`).join('\n');
    const chunks = chunkText(lines, 200, 12);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.length).toBeLessThanOrEqual(12);
    // 全チャンク連結で元の社名がすべて含まれる (取りこぼし無し)
    const joined = chunks.join('\n');
    expect(joined).toContain('company-0');
    expect(joined).toContain('company-99');
  });
  it('prefers newline boundaries', () => {
    const text = 'aaaa\nbbbb\ncccc\ndddd';
    const chunks = chunkText(text, 10, 12);
    // 改行優先で切るので各チャンクは行途中で割れない
    for (const c of chunks) expect(c.startsWith('a') || c.startsWith('b') || c.startsWith('c') || c.startsWith('d')).toBe(true);
  });
  it('caps at maxChunks', () => {
    const lines = Array.from({ length: 1000 }, (_, i) => `x${i}`).join('\n');
    expect(chunkText(lines, 50, 3).length).toBe(3);
  });
});
