// Notion block[] → Markdown 文字列。 純粋関数。
// rich_text の plain_text を主に使い、 主要ブロック種別を Markdown に落とす。

import type { NotionBlock, NotionRichText } from './types.js';

/** rich_text 配列を plain text に連結する。 */
export function richTextToPlain(rich: unknown): string {
  if (!Array.isArray(rich)) return '';
  return (rich as NotionRichText[])
    .map((r) => (typeof r?.plain_text === 'string' ? r.plain_text : ''))
    .join('');
}

/** block の type 固有オブジェクトから rich_text を取り出す。 */
function blockText(block: NotionBlock): string {
  const body = block[block.type] as { rich_text?: unknown } | undefined;
  return richTextToPlain(body?.rich_text);
}

/** 1 ブロックを Markdown 行へ。 不明 type は空文字。 children は呼び出し側で処理。 */
export function blockToMarkdown(block: NotionBlock): string {
  const t = blockText(block);
  switch (block.type) {
    case 'heading_1':
      return `# ${t}`;
    case 'heading_2':
      return `## ${t}`;
    case 'heading_3':
      return `### ${t}`;
    case 'paragraph':
      return t;
    case 'bulleted_list_item':
      return `- ${t}`;
    case 'numbered_list_item':
      return `1. ${t}`;
    case 'to_do': {
      const checked = (block['to_do'] as { checked?: boolean } | undefined)?.checked;
      return `- [${checked ? 'x' : ' '}] ${t}`;
    }
    case 'toggle':
      return `- ${t}`;
    case 'quote':
      return `> ${t}`;
    case 'callout':
      return `> ${t}`;
    case 'code': {
      const lang = (block['code'] as { language?: string } | undefined)?.language ?? '';
      return `\`\`\`${lang}\n${t}\n\`\`\``;
    }
    case 'divider':
      return '---';
    case 'child_page':
      return `## ${(block['child_page'] as { title?: string } | undefined)?.title ?? ''}`;
    case 'child_database':
      return `## ${(block['child_database'] as { title?: string } | undefined)?.title ?? ''} (database)`;
    case 'bookmark':
    case 'embed':
    case 'link_preview': {
      const url = (block[block.type] as { url?: string } | undefined)?.url ?? '';
      return url ? `[${url}](${url})` : '';
    }
    default:
      return t; // table_row 等は rich_text を持たないこともあるが best-effort
  }
}

/**
 * フラットな block 列 (indent 深さ付き) を Markdown に連結する。
 * indentByBlockId: 各 block の入れ子深さ (0 起点)。 無指定は 0。
 */
export function blocksToMarkdown(
  blocks: { block: NotionBlock; indent: number }[],
): string {
  const lines: string[] = [];
  for (const { block, indent } of blocks) {
    const md = blockToMarkdown(block);
    if (md === '') continue;
    const pad = '  '.repeat(Math.max(0, indent));
    lines.push(md.split('\n').map((l, i) => (i === 0 ? pad + l : l)).join('\n'));
  }
  return lines.join('\n');
}
