// 提出資料の要点 (digest) をセッションの間だけプロセスのメモリに持つ。
// spec/feature/voice/glab-material-interview.md §3。DB・ファイルへは書かない (CLAUDE.md の個人データ境界)。
// 再接続で同じ要点を使えるよう、セッション終了か TTL まで残す。

import type { MaterialKind } from './material-policy.js';

const TTL_MS = 45 * 60_000;
const MAX_ENTRIES = 64;

export type MaterialDigest = {
  kind: MaterialKind;
  /** interviewer-material-reader の出力 (決まった見出しの Markdown)。 */
  digest: string;
  /** interviewer-mock-interview の本文 (提出時点の Consult の版を固定する)。 */
  interviewerSkill: string;
};

type Entry = MaterialDigest & { userId: string; expiresAt: number };
const entries = new Map<string, Entry>();

function sweep(now: number): void {
  for (const [key, value] of entries) if (value.expiresAt <= now) entries.delete(key);
}

export function putMaterialDigest(sessionId: string, userId: string, value: MaterialDigest, now = Date.now()): void {
  sweep(now);
  entries.delete(sessionId);
  if (entries.size >= MAX_ENTRIES) throw new Error('material_store_capacity');
  entries.set(sessionId, { ...value, userId, expiresAt: now + TTL_MS });
}

/** セッションの持ち主にだけ返す。 */
export function getMaterialDigest(sessionId: string, userId: string, now = Date.now()): MaterialDigest | null {
  const entry = entries.get(sessionId);
  if (!entry || entry.expiresAt <= now) {
    if (entry) entries.delete(sessionId);
    return null;
  }
  if (entry.userId !== userId) return null;
  return { kind: entry.kind, digest: entry.digest, interviewerSkill: entry.interviewerSkill };
}

export function hasMaterialDigest(sessionId: string): boolean {
  return entries.has(sessionId);
}

export function clearMaterialDigest(sessionId: string): void {
  entries.delete(sessionId);
}
