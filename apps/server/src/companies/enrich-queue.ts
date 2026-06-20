// 自動 enrich キュー: 概要なしのゲーム関連企業を 1 分 1 件で順次クロールする常駐処理。
// DB を待ち行列とみなし、 毎 tick で「最も試行が古い 1 社」を選んで enrich する (overlap 防止)。
// LLM (api backend + key) が無い環境では起動しない。 spec/feature/companies/gbizinfo.md / README §3。

import { config } from '../config.js';
import { runEnrichment } from './enrich.js';
import { nextCompanyForAutoEnrich, markEnrichAttempted, autoEnrichStats } from './repo.js';

export type EnrichQueueStatus = {
  enabled: boolean;
  running: boolean;
  intervalMs: number;
  /** 起動できない理由 (LLM 未設定など)。 起動中は空。 */
  disabledReason: string;
  processed: number;
  enrichedOk: number;
  lastCompany: string;
  lastDetail: string;
  pending: number;
  attempted: number;
};

let timer: NodeJS.Timeout | null = null;
let ticking = false; // tick の多重実行防止
const state = { processed: 0, enrichedOk: 0, lastCompany: '', lastDetail: '' };

/** LLM が使えるか (enrich は api backend + ANTHROPIC_API_KEY 必須)。 */
function llmReason(): string {
  if (config.llmBackend !== 'api') return 'LLM backend が api ではありません (自動 enrich は LLM 抽出が必須)';
  if (!process.env['ANTHROPIC_API_KEY']) return 'ANTHROPIC_API_KEY が未設定です';
  return '';
}

async function tick(): Promise<void> {
  if (ticking) return;
  ticking = true;
  try {
    const company = await nextCompanyForAutoEnrich();
    if (!company) {
      state.lastDetail = '対象なし (概要なしのゲーム関連企業が残っていません)';
      return;
    }
    // 先に試行印を付ける (失敗しても次の社へ進めるように)。
    await markEnrichAttempted(company.id);
    state.processed++;
    state.lastCompany = company.name;
    try {
      const summary = await runEnrichment({ companyId: company.id });
      const ok = summary.enriched > 0;
      if (ok) state.enrichedOk++;
      state.lastDetail = ok
        ? `${company.name}: 概要/IR を取得`
        : `${company.name}: 取得できる情報なし (要 情報提供)`;
    } catch (err) {
      state.lastDetail = `${company.name}: enrich 失敗 — ${(err as Error).message}`;
    }
    console.log(`[enrich-queue] ${state.lastDetail}`);
  } catch (err) {
    console.warn('[enrich-queue] tick error:', (err as Error).message);
  } finally {
    ticking = false;
  }
}

/** キューを起動する (LLM 未設定なら no-op)。 サーバ boot から呼ぶ。 */
export function startEnrichQueue(): void {
  if (timer) return;
  if (!config.enrichQueue.enabled) return;
  const reason = llmReason();
  if (reason) {
    console.log(`[enrich-queue] 起動しません: ${reason}`);
    return;
  }
  console.log(`[enrich-queue] 起動 (${config.enrichQueue.intervalMs}ms 間隔で 1 件ずつ)`);
  // 初回は interval 後 (boot 直後の負荷集中を避ける)。
  timer = setInterval(() => void tick(), config.enrichQueue.intervalMs);
  if (typeof timer.unref === 'function') timer.unref(); // プロセス終了を妨げない
}

export function stopEnrichQueue(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}

export async function enrichQueueStatus(): Promise<EnrichQueueStatus> {
  const stats = await autoEnrichStats();
  const reason = config.enrichQueue.enabled ? llmReason() : 'キューは無効化されています';
  return {
    enabled: config.enrichQueue.enabled,
    running: timer !== null,
    intervalMs: config.enrichQueue.intervalMs,
    disabledReason: timer ? '' : reason,
    processed: state.processed,
    enrichedOk: state.enrichedOk,
    lastCompany: state.lastCompany,
    lastDetail: state.lastDetail,
    pending: stats.pending,
    attempted: stats.attempted,
  };
}
