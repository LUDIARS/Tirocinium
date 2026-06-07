// Notion page の properties からタイトル抽出 + key→string 簡易化。 純粋関数。

import { richTextToPlain } from './blocks.js';
import type { NotionPage } from './types.js';

type Prop = { type?: string; [k: string]: unknown };

/** properties から title 型プロパティを探して plain text を返す。 無ければ ''。 */
export function extractTitle(page: NotionPage): string {
  const props = page.properties ?? {};
  for (const value of Object.values(props)) {
    const p = value as Prop;
    if (p?.type === 'title') return richTextToPlain(p['title']).trim();
  }
  return '';
}

/** 1 プロパティを表示用文字列へ落とす。 */
export function propToString(value: unknown): string {
  const p = value as Prop;
  if (!p || typeof p !== 'object') return '';
  switch (p.type) {
    case 'title':
      return richTextToPlain(p['title']);
    case 'rich_text':
      return richTextToPlain(p['rich_text']);
    case 'number':
      return p['number'] == null ? '' : String(p['number']);
    case 'select':
      return (p['select'] as { name?: string } | null)?.name ?? '';
    case 'status':
      return (p['status'] as { name?: string } | null)?.name ?? '';
    case 'multi_select':
      return ((p['multi_select'] as { name?: string }[] | undefined) ?? [])
        .map((s) => s.name ?? '')
        .filter(Boolean)
        .join(', ');
    case 'date': {
      const d = p['date'] as { start?: string; end?: string } | null;
      if (!d?.start) return '';
      return d.end ? `${d.start} ~ ${d.end}` : d.start;
    }
    case 'checkbox':
      return p['checkbox'] ? 'true' : 'false';
    case 'url':
      return (p['url'] as string) ?? '';
    case 'email':
      return (p['email'] as string) ?? '';
    case 'phone_number':
      return (p['phone_number'] as string) ?? '';
    case 'people':
      return `${((p['people'] as unknown[]) ?? []).length} people`;
    case 'files':
      return `${((p['files'] as unknown[]) ?? []).length} files`;
    case 'created_time':
      return (p['created_time'] as string) ?? '';
    case 'last_edited_time':
      return (p['last_edited_time'] as string) ?? '';
    case 'formula': {
      const f = p['formula'] as Record<string, unknown> | null;
      if (!f) return '';
      return String(f['string'] ?? f['number'] ?? f['boolean'] ?? f['date'] ?? '');
    }
    default:
      return '';
  }
}

/** properties 全体を key→string に落とす (空値は除く)。 */
export function simplifyProperties(page: NotionPage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(page.properties ?? {})) {
    const s = propToString(value).trim();
    if (s) out[key] = s;
  }
  return out;
}
