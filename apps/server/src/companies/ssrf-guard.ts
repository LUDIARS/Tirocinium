// SSRF (CWE-918) ガード。 クロール / enrich の外部 fetch を private/loopback/
// link-local 等の内部アドレスへ向けさせない。 ホスト名は DNS 解決して全 IP を検査し、
// リダイレクトも手動追従して各ホップを再検査する (DNS rebinding / Location 経由の迂回対策)。

import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';

/** 到達を拒否する IPv4 レンジ (CIDR)。 */
const BLOCKED_V4: [string, number][] = [
  ['0.0.0.0', 8], // "this" network
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // CGNAT
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // TEST-NET-1
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // TEST-NET-2
  ['203.0.113.0', 24], // TEST-NET-3
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved (incl. 255.255.255.255)
];

function v4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const o = Number(p);
    if (!Number.isInteger(o) || o < 0 || o > 255) return null;
    n = (n << 8) | o;
  }
  return n >>> 0;
}

function isBlockedV4(ip: string): boolean {
  const ipn = v4ToInt(ip);
  if (ipn === null) return true; // パース不能は安全側で拒否
  for (const [net, bits] of BLOCKED_V4) {
    const netn = v4ToInt(net)!;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    if ((ipn & mask) === (netn & mask)) return true;
  }
  return false;
}

/** IPv6 文字列を 8 個の 16bit ワードに展開する。 :: 圧縮と末尾 IPv4 記法に対応。 */
function expandV6(addr: string): number[] | null {
  let a = addr.toLowerCase().split('%')[0]!; // zone id を除去
  // 末尾 IPv4 記法 (::ffff:1.2.3.4) を 2 ワードに変換
  const v4m = a.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4m) {
    const n = v4ToInt(v4m[1]!);
    if (n === null) return null;
    a = a.slice(0, a.length - v4m[1]!.length) + ((n >>> 16) & 0xffff).toString(16) + ':' + (n & 0xffff).toString(16);
  }
  const halves = a.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 ? (halves[1] ? halves[1].split(':') : []) : [];
  const words: number[] = [];
  for (const h of head) words.push(parseInt(h || '0', 16));
  if (halves.length === 2) {
    const fill = 8 - head.length - tail.length;
    if (fill < 0) return null;
    for (let i = 0; i < fill; i++) words.push(0);
    for (const t of tail) words.push(parseInt(t || '0', 16));
  }
  if (words.length !== 8 || words.some((w) => Number.isNaN(w) || w < 0 || w > 0xffff)) return null;
  return words;
}

function isBlockedV6(ip: string): boolean {
  const w = expandV6(ip);
  if (!w) return true; // パース不能は安全側で拒否
  const allZeroExceptLast = w.slice(0, 7).every((x) => x === 0);
  if (allZeroExceptLast && (w[7] === 0 || w[7] === 1)) return true; // :: / ::1
  const first = w[0]!;
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 ULA
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((first & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  // IPv4-mapped ::ffff:0:0/96 → 埋め込み v4 を検査
  if (w[0] === 0 && w[1] === 0 && w[2] === 0 && w[3] === 0 && w[4] === 0 && w[5] === 0xffff) {
    const v4 = `${(w[6]! >>> 8) & 0xff}.${w[6]! & 0xff}.${(w[7]! >>> 8) & 0xff}.${w[7]! & 0xff}`;
    return isBlockedV4(v4);
  }
  return false;
}

function isBlockedIp(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) return isBlockedV4(ip);
  if (kind === 6) return isBlockedV6(ip);
  return true; // 不明形式は拒否
}

/**
 * URL が外部 (public) かを検証する。 http/https 以外、 内部 IP へ解決される
 * ホスト名は throw する。 リテラル IP のホストもレンジ検査する。
 */
export async function assertPublicUrl(rawUrl: string): Promise<void> {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new Error('invalid url');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error(`blocked protocol: ${u.protocol}`);
  }
  const host = u.hostname.replace(/^\[|\]$/g, ''); // IPv6 ブラケット除去

  if (isIP(host)) {
    if (isBlockedIp(host)) throw new Error(`blocked address: ${host}`);
    return;
  }
  // ホスト名は全解決先 IP を検査 (1 つでも内部なら拒否)。
  let records: { address: string }[];
  try {
    records = await lookup(host, { all: true });
  } catch {
    throw new Error(`dns resolution failed: ${host}`);
  }
  if (records.length === 0) throw new Error(`dns resolution empty: ${host}`);
  for (const r of records) {
    if (isBlockedIp(r.address)) throw new Error(`blocked address: ${host} -> ${r.address}`);
  }
}

export type SafeFetchInit = {
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** 追従する最大リダイレクト数 (既定 5)。 */
  maxRedirects?: number;
};

/**
 * SSRF ガード付き fetch。 redirect は手動追従し、 各ホップを assertPublicUrl で再検査する。
 * ガード違反 / リダイレクト超過は throw。
 */
export async function safeFetch(url: string, init: SafeFetchInit = {}): Promise<Response> {
  const maxRedirects = init.maxRedirects ?? 5;
  let current = url;
  for (let i = 0; i <= maxRedirects; i++) {
    await assertPublicUrl(current);
    const res = await fetch(current, {
      headers: init.headers,
      signal: init.signal,
      redirect: 'manual',
    });
    if (res.status >= 300 && res.status < 400 && res.headers.has('location')) {
      const next = new URL(res.headers.get('location')!, current).toString();
      current = next;
      continue;
    }
    return res;
  }
  throw new Error('too many redirects');
}
