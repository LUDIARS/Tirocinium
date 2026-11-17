// 表ごとの対応 (SQLite の表 → Postgres の表) と、移さない表の理由をここに明示する。
// 列は同じ名前の列へ移し、値の変換は Postgres 側の列の型で決める (convert.mjs)。
// 一覧に無い表・Postgres に無い列・変換できない型は「対応が無い」として計画の段階で止める (黙って捨てない)。

import { COMPANIES_PREFIX } from './bundle.mjs';
import { isSupportedType } from './convert.mjs';

/** data/tirocinium.sqlite の表で、同名の Postgres の表へそのまま移すもの。 */
export const MAIN_TABLES = Object.freeze([
  'analytics_events',
  'backdoor_alumni',
  'companies',
  'company_game',
  'company_interview_articles',
  'company_interview_questions',
  'company_newgrad_images',
  'company_newgrad_role_images',
  'company_ob_placement',
  'company_partner',
  'company_profiles',
  'company_recommendations',
  'company_tech',
  'crawl_jobs',
  'es_discord_deliveries',
  'es_discord_routes',
  'evaluations',
  'examinee_personas',
  'ft_loop_runs',
  'games',
  'geocode_cache',
  'human_feedback',
  'interview_briefs',
  'interview_summaries',
  'interviewer_personas',
  'job_news_daily_runs',
  'job_news_webhook_deliveries',
  'job_postings',
  'link_cache',
  'ob_es_requests',
  'ob_job_postings',
  'ob_question_patterns',
  'reservation_slots',
  'reservations',
  'session_turns',
  'sessions',
  'tech',
  'training_data_refs',
  'users',
  'weakness_profiles',
]);

/** 移さない表と理由。行があれば件数を報告に出す (中身は出さない)。 */
export const SKIPPED_TABLES = Object.freeze({
  _tirocinium_migrations: 'migration の適用記録。Postgres 側は tirocinium-migrate が自分の記録を持つ',
  backdoor_tokens: '廃止したマジックリンクの揮発トークン (migration 021)。秘密なので複製しない',
});

/**
 * data/companies.sqlite (旧 seed の DB) の表。bundle では COMPANIES_PREFIX を付けて入っている。
 * 同じ企業が tirocinium.sqlite にもあるので、normalized_name か id が tirocinium.sqlite 側と重なる企業は
 * tirocinium.sqlite 側を採り、こちらは足さない (件数は報告に出す)。company_profiles は足した企業の分だけ移す。
 */
export const COMPANIES_TABLES = Object.freeze({
  companies: { target: 'companies' },
  company_profiles: { target: 'company_profiles', parent: 'companies', parentKey: 'company_id' },
});

/**
 * bundle と Postgres のスキーマから、移す表ごとの計画を作る。
 * sourceSchema: { tables: { name: string[] (列) }, rowCounts: { name: number } }
 * targetSchema: { name: { columns: { col: { udtName, nullable, hasDefault } } } }
 * 戻り値: { entries: [{ source, target, origin, columns: [{ name, udtName, nullable }] }], skipped, problems }
 */
export function buildPlan(sourceSchema, targetSchema) {
  const problems = [];
  const entries = [];
  const skipped = [];
  const known = new Set();

  const addEntry = (source, target, origin) => {
    known.add(source);
    const targetTable = targetSchema[target];
    if (!targetTable) {
      problems.push(`表 ${source}: 移し先の Postgres の表 ${target} が無い (tirocinium-migrate を先に流す)`);
      return;
    }
    const sourceColumns = sourceSchema.tables[source];
    if (!sourceColumns) return; // bundle に無い表 (古い DB に無い migration の表) は 0 行として扱う
    const columns = [];
    for (const name of sourceColumns) {
      const col = targetTable.columns[name];
      if (!col) {
        problems.push(`列 ${source}.${name}: Postgres の ${target} に同じ名前の列が無い`);
        continue;
      }
      if (!isSupportedType(col.udtName)) {
        problems.push(`列 ${source}.${name}: Postgres の型 ${col.udtName} への変換を持たない`);
        continue;
      }
      columns.push({ name, udtName: col.udtName, nullable: col.nullable, identity: col.identity });
    }
    for (const [name, col] of Object.entries(targetTable.columns)) {
      if (!sourceColumns.includes(name) && !col.nullable && !col.hasDefault) {
        problems.push(`列 ${target}.${name}: NULL 不可で既定値も無いが、${source} に対応する列が無い`);
      }
    }
    entries.push({ source, target, origin, columns });
  };

  for (const table of MAIN_TABLES) addEntry(table, table, 'main');
  for (const [name, spec] of Object.entries(COMPANIES_TABLES)) {
    addEntry(COMPANIES_PREFIX + name, spec.target, 'companies');
  }
  for (const [table, reason] of Object.entries(SKIPPED_TABLES)) {
    known.add(table);
    if (sourceSchema.tables[table]) skipped.push({ table, reason, rows: sourceSchema.rowCounts[table] ?? 0 });
  }
  for (const table of Object.keys(sourceSchema.tables)) {
    if (known.has(table)) continue;
    if (table.startsWith('tirocinium_bundle_')) continue; // bundle 自身の情報
    problems.push(`表 ${table}: 対応が無い (table-plan.mjs に移し先も、移さない理由も書かれていない)`);
  }
  return { entries, skipped, problems };
}
