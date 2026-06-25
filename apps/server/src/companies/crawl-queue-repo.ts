// 企業クロールキュー (crawl_jobs) の永続化。 migration 022。
// URL を投入 (enqueue) → worker が status を queued→running→done/failed と進める。
// Web 取得は直列 (重複リクエストの無駄処理回避 + 負荷対策) のため、 同一 URL の active job は 1 件に畳む。
// 公開 URL のみ保持 (個人データ境界 §6 対象外)。

import { sql } from '../db/index.js';

export type CrawlJobStatus = 'queued' | 'running' | 'done' | 'failed';

export type StoredCrawlJob = {
  id: string;
  url: string;
  name_hint: string;
  source: string;
  status: CrawlJobStatus;
  max_pages: number | null;
  attempts: number;
  summary: string;
  error: string;
  requested_by: string;
  enqueued_at: string;
  started_at: string | null;
  finished_at: string | null;
  /** 子クローラ連鎖 (migration 023)。 */
  child_status: string;
  child_log: string;
  child_detail: string;
};

export type EnqueueInput = {
  url: string;
  nameHint?: string;
  source?: string;
  maxPages?: number;
  requestedBy?: string;
};

/** 1 件分のジョブ投入結果。 deduped=true は同一 URL の active job が既にあり再利用したことを示す。 */
export type EnqueueResult = { job: StoredCrawlJob; deduped: boolean };

// 返却列。 module 最上位で sql`...` を即評価すると initSql() 前に DB を触って throw するため、
// クエリ実行時 (initSql 済) に展開されるよう関数で遅延生成する。
const cols = () => sql`
  id, url, name_hint, source, status, max_pages, attempts,
  summary, error, requested_by, enqueued_at, started_at, finished_at,
  child_status, child_log, child_detail
`;

/** queued/running の同一 URL ジョブを 1 件返す (無ければ null)。 enqueue の重複畳み込み用。 */
async function activeJobByUrl(url: string): Promise<StoredCrawlJob | null> {
  const rows = await sql<StoredCrawlJob[]>`
    SELECT ${cols()} FROM crawl_jobs
    WHERE url = ${url} AND status IN ('queued', 'running')
    LIMIT 1
  `;
  return rows[0] ?? null;
}

/**
 * URL を 1 件キューに投入する。 同一 URL の active job が既にあれば新規作成せず再利用する
 * (deduped=true)。 unique index (uq_crawl_jobs_active_url) を最終的な競合防止の砦とする。
 */
export async function enqueueCrawl(input: EnqueueInput): Promise<EnqueueResult> {
  const url = input.url.trim();
  const existing = await activeJobByUrl(url);
  if (existing) return { job: existing, deduped: true };

  try {
    const rows = await sql<StoredCrawlJob[]>`
      INSERT INTO crawl_jobs (url, name_hint, source, max_pages, requested_by)
      VALUES (
        ${url}, ${input.nameHint ?? ''}, ${input.source ?? 'manual'},
        ${input.maxPages ?? null}, ${input.requestedBy ?? ''}
      )
      RETURNING ${cols()}
    `;
    return { job: rows[0]!, deduped: false };
  } catch (err) {
    // unique index 競合 = 並行 enqueue で先に同一 URL が入った。 既存を再利用する。
    const raced = await activeJobByUrl(url);
    if (raced) return { job: raced, deduped: true };
    throw err;
  }
}

/**
 * 次に処理すべき queued ジョブを 1 件取り出して running に進める (原子的に claim)。
 * 無ければ null。 worker の多重実行防止は呼び出し側 (tick) のフラグと併用する。
 */
export async function claimNextCrawlJob(): Promise<StoredCrawlJob | null> {
  return sql.begin(async (tx) => {
    const rows = await tx<StoredCrawlJob[]>`
      SELECT ${cols()} FROM crawl_jobs
      WHERE status = 'queued'
      ORDER BY enqueued_at ASC
      LIMIT 1
    `;
    const job = rows[0];
    if (!job) return null;
    const updated = await tx<StoredCrawlJob[]>`
      UPDATE crawl_jobs
      SET status = 'running', attempts = attempts + 1, started_at = ${nowIso()}, error = ''
      WHERE id = ${job.id}
      RETURNING ${cols()}
    `;
    return updated[0] ?? null;
  });
}

/** ジョブを成功で終了する (summary を JSON 文字列で保存)。 */
export async function markCrawlDone(id: string, summary: unknown): Promise<void> {
  await sql`
    UPDATE crawl_jobs
    SET status = 'done', summary = ${JSON.stringify(summary)}, error = '', finished_at = ${nowIso()}
    WHERE id = ${id}
  `;
}

/**
 * ジョブを失敗扱いにする。 試行が maxAttempts 未満なら queued に戻して再試行、
 * 上限に達していれば failed で確定する。
 */
export async function markCrawlFailed(id: string, message: string, maxAttempts: number): Promise<void> {
  await sql`
    UPDATE crawl_jobs
    SET status = CASE WHEN attempts >= ${maxAttempts} THEN 'failed' ELSE 'queued' END,
        error = ${message},
        finished_at = CASE WHEN attempts >= ${maxAttempts} THEN ${nowIso()} ELSE finished_at END
    WHERE id = ${id}
  `;
}

/** 子クローラを spawn したことを記録する (status=spawned + ログパス)。 */
export async function markChildSpawned(id: string, logPath: string): Promise<void> {
  await sql`
    UPDATE crawl_jobs SET child_status = 'spawned', child_log = ${logPath}, child_detail = ''
    WHERE id = ${id}
  `;
}

/** 子クローラの実行状態を更新する (running / done / failed + サマリ 1 行)。 */
export async function markChildResult(
  id: string,
  status: 'running' | 'done' | 'failed',
  detail: string,
): Promise<void> {
  await sql`
    UPDATE crawl_jobs SET child_status = ${status}, child_detail = ${detail.slice(0, 500)}
    WHERE id = ${id}
  `;
}

export type CrawlQueueCounts = {
  queued: number;
  running: number;
  done: number;
  failed: number;
};

/** status 別の件数を返す。 */
export async function crawlQueueCounts(): Promise<CrawlQueueCounts> {
  const rows = await sql<{ status: CrawlJobStatus; n: number }[]>`
    SELECT status, COUNT(*) AS n FROM crawl_jobs GROUP BY status
  `;
  const counts: CrawlQueueCounts = { queued: 0, running: 0, done: 0, failed: 0 };
  for (const r of rows) counts[r.status] = Number(r.n);
  return counts;
}

/** 直近のジョブを新しい順に返す (可視化用)。 */
export async function recentCrawlJobs(limit = 20): Promise<StoredCrawlJob[]> {
  return sql<StoredCrawlJob[]>`
    SELECT ${cols()} FROM crawl_jobs
    ORDER BY enqueued_at DESC
    LIMIT ${limit}
  `;
}

/** ISO 文字列の現在時刻 (PG/SQLite 双方で扱える文字列で渡す)。 */
function nowIso(): string {
  return new Date().toISOString();
}
