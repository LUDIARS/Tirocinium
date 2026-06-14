import { describe, it, expect } from 'vitest';
import { mergeSources, coerceSources } from './provenance.js';

describe('coerceSources', () => {
  it('returns [] for non-array / garbage', () => {
    expect(coerceSources(null)).toEqual([]);
    expect(coerceSources('[]')).toEqual([]); // 文字列はここでは parse しない (DB driver が parse 済前提)
    expect(coerceSources([1, 'x', null])).toEqual([]);
  });
  it('keeps well-formed entries, drops sourceless', () => {
    expect(
      coerceSources([
        { source: 'a', url: 'http://a' },
        { source: '', url: 'http://b' },
        { url: 'http://c' },
      ]),
    ).toEqual([{ source: 'a', url: 'http://a' }]);
  });
});

describe('mergeSources', () => {
  it('appends new entry preserving order', () => {
    const prev = [{ source: 'tgs', url: 'http://tgs' }];
    expect(mergeSources(prev, [{ source: 'honne', url: 'http://h' }])).toEqual([
      { source: 'tgs', url: 'http://tgs' },
      { source: 'honne', url: 'http://h' },
    ]);
  });
  it('dedups identical source+url', () => {
    const prev = [{ source: 'honne', url: 'http://h' }];
    expect(mergeSources(prev, [{ source: 'honne', url: 'http://h' }])).toEqual(prev);
  });
  it('keeps same source with different url as distinct', () => {
    const prev = [{ source: 'honne', url: 'http://h1' }];
    const out = mergeSources(prev, [{ source: 'honne', url: 'http://h2' }]);
    expect(out).toHaveLength(2);
  });
  it('drops sourceless additions and trims', () => {
    expect(mergeSources([], [{ source: '  tgs  ', url: ' http://x ' }, { source: '', url: 'y' }])).toEqual([
      { source: 'tgs', url: 'http://x' },
    ]);
  });
  it('caps at 20 entries', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ source: `s${i}`, url: `u${i}` }));
    expect(mergeSources([], many)).toHaveLength(20);
  });
});
