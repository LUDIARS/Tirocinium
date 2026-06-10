// 新卒採用者インタビュー記事の リンク選定 + 「会社が求める新卒像」 要約の prompt/parse。
// 純粋関数 (LLM 呼び出しは server 側 completer に注入する)。

import { extractAnchors } from './links.js';
import { extractJsonBlock } from '@tirocinium/llm';

/** 会社が求める新卒像の要約結果。 */
export type NewgradImage = {
  /** 求める人物像の要約 (本文) */
  summary: string;
  /** 頻出する価値観 / キーワード */
  themes: string[];
};

// インタビュー / 社員紹介 記事への誘導とみなす語彙。
const INTERVIEW_TEXT =
  /インタビュー|社員紹介|社員の声|社員の本音|働く人|働く仲間|座談会|クロストーク|先輩社員|メンバー紹介|新卒|若手|内定者|1年目|一年目|社員ストーリー|interview|member|people|voice|staff|story|crosstalk|culture/i;
const INTERVIEW_HREF =
  /interview|member|people|voice|staff|story|talk|crosstalk|employee|recruit|saiyo|culture|article|posts?|blog|note/i;

function absolutize(href: string, base: string): string | null {
  try {
    const u = new URL(href, base);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    u.hash = '';
    return u.toString();
  } catch {
    return null;
  }
}

function host(u: string): string {
  try {
    return new URL(u).host;
  } catch {
    return '';
  }
}

/**
 * HTML からインタビュー記事候補リンクを選ぶ。
 * - 既定は同一ホストのみ (allowCrossHost で外部許可: 起点が wantedly 等の集約サイトの場合)。
 * - テキスト or href の語彙一致で採用。 重複除去し最大 max 件。
 */
export function selectInterviewLinks(
  baseUrl: string,
  html: string,
  max = 100,
  allowCrossHost = false,
): string[] {
  const baseHost = host(baseUrl);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const a of extractAnchors(html)) {
    const abs = absolutize(a.href, baseUrl);
    if (!abs || seen.has(abs)) continue;
    if (!allowCrossHost && host(abs) !== baseHost) continue;
    if ((a.text && INTERVIEW_TEXT.test(a.text)) || INTERVIEW_HREF.test(abs)) {
      seen.add(abs);
      out.push(abs);
      if (out.length >= max) break;
    }
  }
  return out;
}

/** URL の dedup キー (末尾スラッシュ / クエリ除去)。 */
export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    u.search = '';
    let s = u.toString();
    if (s.endsWith('/')) s = s.slice(0, -1);
    return s;
  } catch {
    return url.trim();
  }
}

export const NEWGRAD_IMAGE_INSTRUCTION = `
あなたは、ある企業の「新卒採用者インタビュー記事」 を複数読み、
その会社が **新卒採用で求めている人物像** を就活生向けに要約するアシスタントです。

出力は **JSON オブジェクト 1 個のみ**。前置き・コードフェンス以外の説明は禁止。
スキーマ:
{
  "summary": "会社が新卒に求める人物像・資質・カルチャー適合の要約 (300〜500字)",
  "themes": ["繰り返し語られる価値観/資質のキーワード", ...]   // 5〜12 個
}

ルール:
- 記事に書かれている事実・語られている価値観のみを根拠にする。 推測や一般論で水増ししない。
- 個人名や個人の経歴は要約に含めない (人物像の抽象化に留める)。
- 「主体性」「挑戦」「チームワーク」 等、 複数記事で繰り返される要素を優先して themes に挙げる。
- summary は面接練習 AI が「この会社の面接官の観点」 を作るのに使える粒度で書く。
`.trim();

/** LLM 出力テキストを NewgradImage に parse する。 */
export function parseNewgradImage(text: string): NewgradImage {
  const obj = JSON.parse(extractJsonBlock(text)) as Record<string, unknown>;
  const summary = typeof obj['summary'] === 'string' ? obj['summary'].trim() : '';
  const themes = Array.isArray(obj['themes'])
    ? obj['themes'].filter((x): x is string => typeof x === 'string' && x.trim() !== '').slice(0, 12)
    : [];
  return { summary, themes };
}
