import { expect, it } from 'vitest';
import { performance } from 'node:perf_hooks';
import { htmlToText, extractTitle } from './html.js';
import { extractAnchors } from './links.js';
import { parseFeed } from './rss.js';

const large = (token: string): string => token.repeat(Math.ceil(131072 / token.length));
const cases: [string, () => unknown][] = [
  ...['<', '<!--', '<script>'].map(token => [`html ${token}`, () => htmlToText(large(token))] as [string, () => unknown]),
  ['anchors', () => extractAnchors(large('<a '))],
  ['anchor bodies', () => extractAnchors(large('<a href="/x">'))],
  ['items', () => parseFeed(large('<item>'))],
  ['entries', () => parseFeed(large('<entry>'))],
  ...['<link ', '<link>', '<category>', '<category ', '<title>', '<![CDATA['].map(token => [`feed ${token}`, () => parseFeed(`<item><link>https://example.com/</link>${large(token)}</item>`)] as [string, () => unknown]),
  ['title', () => extractTitle(large('<title'))],
];
it.each(cases)('finishes 128 KiB of unterminated %s under one second', (_name, run) => {
  const started = performance.now();
  run();
  expect(performance.now() - started).toBeLessThan(1000);
});

it('exercises compatibility contracts', () => {
  expect(htmlToText('<p>A &amp; B</p><script>hidden</script>')).toBe('A & B');
  expect(extractAnchors('<a href="/about"><b>About</b></a>')).toEqual([{ href: '/about', text: 'About' }]);
  expect(parseFeed('<item><title>News</title><link>https://example.com/</link></item>')[0]?.title).toBe('News');
});
