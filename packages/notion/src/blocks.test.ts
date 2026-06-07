import { describe, it, expect } from 'vitest';
import { richTextToPlain, blockToMarkdown, blocksToMarkdown } from './blocks.js';
import type { NotionBlock } from './types.js';

const rt = (s: string) => [{ plain_text: s }];

describe('richTextToPlain', () => {
  it('joins plain_text', () => {
    expect(richTextToPlain([{ plain_text: 'a' }, { plain_text: 'b' }])).toBe('ab');
  });
  it('handles non-array', () => {
    expect(richTextToPlain(undefined)).toBe('');
  });
});

describe('blockToMarkdown', () => {
  const mk = (type: string, body: object): NotionBlock => ({ id: 'x', type, [type]: body } as NotionBlock);

  it('renders headings/paragraph/list/todo/quote/code', () => {
    expect(blockToMarkdown(mk('heading_1', { rich_text: rt('H1') }))).toBe('# H1');
    expect(blockToMarkdown(mk('paragraph', { rich_text: rt('body') }))).toBe('body');
    expect(blockToMarkdown(mk('bulleted_list_item', { rich_text: rt('item') }))).toBe('- item');
    expect(blockToMarkdown(mk('to_do', { rich_text: rt('task'), checked: true }))).toBe('- [x] task');
    expect(blockToMarkdown(mk('quote', { rich_text: rt('q') }))).toBe('> q');
    expect(blockToMarkdown(mk('code', { rich_text: rt('x=1'), language: 'ts' }))).toBe('```ts\nx=1\n```');
    expect(blockToMarkdown(mk('divider', {}))).toBe('---');
  });

  it('renders child_page title', () => {
    expect(blockToMarkdown(mk('child_page', { title: 'Sub' }))).toBe('## Sub');
  });
});

describe('blocksToMarkdown', () => {
  it('indents nested blocks and drops empty', () => {
    const md = blocksToMarkdown([
      { block: { id: '1', type: 'paragraph', paragraph: { rich_text: rt('top') } } as NotionBlock, indent: 0 },
      { block: { id: '2', type: 'bulleted_list_item', bulleted_list_item: { rich_text: rt('child') } } as NotionBlock, indent: 1 },
      { block: { id: '3', type: 'divider', divider: {} } as NotionBlock, indent: 0 },
      { block: { id: '4', type: 'unsupported' } as NotionBlock, indent: 0 },
    ]);
    expect(md).toBe('top\n  - child\n---');
  });
});
