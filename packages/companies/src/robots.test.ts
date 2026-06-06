import { describe, it, expect } from 'vitest';
import { parseRobots, isAllowed, pathOf } from './robots.js';

const TXT = `
User-agent: *
Disallow: /private
Allow: /private/public
Crawl-delay: 2

User-agent: BadBot
Disallow: /
`;

describe('parseRobots', () => {
  it('collects rules for * group', () => {
    const r = parseRobots(TXT, 'TirociniumBot/0.1');
    expect(r.disallow).toContain('/private');
    expect(r.allow).toContain('/private/public');
    expect(r.crawlDelay).toBe(2);
  });

  it('applies UA-specific group when UA matches', () => {
    const r = parseRobots(TXT, 'BadBot/1.0');
    expect(r.disallow).toContain('/');
    expect(r.disallow).toContain('/private'); // * group も結合
  });
});

describe('isAllowed', () => {
  const r = parseRobots(TXT, 'TirociniumBot/0.1');
  it('blocks disallowed path', () => {
    expect(isAllowed(r, '/private/data')).toBe(false);
  });
  it('allows when a longer Allow overrides Disallow', () => {
    expect(isAllowed(r, '/private/public/page')).toBe(true);
  });
  it('allows unrelated paths', () => {
    expect(isAllowed(r, '/recruit')).toBe(true);
  });
  it('blocks everything for full disallow', () => {
    const bad = parseRobots(TXT, 'BadBot/1.0');
    expect(isAllowed(bad, '/anything')).toBe(false);
  });
});

describe('wildcard rules', () => {
  it('handles * and $ anchors', () => {
    const r = parseRobots('User-agent: *\nDisallow: /*.pdf$', 'X');
    expect(isAllowed(r, '/docs/a.pdf')).toBe(false);
    expect(isAllowed(r, '/docs/a.html')).toBe(true);
  });
});

describe('pathOf', () => {
  it('extracts pathname', () => {
    expect(pathOf('https://example.com/a/b?x=1')).toBe('/a/b');
    expect(pathOf('not a url')).toBe('/');
  });
});
