#!/usr/bin/env tsx
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import matter from 'gray-matter';

// server と同じ規約で .env.local を優先ロード (cwd = apps/server)。
dotenv.config({ path: '.env.local' });
dotenv.config();
import postgres from 'postgres';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..');
const PERSONA_DIR = join(REPO_ROOT, 'data', 'general', 'persona');

const DRY_RUN = process.env['DRY_RUN'] === '1';

type InterviewerFrontmatter = {
  id: string;
  display_name: string;
  stage: 'hr' | 'peer-tech' | 'lead-tech' | 'final';
  role_lens?: string;
  temperament: string;
  pressure: number;
  tics?: string[];
  bio: string;
  evaluation_bias?: Record<string, number>;
};

type ExamineeFrontmatter = {
  id: string;
  display_name: string;
  background: string;
  target_role: string;
  weakness_axes?: Record<string, number>;
  strengths?: string[];
  speech_style: string;
  intentional_flaws?: string[];
  bio: string;
};

async function loadDir<T>(subdir: 'interviewer' | 'examinee'): Promise<T[]> {
  const dir = join(PERSONA_DIR, subdir);
  const files = (await readdir(dir)).filter((f) => f.endsWith('.md') && f !== 'README.md');
  const items: T[] = [];
  for (const file of files) {
    const text = await readFile(join(dir, file), 'utf8');
    const fm = matter(text);
    items.push(fm.data as T);
  }
  return items;
}

async function main() {
  const interviewers = await loadDir<InterviewerFrontmatter>('interviewer');
  const examinees = await loadDir<ExamineeFrontmatter>('examinee');
  console.log(`[seed] parsed interviewers=${interviewers.length} examinees=${examinees.length}`);

  if (DRY_RUN) {
    console.log('[seed] DRY_RUN=1: DB 流し込みをスキップ');
    console.log('[seed] interviewer ids:', interviewers.map((p) => p.id).join(', '));
    console.log('[seed] examinee ids:', examinees.map((p) => p.id).join(', '));
    return;
  }

  const url = process.env['DATABASE_URL'];
  if (!url) throw new Error('DATABASE_URL required');

  const sql = postgres(url, { prepare: false });

  try {
    for (const p of interviewers) {
      await sql`
        INSERT INTO interviewer_personas
          (id, display_name, stage, role_lens, temperament, pressure, tics, bio,
           evaluation_bias, is_seed)
        VALUES (
          ${p.id}, ${p.display_name}, ${p.stage}, ${p.role_lens ?? 'any'},
          ${p.temperament}, ${p.pressure}, ${p.tics ?? []}, ${p.bio},
          ${sql.json(p.evaluation_bias ?? {})}, true
        )
        ON CONFLICT (id) DO UPDATE SET
          display_name = EXCLUDED.display_name,
          stage = EXCLUDED.stage,
          role_lens = EXCLUDED.role_lens,
          temperament = EXCLUDED.temperament,
          pressure = EXCLUDED.pressure,
          tics = EXCLUDED.tics,
          bio = EXCLUDED.bio,
          evaluation_bias = EXCLUDED.evaluation_bias
      `;
    }
    console.log(`[seed] interviewers upserted (${interviewers.length})`);

    for (const p of examinees) {
      await sql`
        INSERT INTO examinee_personas
          (id, display_name, background, target_role, weakness_axes, strengths,
           speech_style, intentional_flaws, bio, is_seed)
        VALUES (
          ${p.id}, ${p.display_name}, ${p.background}, ${p.target_role},
          ${sql.json(p.weakness_axes ?? {})}, ${p.strengths ?? []},
          ${p.speech_style}, ${p.intentional_flaws ?? []}, ${p.bio}, true
        )
        ON CONFLICT (id) DO UPDATE SET
          display_name = EXCLUDED.display_name,
          background = EXCLUDED.background,
          target_role = EXCLUDED.target_role,
          weakness_axes = EXCLUDED.weakness_axes,
          strengths = EXCLUDED.strengths,
          speech_style = EXCLUDED.speech_style,
          intentional_flaws = EXCLUDED.intentional_flaws,
          bio = EXCLUDED.bio
      `;
    }
    console.log(`[seed] examinees upserted (${examinees.length})`);
  } finally {
    await sql.end();
  }

  console.log('[seed] done');
}

main().catch((err) => {
  console.error('[seed] error:', err);
  process.exit(1);
});
