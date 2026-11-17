// 旧 Node 版の SQLite データを 1 つのファイルにまとめた「移行 bundle」の形式と、その読み取り。
//
// bundle 自体が SQLite のファイル (単一の通常ファイル。展開しないのでパストラバーサルの余地が無い):
//   - tirocinium_bundle_meta(key, value): service=tirocinium / format=legacy-sqlite / version=1
//   - data/tirocinium.sqlite の表はそのままの名前
//   - data/companies.sqlite の表は COMPANIES_PREFIX を付けた名前 (同名の表と混ざらないように)
// 作るのは pack-legacy-sqlite.mjs。読むのは import-data.mjs (読み取り専用・不変として開く)。

import { createHash } from 'node:crypto';
import { createReadStream, lstatSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openSqlite } from './sqlite.mjs';

export const BUNDLE_META_TABLE = 'tirocinium_bundle_meta';
export const BUNDLE_SERVICE = 'tirocinium';
export const BUNDLE_FORMAT = 'legacy-sqlite';
export const BUNDLE_VERSION = '1';
export const COMPANIES_PREFIX = 'legacy_companies__';

/** ファイルの SHA-256 (小文字 16 進)。 */
export async function sha256File(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

/** 入力の検査: 絶対パス・通常ファイル (シンボリックリンクは不可)・ハッシュ一致。 */
export async function verifyBundleFile(path, expectedSha256) {
  if (!isAbsolute(path)) throw new Error('--input は絶対パスで指定する');
  if (!/^[0-9a-f]{64}$/i.test(expectedSha256 ?? '')) throw new Error('--sha256 は 64 桁の 16 進で指定する');
  const st = lstatSync(path, { throwIfNoEntry: false });
  if (!st || !st.isFile()) throw new Error('--input が通常ファイルではない (シンボリックリンク・ディレクトリは受けない)');
  const actual = await sha256File(path);
  if (actual !== expectedSha256.toLowerCase()) throw new Error('--sha256 が入力ファイルと一致しない');
}

/** bundle を読み取り専用・不変 (immutable) で開き、所有サービスと形式版を確かめる。 */
export function openBundle(path) {
  const url = pathToFileURL(path);
  url.search = '?mode=ro&immutable=1';
  const db = openSqlite(url, { readOnly: true });
  try {
    const hasMeta = db
      .prepare("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(BUNDLE_META_TABLE);
    if (!hasMeta) throw new Error('移行 bundle ではない (tirocinium_bundle_meta が無い)');
    const meta = Object.fromEntries(
      db.prepare(`SELECT key, value FROM "${BUNDLE_META_TABLE}"`).all().map((r) => [r.key, r.value]),
    );
    if (meta.service !== BUNDLE_SERVICE) throw new Error('bundle の所有サービスが tirocinium ではない');
    if (meta.format !== BUNDLE_FORMAT || meta.version !== BUNDLE_VERSION) {
      throw new Error(`対応していない bundle の形式 (${meta.format ?? '?'} v${meta.version ?? '?'})`);
    }
    return db;
  } catch (e) {
    db.close();
    throw e;
  }
}
