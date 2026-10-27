/** Forward-only delimiter scans for untrusted HTML/XML; no network I/O. */
export type MarkupElement = { opening: string; content: string; start: number; end: number };

export function scanOpeningTags(input: string, name: RegExp): string[] {
  const out: string[] = [];
  name.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = name.exec(input)) !== null) {
    const end = input.indexOf('>', name.lastIndex);
    if (end < 0) break;
    out.push(input.slice(match.index, end + 1));
    name.lastIndex = end + 1;
  }
  return out;
}

/** Patterns match only the tag name, never an unbounded attribute/body suffix. */
export function scanElements(input: string, opening: RegExp, closing: RegExp): MarkupElement[] {
  const out: MarkupElement[] = [];
  opening.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = opening.exec(input)) !== null) {
    const tagEnd = input.indexOf('>', opening.lastIndex);
    if (tagEnd < 0) break;
    closing.lastIndex = tagEnd + 1;
    const close = closing.exec(input);
    // A missing close cannot become available for a later opener of this type.
    if (!close) break;
    out.push({ opening: input.slice(match.index, tagEnd + 1),
      content: input.slice(tagEnd + 1, close.index), start: match.index, end: closing.lastIndex });
    opening.lastIndex = closing.lastIndex;
  }
  return out;
}

/** Replace completed delimiter pairs and retain an unterminated suffix verbatim. */
export function replaceDelimited(input: string, open: string, close: string, replacement: string | null): string {
  const parts: string[] = [];
  let cursor = 0;
  for (;;) {
    const start = input.indexOf(open, cursor);
    if (start < 0) break;
    const end = input.indexOf(close, start + open.length);
    if (end < 0) break;
    parts.push(input.slice(cursor, start), replacement ?? input.slice(start + open.length, end));
    cursor = end + close.length;
  }
  parts.push(input.slice(cursor));
  return parts.join('');
}

/** Matches the old <[^>]+> removal, including its treatment of empty <>. */
export function stripTags(input: string): string {
  const parts: string[] = [];
  let cursor = 0;
  let search = 0;
  for (;;) {
    const start = input.indexOf('<', search);
    if (start < 0) break;
    if (input[start + 1] === '>') {
      search = start + 2;
      continue;
    }
    const end = input.indexOf('>', start + 2);
    if (end < 0) break;
    parts.push(input.slice(cursor, start), ' ');
    cursor = end + 1;
    search = cursor;
  }
  parts.push(input.slice(cursor));
  return parts.join('');
}

/** Preserve the original leftmost raw-element removal, including mixed tag types. */
export function stripRawElements(input: string): string {
  const opening = /<(script|style|noscript|svg|template)/gi;
  const exhausted = new Set<string>();
  const parts: string[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = opening.exec(input)) !== null) {
    const tag = match[1]!.toLowerCase();
    if (exhausted.has(tag)) continue;
    const tagEnd = input.indexOf('>', opening.lastIndex);
    if (tagEnd < 0) break;
    const closing = new RegExp(`</${tag}>`, 'gi');
    closing.lastIndex = tagEnd + 1;
    const close = closing.exec(input);
    if (!close) {
      // Remember a failed search so later openers cannot rescan the same suffix.
      exhausted.add(tag);
      continue;
    }
    parts.push(input.slice(cursor, match.index), ' ');
    cursor = closing.lastIndex;
    opening.lastIndex = cursor;
  }
  parts.push(input.slice(cursor));
  return parts.join('');
}
