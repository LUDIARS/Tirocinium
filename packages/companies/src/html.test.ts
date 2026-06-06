import { describe, it, expect } from 'vitest';
import { htmlToText, extractTitle, extractMetaDescription, decodeEntities } from './html.js';

describe('htmlToText', () => {
  it('drops script/style and keeps visible text with paragraph breaks', () => {
    const html = `<html><head><style>.a{color:red}</style></head>
      <body><h1>会社概要</h1><script>var x=1;</script><p>ゲームを作る会社</p></body></html>`;
    const text = htmlToText(html);
    expect(text).toContain('会社概要');
    expect(text).toContain('ゲームを作る会社');
    expect(text).not.toContain('color:red');
    expect(text).not.toContain('var x');
  });

  it('truncates to maxChars', () => {
    expect(htmlToText('<p>' + 'あ'.repeat(100) + '</p>', 10)).toHaveLength(10);
  });
});

describe('extractTitle / extractMetaDescription', () => {
  it('reads title and description', () => {
    const html = `<title>株式会社テスト | 採用</title>
      <meta name="description" content="ゲーム開発の会社です">`;
    expect(extractTitle(html)).toBe('株式会社テスト | 採用');
    expect(extractMetaDescription(html)).toBe('ゲーム開発の会社です');
  });

  it('handles reversed meta attribute order', () => {
    const html = `<meta content="逆順" name="description">`;
    expect(extractMetaDescription(html)).toBe('逆順');
  });
});

describe('decodeEntities', () => {
  it('decodes named and numeric entities', () => {
    expect(decodeEntities('A&amp;B &#65; &#x41;')).toBe('A&B A A');
  });
});
