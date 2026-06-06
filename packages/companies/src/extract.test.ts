import { describe, it, expect } from 'vitest';
import { parseCompanyExtraction, heuristicExtract } from './extract.js';

describe('parseCompanyExtraction', () => {
  it('parses a JSON object and fills url from seed', () => {
    const text = `\`\`\`json
{ "name": "株式会社テスト", "industry": "ゲーム", "roles": ["エンジニア"], "tags": ["Unity"], "description": "ゲーム会社" }
\`\`\``;
    const out = parseCompanyExtraction(text, { url: 'https://example.com' });
    expect(out.name).toBe('株式会社テスト');
    expect(out.roles).toEqual(['エンジニア']);
    expect(out.url).toBe('https://example.com');
    expect(out.source_url).toBe('https://example.com');
  });

  it('falls back name to seed nameHint when missing', () => {
    const out = parseCompanyExtraction('{"industry":"Web"}', {
      url: 'https://x.test',
      nameHint: 'ヒント社',
    });
    expect(out.name).toBe('ヒント社');
  });
});

describe('heuristicExtract', () => {
  it('uses title (first segment) and meta description', () => {
    const html = `<title>テスト社 | 採用情報</title><meta name="description" content="概要文">`;
    const out = heuristicExtract(html, { url: 'https://t.test' });
    expect(out.name).toBe('テスト社');
    expect(out.description).toBe('概要文');
    expect(out.url).toBe('https://t.test');
  });

  it('prefers nameHint over title', () => {
    const out = heuristicExtract('<title>無関係</title>', { url: 'https://t.test', nameHint: '本命社' });
    expect(out.name).toBe('本命社');
  });
});
