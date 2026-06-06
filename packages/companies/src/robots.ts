// robots.txt の最小パーサ + パス許可判定。 純粋関数。
// fetch / cache は呼び出し側 (server) の責務。 ここは「テキスト → ルール → allow 判定」のみ。

import type { RobotsRules } from './types.js';

/**
 * robots.txt を指定 UA 向けに評価ルールへ畳む。
 * - `User-agent: *` と、 ua に部分一致するグループを対象にする (ua 固有 > * の順で結合)。
 * - allow / disallow / crawl-delay を収集。
 */
export function parseRobots(text: string, userAgent: string): RobotsRules {
  const uaLower = userAgent.toLowerCase();
  const lines = text.split(/\r?\n/);

  // グループ単位で {agents, allow, disallow, crawlDelay} を集める
  type Group = { agents: string[]; allow: string[]; disallow: string[]; crawlDelay?: number };
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;

  for (const raw of lines) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const field = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (field === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], allow: [], disallow: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (field === 'disallow') {
      if (value) current.disallow.push(value);
      // 空 disallow は「全許可」を意味するが、 ここでは無視 (allow 既定なので等価)
    } else if (field === 'allow') {
      if (value) current.allow.push(value);
    } else if (field === 'crawl-delay') {
      const n = Number(value);
      if (Number.isFinite(n)) current.crawlDelay = n;
    }
  }

  const matched = groups.filter((g) =>
    g.agents.some((a) => a === '*' || (a !== '' && uaLower.includes(a))),
  );
  const rules: RobotsRules = { disallow: [], allow: [] };
  for (const g of matched) {
    rules.disallow.push(...g.disallow);
    rules.allow.push(...g.allow);
    if (g.crawlDelay !== undefined && rules.crawlDelay === undefined) rules.crawlDelay = g.crawlDelay;
  }
  return rules;
}

/**
 * パスが許可されるか。 robots の慣習に従い「最長一致が勝つ / 同長なら allow 優先」。
 * disallow ルールが無ければ許可。
 */
export function isAllowed(rules: RobotsRules, pathname: string): boolean {
  const path = pathname || '/';
  const longestDisallow = longestMatch(rules.disallow, path);
  const longestAllow = longestMatch(rules.allow, path);
  if (longestDisallow < 0) return true; // 該当 disallow なし
  return longestAllow >= longestDisallow; // allow が同長以上なら許可
}

/** path に前方一致する rule のうち最長のマッチ長を返す。 一致無しは -1。 */
function longestMatch(rules: string[], path: string): number {
  let best = -1;
  for (const rule of rules) {
    if (matchRule(rule, path) && rule.length > best) best = rule.length;
  }
  return best;
}

/** robots のワイルドカード (* と末尾 $) に対応した前方一致。 */
function matchRule(rule: string, path: string): boolean {
  if (rule === '') return false;
  if (!rule.includes('*') && !rule.endsWith('$')) {
    return path.startsWith(rule);
  }
  // 末尾 $ は行末アンカー。 それ以外のメタをリテラル化し、 ワイルドカード * を .* にする。
  let anchored = false;
  let body = rule;
  if (body.endsWith('$')) {
    body = body.slice(0, -1);
    anchored = true;
  }
  const pattern = body
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&') // 正規表現メタを退避 (* は対象外)
    .replace(/\*/g, '.*'); // robots のワイルドカード
  const re = new RegExp('^' + pattern + (anchored ? '$' : ''));
  return re.test(path);
}

/** allow リスト由来で「クロール対象 URL の pathname」を渡しやすくする補助。 */
export function pathOf(url: string): string {
  try {
    return new URL(url).pathname || '/';
  } catch {
    return '/';
  }
}
