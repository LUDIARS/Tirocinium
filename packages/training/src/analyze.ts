// ES / 面接データ解析 — 保存済 Notion ページ / chat ログを Lector で構造化し、
// 教師データ (TrainingDocInput) に変換する。 DESIGN §3.1-3.2。
//
// 解析は純粋関数 (html 文字列 → 構造化データ)。 HTML の取得や Memoria への
// 永続化は呼び出し側 (server) の責務。

import {
  reparseHtml,
  extractNotionBlocks,
  extractNotionTitle,
  extractChatMessages,
  extractChatTitle,
  type NotionExtractedBlock,
  type ChatExtractedMessage,
  type ChatExtractionSource,
} from '@ludiars/lector';
import type { TrainingDocInput } from './types.js';

// ── ES ───────────────────────────────────────────────────────────────

export interface EsSection {
  /** セクション見出し。 先頭の見出し無しブロック群は heading='' */
  heading: string;
  /** セクション本文 (ブロックを改行で連結) */
  body: string;
}

export interface EsDocument {
  title: string;
  sections: EsSection[];
  /** RAG / system prompt 用に整形したプレーンテキスト */
  text: string;
}

// ── 面接 ─────────────────────────────────────────────────────────────

export interface InterviewExchange {
  /** 面接官の発話 (質問) */
  question: string;
  /** 受験者の回答 */
  answer: string;
}

export interface InterviewTranscript {
  title: string;
  exchanges: InterviewExchange[];
  /** RAG / system prompt 用に整形したプレーンテキスト */
  text: string;
}

// ── Notion ブロック整形 ───────────────────────────────────────────────

type NotionHeadingKind = 'heading_1' | 'heading_2' | 'heading_3';

/** 見出しブロックかを判定する型ガード (narrowing して .text を使えるように)。 */
function isHeading(
  b: NotionExtractedBlock,
): b is NotionExtractedBlock & { kind: NotionHeadingKind; text: string } {
  return b.kind === 'heading_1' || b.kind === 'heading_2' || b.kind === 'heading_3';
}

/** Notion ブロックを 1 行テキストに落とす。 空文字は捨てる前提。 */
function notionBlockToLine(b: NotionExtractedBlock): string {
  switch (b.kind) {
    case 'heading_1':
    case 'heading_2':
    case 'heading_3':
    case 'text':
    case 'quote':
      return b.text;
    case 'bullet_list':
      return `- ${b.text}`;
    case 'numbered_list':
      return `1. ${b.text}`;
    case 'todo':
      return `[${b.checked ? 'x' : ' '}] ${b.text}`;
    case 'code':
      return b.text;
    case 'bookmark':
      return b.title ? `${b.title} (${b.url})` : b.url;
    case 'divider':
      return '';
  }
}

// ── ES 解析 ──────────────────────────────────────────────────────────

function renderEsText(sections: EsSection[]): string {
  return sections
    .map((s) => (s.heading ? `## ${s.heading}\n${s.body}` : s.body))
    .map((t) => t.trim())
    .filter(Boolean)
    .join('\n\n');
}

/** 保存済 Notion ページ HTML を ES として構造化する。 見出しでセクション分割。 */
export function analyzeEsFromNotion(html: string, title?: string): EsDocument {
  const blocks = extractNotionBlocks(html);
  const sections: EsSection[] = [];
  let heading = '';
  let lines: string[] = [];

  const flush = (): void => {
    const body = lines.join('\n').trim();
    if (heading || body) sections.push({ heading, body });
    lines = [];
  };

  for (const b of blocks) {
    if (isHeading(b)) {
      flush();
      heading = b.text;
    } else {
      const line = notionBlockToLine(b);
      if (line) lines.push(line);
    }
  }
  flush();

  return {
    title: title ?? extractNotionTitle(html),
    sections,
    text: renderEsText(sections),
  };
}

/** URL から種別を auto-detect して ES として解析する。 未対応 URL は null。 */
export function analyzeEs(url: string, html: string): EsDocument | null {
  const parsed = reparseHtml(url, html);
  if (!parsed) return null;
  if (parsed.kind === 'notion') {
    return analyzeEsFromNotion(html, parsed.title);
  }
  // chat ログを ES とみなすのは例外的だが、 全文を 1 セクションに落とす
  const body = parsed.messages.map((m) => m.text).join('\n\n').trim();
  const sections: EsSection[] = body ? [{ heading: '', body }] : [];
  return { title: parsed.title, sections, text: renderEsText(sections) };
}

// ── 面接データ解析 ───────────────────────────────────────────────────

function renderInterviewText(exchanges: InterviewExchange[]): string {
  return exchanges
    .map((e, i) => `Q${i + 1}. ${e.question}\nA${i + 1}. ${e.answer}`)
    .join('\n\n');
}

/** role 列を Q&A の往復に畳む。 assistant=面接官 / user=受験者。 */
function pairMessages(messages: ChatExtractedMessage[]): InterviewExchange[] {
  const exchanges: InterviewExchange[] = [];
  let q = '';
  let a = '';
  const push = (): void => {
    if (q.trim() || a.trim()) exchanges.push({ question: q.trim(), answer: a.trim() });
    q = '';
    a = '';
  };
  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'assistant') {
      // 既に回答が溜まっている = 1 往復完了 → 次の質問へ
      if (a) push();
      q = q ? `${q}\n${m.text}` : m.text;
    } else {
      a = a ? `${a}\n${m.text}` : m.text;
    }
  }
  push();
  return exchanges;
}

/** chat ログ (ChatGPT / Claude / Gemini の保存 HTML) を面接 Q&A に構造化。 */
export function analyzeInterviewFromChat(
  html: string,
  source: ChatExtractionSource,
  title?: string,
): InterviewTranscript {
  const exchanges = pairMessages(extractChatMessages(html, source));
  return {
    title: title ?? extractChatTitle(html),
    exchanges,
    text: renderInterviewText(exchanges),
  };
}

// 行頭の Q / A マーカー (例 "Q1.", "質問：", "A)", "回答1、")
const Q_MARKER = /^\s*(?:質問|問|Q|q)\s*[\d０-９]*\s*[.．):）：、]\s*/;
const A_MARKER = /^\s*(?:回答|答|A|a)\s*[\d０-９]*\s*[.．):）：、]\s*/;

/** 見出しを質問、 続く本文を回答とみなす fallback。 */
function interviewByHeading(blocks: NotionExtractedBlock[], title: string): InterviewTranscript {
  const exchanges: InterviewExchange[] = [];
  let q = '';
  let a = '';
  const push = (): void => {
    if (q.trim()) exchanges.push({ question: q.trim(), answer: a.trim() });
    q = '';
    a = '';
  };
  for (const b of blocks) {
    if (isHeading(b)) {
      push();
      q = b.text;
    } else {
      const line = notionBlockToLine(b);
      if (line) a = a ? `${a}\n${line}` : line;
    }
  }
  push();
  return { title, exchanges, text: renderInterviewText(exchanges) };
}

/** 保存済 Notion ページ HTML を面接 Q&A に構造化する。
 *  行頭の Q/A マーカーで分割。 マーカーが無ければ見出しベースに fallback。 */
export function analyzeInterviewFromNotion(html: string, title?: string): InterviewTranscript {
  const blocks = extractNotionBlocks(html);
  const lines = blocks.map(notionBlockToLine).filter((l) => l.trim());
  const docTitle = title ?? extractNotionTitle(html);

  const exchanges: InterviewExchange[] = [];
  let q = '';
  let a = '';
  let mode: 'q' | 'a' | null = null;
  let sawMarker = false;
  const push = (): void => {
    if (q.trim() || a.trim()) exchanges.push({ question: q.trim(), answer: a.trim() });
    q = '';
    a = '';
  };

  for (const line of lines) {
    if (Q_MARKER.test(line)) {
      sawMarker = true;
      if (a) push();
      const t = line.replace(Q_MARKER, '');
      q = q ? `${q}\n${t}` : t;
      mode = 'q';
    } else if (A_MARKER.test(line)) {
      sawMarker = true;
      const t = line.replace(A_MARKER, '');
      a = a ? `${a}\n${t}` : t;
      mode = 'a';
    } else if (mode === 'q') {
      q = q ? `${q}\n${line}` : line;
    } else if (mode === 'a') {
      a = a ? `${a}\n${line}` : line;
    }
    // mode===null (マーカー前の前置き) は捨てる
  }
  push();

  if (!sawMarker) {
    return interviewByHeading(blocks, docTitle);
  }
  return { title: docTitle, exchanges, text: renderInterviewText(exchanges) };
}

/** URL から種別を auto-detect して面接データとして解析する。 未対応 URL は null。 */
export function analyzeInterview(url: string, html: string): InterviewTranscript | null {
  const parsed = reparseHtml(url, html);
  if (!parsed) return null;
  if (parsed.kind === 'chat') {
    return analyzeInterviewFromChat(html, parsed.source, parsed.title);
  }
  return analyzeInterviewFromNotion(html, parsed.title);
}

// ── 教師データ変換 ───────────────────────────────────────────────────

/** ES 解析結果を Memoria 永続化用の TrainingDocInput に変換する。 */
export function esToTrainingDoc(
  es: EsDocument,
  userId: string,
  tags: string[] = [],
): TrainingDocInput {
  return { user_id: userId, kind: 'es', body: es.text, tags };
}

/** 面接トランスクリプトを Memoria 永続化用の TrainingDocInput に変換する。 */
export function interviewToTrainingDoc(
  transcript: InterviewTranscript,
  userId: string,
  tags: string[] = [],
): TrainingDocInput {
  return { user_id: userId, kind: 'past_qa', body: transcript.text, tags };
}
