// 新着求人を Nuntius (Nt) へ通知する。 config.jobNews.notifyUserId が宛先。
// 宛先未設定 / Nuntius 未設定なら no-op (Web 表示のみで運用できる)。

import { config } from '../config.js';
import { pushNotification } from '../notifications/nuntius.js';
import type { StoredJobPosting } from './job-postings-repo.js';

/** 求人 1 件の表示行 (会社名 + タイトル)。 */
function line(p: StoredJobPosting): string {
  return `・${p.company_name ? `${p.company_name} ` : ''}${p.title}`;
}

/**
 * 新着求人をダイジェスト通知する。 上位 5 件を本文に列挙し、 残りは件数で示す。
 * @returns sent=true なら push 成功 (呼び出し側で notified を立てる)。
 */
export async function notifyJobPostings(
  items: StoredJobPosting[],
): Promise<{ sent: boolean; reason?: string }> {
  if (items.length === 0) return { sent: false, reason: 'empty' };
  if (!config.jobNews.notifyUserId) return { sent: false, reason: 'no_recipient' };

  const top = items.slice(0, 5);
  const more = items.length > top.length ? `\nほか ${items.length - top.length} 件` : '';
  const res = await pushNotification({
    user_id: config.jobNews.notifyUserId,
    title: `ゲーム業界の新着求人 ${items.length} 件`,
    body: top.map(line).join('\n') + more,
    data: {
      kind: 'job_news',
      count: items.length,
      items: items.map((p) => ({ id: p.id, url: p.url, title: p.title, company: p.company_name })),
    },
  });
  return { sent: res.ok, reason: res.reason };
}
