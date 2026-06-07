import { describe, it, expect } from 'vitest';
import { extractTitle, propToString, simplifyProperties } from './page.js';
import type { NotionPage } from './types.js';

const page: NotionPage = {
  id: 'p1',
  properties: {
    Name: { type: 'title', title: [{ plain_text: '応募メモ' }] },
    Status: { type: 'select', select: { name: '選考中' } },
    Tags: { type: 'multi_select', multi_select: [{ name: 'A' }, { name: 'B' }] },
    Score: { type: 'number', number: 42 },
    Done: { type: 'checkbox', checkbox: false },
    Empty: { type: 'rich_text', rich_text: [] },
  },
};

describe('extractTitle', () => {
  it('finds the title-typed property', () => {
    expect(extractTitle(page)).toBe('応募メモ');
  });
  it('returns empty when no title', () => {
    expect(extractTitle({ id: 'x', properties: {} })).toBe('');
  });
});

describe('propToString', () => {
  it('renders select / multi_select / number / checkbox', () => {
    expect(propToString(page.properties!['Status'])).toBe('選考中');
    expect(propToString(page.properties!['Tags'])).toBe('A, B');
    expect(propToString(page.properties!['Score'])).toBe('42');
    expect(propToString(page.properties!['Done'])).toBe('false');
  });
});

describe('simplifyProperties', () => {
  it('drops empty values', () => {
    const out = simplifyProperties(page);
    expect(out['Name']).toBe('応募メモ');
    expect(out['Tags']).toBe('A, B');
    expect(out['Empty']).toBeUndefined();
  });
});
