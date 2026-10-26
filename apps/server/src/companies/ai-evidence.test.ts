import { describe, expect, it } from 'vitest';
import { extractAiEvidence, isOfficialSite } from './ai-evidence.js';

describe('official AI evidence boundary', () => {
  it('allows official subdomains but excludes external recruitment, credentials and suffix tricks', () => {
    const root = 'https://www.example.com';
    expect(isOfficialSite('https://ir.example.com/strategy', root)).toBe(true);
    for (const url of ['https://hrmos.co/pages/example', 'https://example.com.evil.test/', 'https://user:pass@example.com/', 'file:///test']) {
      expect(isOfficialSite(url, root)).toBe(false);
    }
  });
  it('preserves negative policy and dates without promoting mentions into adoption', () => {
    const html = '<title>Policy</title><meta property="article:published_time" content="2026-02-16"><p>生成AI素材は製品に実装しない。一方、開発効率の向上を検証する。</p>';
    const evidence = extractAiEvidence(html, 'https://example.com/policy', '2026-10-26T00:00:00Z')[0]!;
    expect(evidence.excerpt).toContain('実装しない');
    expect(evidence.excerpt).toContain('検証');
    expect(evidence.publishedAt).toBe('2026-02-16');
    expect(evidence.interpretation).toBe('quoted_mention_only');
    expect(extractAiEvidence('<p>AI 2026</p>', evidence.url, evidence.fetchedAt)[0]!.publishedAt).toBeNull();
  });
});
