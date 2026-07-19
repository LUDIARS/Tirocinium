// 一般解 QA シード (data/general/qa-seed/<stage>/<role>.json) の読込。
// 供給源優先順の最下位 (spec/feature/inference/interviewer-reproduction.md §4)。
// role ファイルが無い場合は同 stage の存在ファイルへ「明示的に」退避する
// (無言フォールバック禁止 — 退避した事実を結果に含め、ブリーフ source_meta に記録する)。

import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AXIS_KEYS, type AxisKey, type QuestionCandidate } from '@tirocinium/llm';

// __dirname = apps/server/src/brief → プロジェクトルートは 4 階層上 (db/index.ts と同規約)
const _dir = dirname(fileURLToPath(import.meta.url));
const QA_SEED_DIR = resolve(_dir, '../../../..', 'data', 'general', 'qa-seed');

type QaSeedFile = {
  stage: string;
  role: string;
  items: {
    theme?: string;
    question?: string;
    followups?: string[];
    axes?: string[];
  }[];
};

export type QaSeedResult = {
  items: QuestionCandidate[];
  /** 要求 role のファイルが無く別 role へ退避した場合、その実ファイルの role 名 */
  fallbackRole: string | null;
};

function toAxes(raw: string[] | undefined): AxisKey[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((a): a is AxisKey => (AXIS_KEYS as string[]).includes(a));
}

async function readSeedFile(path: string): Promise<QuestionCandidate[]> {
  const parsed = JSON.parse(await readFile(path, 'utf8')) as QaSeedFile;
  if (!Array.isArray(parsed.items)) return [];
  return parsed.items
    .filter((i) => typeof i.question === 'string' && i.question.trim().length > 0)
    .map((i) => ({
      theme: i.theme?.trim() || '一般質問',
      question: i.question!.trim(),
      followups: Array.isArray(i.followups) ? i.followups.filter((f) => typeof f === 'string') : [],
      axes: toAxes(i.axes),
      origin: 'seed' as const,
    }));
}

/**
 * stage/role の QA シードを読む。
 * - `<stage>/<role>.json` があればそれを使う (fallbackRole = null)
 * - 無ければ同 stage の先頭ファイル (ソート順 = 決定的) へ退避し fallbackRole に記録
 * - stage ディレクトリ自体が無ければ空 (呼び出し側が充足ゲートで扱う)
 */
export async function loadQaSeed(stage: string, role: string): Promise<QaSeedResult> {
  const stageDir = join(QA_SEED_DIR, stage);
  let files: string[];
  try {
    files = (await readdir(stageDir)).filter((f) => f.endsWith('.json')).sort();
  } catch (err) {
    // stage ディレクトリが無い (ENOENT) は「一般解シードなし」として静かに縮退する想定内。
    // 権限エラー等の他 I/O 障害まで握り潰すと、設定不備 (マウント/権限) が
    // 「シードが単に無い」ように見えてしまうため、ENOENT 以外は明示的にエラーとして扱う。
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    return { items: [], fallbackRole: null };
  }
  if (files.length === 0) return { items: [], fallbackRole: null };

  const wanted = `${role}.json`;
  const target = files.includes(wanted) ? wanted : files[0]!;
  const items = await readSeedFile(join(stageDir, target));
  return {
    items,
    fallbackRole: target === wanted ? null : target.replace(/\.json$/, ''),
  };
}
