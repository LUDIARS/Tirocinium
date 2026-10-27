// 本社 Consult の面接官役職フォルダからスキル本文を読む。spec/feature/voice/glab-material-interview.md §4。
// スキルの正本は Consult の `_source/roles/interviewer/skills/`。sync で配られた
// `<root>/interviewer/.agents/skills/<name>/SKILL.md` を読む (Tr は正本を持たない)。

import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export const MATERIAL_READER_SKILL = 'interviewer-material-reader';
export const MOCK_INTERVIEW_SKILL = 'interviewer-mock-interview';

export type InterviewerSkills = { reader: string; interviewer: string };

/** SKILL.md 先頭の `---` で囲まれた frontmatter を外す。 */
export function stripFrontmatter(text: string): string {
  const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const match = /^---\n[\s\S]*?\n---\n?/.exec(normalized);
  return (match ? normalized.slice(match[0].length) : normalized).trim();
}

/**
 * 既定は作業ルートの 1 つ上の `Consult` (Excubitor は `<作業ルート>/Tirocinium` を cwd に起動する。
 * Concordia の相談の既定と同じ置き場所)。この PC 固有の絶対パスはリポに書かない。
 */
export function consultRoot(env: NodeJS.ProcessEnv = process.env, cwd: string = process.cwd()): string {
  return (env['TIROCINIUM_CONSULT_ROOT'] ?? '').trim() || resolve(cwd, '..', '..', 'Consult');
}

export function skillPath(root: string, name: string): string {
  return join(root, 'interviewer', '.agents', 'skills', name, 'SKILL.md');
}

/** 2 本とも読めなければ例外 (呼び出し側が 503 consult_skills_unavailable にする)。 */
export async function loadInterviewerSkills(
  root: string = consultRoot(),
  read: (path: string) => Promise<string> = (path) => readFile(path, 'utf8'),
): Promise<InterviewerSkills> {
  const [reader, interviewer] = await Promise.all([
    read(skillPath(root, MATERIAL_READER_SKILL)),
    read(skillPath(root, MOCK_INTERVIEW_SKILL)),
  ]);
  const result = { reader: stripFrontmatter(reader), interviewer: stripFrontmatter(interviewer) };
  if (!result.reader || !result.interviewer) throw new Error('consult_skills_empty');
  return result;
}
