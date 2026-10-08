// 専門面接シミュレーション CLI。spec/feature/inference/specialist-interviews.md
//   npx tsx scripts/specialist-sim --scenario designer --out <dir> --work <空の作業フォルダ>
// 結果は <out>/<scenario>.json。受験者・企業・ES はすべて架空 (scenarios.ts)。
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { askClaude } from './claude.js';
import { SCENARIOS } from './scenarios.js';
import { simulate } from './simulate.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const ids = (arg('scenario') ?? Object.keys(SCENARIOS).join(',')).split(',');
  const out = resolve(arg('out') ?? 'data/training/specialist-sim');
  const work = resolve(arg('work') ?? join(tmpdir(), 'tr-specialist-sim'));
  mkdirSync(out, { recursive: true });
  mkdirSync(work, { recursive: true });
  await Promise.all(ids.map(async (id) => {
    const sc = SCENARIOS[id];
    if (!sc) throw new Error(`unknown scenario: ${id} (${Object.keys(SCENARIOS).join(', ')})`);
    const result = await simulate(sc, (p) => askClaude(p, work), (m) => console.log(`[${id}] ${m}`));
    writeFileSync(join(out, `${id}.json`), JSON.stringify(result, null, 2), 'utf8');
    console.log(`[${id}] done → ${join(out, `${id}.json`)}`);
  }));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
