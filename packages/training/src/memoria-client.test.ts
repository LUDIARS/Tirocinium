import { describe, expect, it } from 'vitest';
import { renderRagBlock } from './memoria-client.js';
import type { RagResult } from './types.js';

describe('renderRagBlock', () => {
  it('returns empty for no items', () => {
    expect(renderRagBlock({ items: [] })).toBe('');
  });

  it('numbers items and includes kind', () => {
    const r: RagResult = {
      items: [
        { embedding_id: 'a', memoria_uri: 'mem://a', kind: 'es', tags: [], excerpt: 'ES の抜粋', score: 0.9 },
        { embedding_id: 'b', memoria_uri: 'mem://b', kind: 'past_qa', tags: [], excerpt: '過去 Q&A', score: 0.8 },
      ],
    };
    const out = renderRagBlock(r);
    expect(out).toMatch(/1\. \(es\) ES の抜粋/);
    expect(out).toMatch(/2\. \(past_qa\) 過去 Q&A/);
  });
});
