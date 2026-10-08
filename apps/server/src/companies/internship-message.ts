// 公開インターン情報の選別とDiscord用の短い案内。本文の転載は行わない。
import type { StoredJobPosting } from './job-postings-repo.js';

const INTERNSHIP = /インターン|internship|仕事体験|オープン[・\s-]?カンパニー/i;

export function isInternshipPosting(item: StoredJobPosting, now: Date = new Date()): boolean {
  // 曖昧な日付は推測せず掲載元へ案内。日付が明確なら締切日のJST終了後に除外する。
  if (/^\d{4}-\d{2}-\d{2}$/.test(item.deadline)) {
    const closes = Date.parse(`${item.deadline}T23:59:59.999+09:00`);
    if (Number.isFinite(closes) && closes < now.getTime()) return false;
  }
  return INTERNSHIP.test([item.title, item.employment_type, item.snippet].join(' '));
}

function plain(value: string, limit: number): string {
  return value.replace(/[\r\n\t]+/g, ' ').replace(/[@<>*_`~|\\]/g, '').slice(0, limit);
}

export function internshipMessage(item: StoredJobPosting): string {
  let url: URL;
  try { url = new URL(item.url); } catch { throw new Error('invalid_posting_url'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.href.length > 800) {
    throw new Error('invalid_posting_url');
  }
  return [
    'インターン・仕事体験の新着情報',
    plain(item.title, 200),
    item.company_name ? `企業: ${plain(item.company_name, 100)}` : '',
    item.role ? `職種: ${plain(item.role, 100)}` : '',
    item.deadline ? `締切（掲載情報）: ${plain(item.deadline, 100)}` : '締切: 掲載元で確認してください',
    `情報源: ${plain(item.source, 80)}`,
    `<${url.href}>`,
    '募集状況・応募条件は掲載元で確認してください。',
  ].filter(Boolean).join('\n');
}
