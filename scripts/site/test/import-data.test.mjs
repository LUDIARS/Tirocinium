// import-data.mjs / pack-legacy-sqlite.mjs の結合テスト。
// 一時 Postgres (support/pg-cluster.mjs) と、合成した小さな SQLite (support/schemas.mjs) だけを使う。
// 実データ (data/*.sqlite) は開かない。initdb が見つからない環境では skip する。
//   node --test scripts/site/test/

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { startTestCluster } from './support/pg-cluster.mjs';
import { createLegacyCompaniesSqlite, createLegacyMainSqlite, migratePostgres } from './support/schemas.mjs';
import { openSqlite } from '../legacy-sqlite/sqlite.mjs';

const SITE = resolve(fileURLToPath(import.meta.url), '../..');
const REPO = resolve(SITE, '../..');
const U1 = '11111111-1111-4111-8111-111111111111';
const S1 = '22222222-2222-4222-8222-222222222222';
const C1 = '33333333-3333-4333-8333-333333333333';
const C2 = '44444444-4444-4444-8444-444444444444'; // companies.sqlite にだけある企業
const C3 = '55555555-5555-4555-8555-555555555555'; // companies.sqlite 側の、C1 と同じ normalized_name の企業

const cluster = await startTestCluster();
const skip = cluster ? false : 'initdb が見つからない (TR_PG_BIN で指定する)';
let admin;
let work;
let dbCount = 0;

before(async () => {
  if (!cluster) return;
  admin = postgres(cluster.baseUrl('postgres'), { max: 1, onnotice: () => {} });
  work = mkdtempSync(join(tmpdir(), 'trimp-'));
});

after(async () => {
  if (!cluster) return;
  await admin.end();
  cluster.stop();
  rmSync(work, { recursive: true, force: true });
});

/** 合成の 2 つの SQLite を作り、mutate で手を加えてから bundle にする。{ bundle, sha256 } */
function makeBundle(name, mutate = () => {}) {
  const mainPath = join(work, `${name}-main.sqlite`);
  const companiesPath = join(work, `${name}-companies.sqlite`);
  const main = createLegacyMainSqlite(mainPath);
  const companies = createLegacyCompaniesSqlite(companiesPath);
  main.exec(`
    INSERT INTO users (id, first_seen) VALUES ('${U1}', '2026-06-14 13:58:00');
    INSERT INTO sessions (id, user_id, mode, started_at, status, llm_profile, metadata)
      VALUES ('${S1}', '${U1}', 'local', '2026-06-14T14:00:00.123Z', 'ended', '{"a":1}', '{}');
    INSERT INTO evaluations (session_id, turn_range, scored_at, axes, hints, model, method)
      VALUES ('${S1}', '[1,3]', '2026-06-14 14:05:00', '{"logic":3}', '["h"]', 'm', 'llm');
    INSERT INTO evaluations (session_id, turn_range, scored_at, axes, hints, model, method)
      VALUES ('${S1}', '[4,6]', '2026-06-14 14:10:00', '{"logic":4}', '[]', 'm', 'llm');
    INSERT INTO companies (id, name, normalized_name, roles, tags, is_game, crawled_at, updated_at)
      VALUES ('${C1}', 'Alpha', 'alpha', '["プランナー","エンジニア \\"x\\""]', '[]', 1, '2026-06-01 00:00:00', '2026-06-02 00:00:00');
    INSERT INTO weakness_profiles (user_id, axes_ema, axes_variance, weak_top3, hint_history, session_count, updated_at)
      VALUES ('${U1}', '{}', '{}', '["logic","depth"]', '[]', 2, '2026-06-14 14:20:00');
  `);
  companies.exec(`
    INSERT INTO companies (id, name, normalized_name, roles, is_newgrad) VALUES ('${C2}', 'Beta', 'beta', '["x"]', 1);
    INSERT INTO companies (id, name, normalized_name) VALUES ('${C3}', 'Alpha old', 'alpha');
    INSERT INTO company_profiles (company_id, philosophy, "values") VALUES ('${C2}', 'p', '["v"]');
    INSERT INTO company_profiles (company_id, philosophy) VALUES ('${C3}', 'old');
  `);
  mutate({ main, companies });
  main.close();
  companies.close();
  const bundle = join(work, `${name}.bundle.sqlite`);
  const out = execFileSync(process.execPath, [join(SITE, 'pack-legacy-sqlite.mjs'), '--output', bundle, '--main', mainPath, '--companies', companiesPath], { cwd: REPO, encoding: 'utf8' });
  const sha256 = /sha256: ([0-9a-f]{64})/.exec(out)[1];
  return { bundle, sha256 };
}

async function freshDatabase() {
  const url = await cluster.createDatabase(admin, `tr_import_${++dbCount}`);
  const sql = postgres(url, { max: 1, onnotice: () => {} });
  await migratePostgres(sql);
  return { url, sql };
}

function runImport(url, args) {
  const r = spawnSync(process.execPath, [join(SITE, 'import-data.mjs'), ...args], {
    cwd: REPO,
    encoding: 'utf8',
    env: { ...process.env, DATABASE_URL: url },
  });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
}

describe('import-data', { skip }, () => {
  test('dry-run は件数だけを出し、何も書かない', async () => {
    const { bundle, sha256 } = makeBundle('dry');
    const { url, sql } = await freshDatabase();
    const r = runImport(url, ['--input', bundle, '--sha256', sha256, '--dry-run']);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /evaluations → evaluations: 元 2 行 \/ 投入 2 行/);
    assert.match(r.out, /legacy_companies__companies → companies: 元 2 行 \/ 投入 1 行/);
    assert.match(r.out, /除外 1 行: 同じ企業/);
    assert.match(r.out, /移さない表 _tirocinium_migrations/);
    assert.doesNotMatch(r.out, /プランナー|Alpha|postgres:\/\//); // 値と接続文字列は出さない
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM users`;
    assert.equal(n, 0);
    await sql.end();
  });

  test('空の DB に 1 トランザクションで入れ、型を変換し sequence を合わせる', async () => {
    const { bundle, sha256 } = makeBundle('ok');
    const { url, sql } = await freshDatabase();
    const r = runImport(url, ['--input', bundle, '--sha256', sha256]);
    assert.equal(r.code, 0, r.out);

    const [u] = await sql`SELECT first_seen FROM users WHERE id = ${U1}`;
    assert.equal(u.first_seen.toISOString(), '2026-06-14T13:58:00.000Z'); // 時差なし = UTC
    const [s] = await sql`SELECT started_at, llm_profile FROM sessions WHERE id = ${S1}`;
    assert.equal(s.started_at.toISOString(), '2026-06-14T14:00:00.123Z');
    assert.deepEqual(s.llm_profile, { a: 1 });
    const evs = await sql`SELECT id, turn_range::text AS r, hints FROM evaluations ORDER BY id`;
    assert.deepEqual(evs.map((e) => [Number(e.id), e.r, e.hints]), [[1, '[1,4)', ['h']], [2, '[4,7)', []]]);
    const [c] = await sql`SELECT roles, is_game, is_newgrad FROM companies WHERE id = ${C1}`;
    assert.deepEqual(c.roles, ['プランナー', 'エンジニア "x"']);
    assert.equal(c.is_game, true);
    assert.equal(c.is_newgrad, false);
    const [w] = await sql`SELECT weak_top3 FROM weakness_profiles`;
    assert.deepEqual(w.weak_top3, ['logic', 'depth']);

    // companies.sqlite: 重ならない企業 (Beta) とその profile だけが足される。
    const names = (await sql`SELECT normalized_name FROM companies ORDER BY 1`).map((x) => x.normalized_name);
    assert.deepEqual(names, ['alpha', 'beta']);
    const profiles = (await sql`SELECT company_id::text AS id FROM company_profiles`).map((x) => x.id);
    assert.deepEqual(profiles, [C2]);

    // serial の sequence は入れた最大値の次から。
    const [next] = await sql`INSERT INTO evaluations (session_id, turn_range, axes, hints, model, method)
      VALUES (${S1}, '[7,9]', '{}', '[]', 'm', 'llm') RETURNING id`;
    assert.equal(Number(next.id), 3);
    await sql.end();
  });

  test('空でない DB には入れない', async () => {
    const { bundle, sha256 } = makeBundle('nonempty');
    const { url, sql } = await freshDatabase();
    await sql`INSERT INTO users (id) VALUES (${U1})`;
    const r = runImport(url, ['--input', bundle, '--sha256', sha256]);
    assert.equal(r.code, 1);
    assert.match(r.out, /移し先の DB が空ではない/);
    assert.match(r.out, /行のある表: users/);
    await sql.end();
  });

  test('変換できない行があれば、行と列と理由を出して何も書かない', async () => {
    const { bundle, sha256 } = makeBundle('invalid', ({ main }) => {
      main.exec(`UPDATE companies SET is_game = 2;
        INSERT INTO users (id, first_seen) VALUES ('not-a-uuid', 'yesterday');`);
    });
    const { url, sql } = await freshDatabase();
    for (const extra of [['--dry-run'], []]) {
      const r = runImport(url, ['--input', bundle, '--sha256', sha256, ...extra]);
      assert.equal(r.code, 1, r.out);
      assert.match(r.out, /companies rowid=1 is_game: 真偽 \(0\/1\) ではない/);
      assert.match(r.out, /users rowid=2 id: UUID の形ではない/);
      assert.match(r.out, /users rowid=2 first_seen: 日時の形ではない/);
      assert.doesNotMatch(r.out, /not-a-uuid|yesterday/);
    }
    const [{ n }] = await sql`SELECT count(*)::int AS n FROM companies`;
    assert.equal(n, 0);
    await sql.end();
  });

  test('投入の途中で失敗したら何も残らない (1 トランザクション)', async () => {
    const orphan = '66666666-6666-4666-8666-666666666666';
    const { bundle, sha256 } = makeBundle('rollback', ({ main }) => {
      // 変換はできるが、親の sessions が無いので外部キーで失敗する行 (users・companies などは先に入る)。
      main.exec(`PRAGMA foreign_keys = OFF; INSERT INTO evaluations (session_id, turn_range, scored_at, axes, hints, model, method)
        VALUES ('${orphan}', '[1,2]', '2026-06-14 14:05:00', '{}', '[]', 'm', 'llm')`);
    });
    const { url, sql } = await freshDatabase();
    const r = runImport(url, ['--input', bundle, '--sha256', sha256]);
    assert.equal(r.code, 1, r.out);
    for (const table of ['users', 'sessions', 'companies', 'evaluations']) {
      const [{ n }] = await sql.unsafe(`SELECT count(*)::int AS n FROM ${table}`);
      assert.equal(n, 0, table);
    }
    await sql.end();
  });

  test('対応の無い表・列は一覧にして止める', async () => {
    const { bundle, sha256 } = makeBundle('unmapped', ({ main }) => {
      main.exec('CREATE TABLE mystery (x TEXT); ALTER TABLE users ADD COLUMN nickname TEXT;');
    });
    const { url, sql } = await freshDatabase();
    const r = runImport(url, ['--input', bundle, '--sha256', sha256, '--dry-run']);
    assert.equal(r.code, 1);
    assert.match(r.out, /表 mystery: 対応が無い/);
    assert.match(r.out, /列 users\.nickname: Postgres の users に同じ名前の列が無い/);
    await sql.end();
  });

  test('ハッシュ・形式・パスの確認', async () => {
    const { bundle, sha256 } = makeBundle('hash');
    const { url, sql } = await freshDatabase();
    let r = runImport(url, ['--input', bundle, '--sha256', '0'.repeat(64)]);
    assert.match(r.out, /--sha256 が入力ファイルと一致しない/);
    r = runImport(url, ['--input', 'relative.sqlite', '--sha256', sha256]);
    assert.match(r.out, /絶対パス/);
    const plain = join(work, 'plain.sqlite');
    const db = openSqlite(plain);
    db.exec('CREATE TABLE users (id TEXT)');
    db.close();
    const { sha256File } = await import('../legacy-sqlite/bundle.mjs');
    r = runImport(url, ['--input', plain, '--sha256', await sha256File(plain)]);
    assert.match(r.out, /移行 bundle ではない/);
    r = runImport('', ['--input', bundle, '--sha256', sha256]);
    assert.match(r.out, /DATABASE_URL/);
    await sql.end();
  });

  test('migration の当たっていない DB は止める', async () => {
    const { bundle, sha256 } = makeBundle('nomigrate');
    const url = await cluster.createDatabase(admin, `tr_import_${++dbCount}`);
    const r = runImport(url, ['--input', bundle, '--sha256', sha256, '--dry-run']);
    assert.equal(r.code, 1);
    assert.match(r.out, /tirocinium-migrate/);
  });
});
