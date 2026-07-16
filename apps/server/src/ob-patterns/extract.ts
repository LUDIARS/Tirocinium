// OB コーパス (Memoria RAG 抜粋) → 質問パターン抽出 (spec §6.2)。
// 質問の「型」だけを抽出し、回答本文・個人特定情報は出力に含めない。
// LLM 出力は coerce 流に型検証する: 構造違反は throw、値は clamp / 濾過。
// LLM 実体は注入 (runLlm) — バッチは claude CLI (EXTRACTOR 相当は haiku)、テストは mock。

import { AXIS_KEYS, type AxisKey } from '@tirocinium/llm';

export type ExtractedPattern = {
  theme: string;
  question_pattern: string;
  followup_patterns: string[];
  axes: AxisKey[];
};

const MAX_PATTERNS = 8;
const MAX_FOLLOWUPS = 3;

const EXTRACT_INSTRUCTION = `
あなたは面接データの整理係です。以下は、ある企業の面接を受けた OB の
「過去の面接受け答え」の抜粋です。ここから **面接官が聞いた質問のパターン (型)** だけを
抽出して JSON 配列のみで返してください。

厳守:
- 出力に **回答の本文・氏名・固有の個人情報を一切含めない** (質問の型だけ)
- 質問は一般化する (「あなたの卒業制作の X について」→「代表作の技術選定の根拠」)
- 1 要素 = 1 質問パターン。最大 ${MAX_PATTERNS} 件
- axes は次の 6 値のみ: ${AXIS_KEYS.join(', ')}

出力形式 (JSON のみ、前置き禁止):
[
  {
    "theme": "<質問テーマ (10 字程度)>",
    "question_pattern": "<一般化した質問文>",
    "followup_patterns": ["<深掘りの型 (最大 ${MAX_FOLLOWUPS})>"],
    "axes": ["<この質問が測る軸>"]
  }
]
`.trim();

export function buildExtractionPrompt(opts: {
  companyName: string;
  stage: string;
  role: string;
  excerpts: string[];
}): string {
  return [
    EXTRACT_INSTRUCTION,
    '',
    `対象企業: ${opts.companyName} / ステージ: ${opts.stage || '不明'} / 職種: ${opts.role}`,
    '',
    '## OB 受け答えの抜粋',
    ...opts.excerpts.map((e, i) => `--- 抜粋 ${i + 1} ---\n${e}`),
  ].join('\n');
}

/** LLM 出力から JSON payload を取り出す。evaluator の extractJsonBlock は
 *  object (`{...}`) 専用でトップレベル配列を壊すため、配列対応版をここに持つ。 */
function extractJsonPayload(text: string): string {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence?.[1]) return fence[1].trim();
  const aStart = text.indexOf('[');
  const aEnd = text.lastIndexOf(']');
  if (aStart !== -1 && aEnd > aStart) return text.slice(aStart, aEnd + 1);
  const oStart = text.indexOf('{');
  const oEnd = text.lastIndexOf('}');
  if (oStart !== -1 && oEnd > oStart) return text.slice(oStart, oEnd + 1);
  throw new Error('[ob-extract] LLM 出力に JSON が見つからない');
}

/** LLM 出力 → ExtractedPattern[]。配列でない・要素が object でない場合は throw。 */
export function parseExtractedPatterns(text: string): ExtractedPattern[] {
  const raw = JSON.parse(extractJsonPayload(text)) as unknown;
  const arr = Array.isArray(raw) ? raw : (raw as { patterns?: unknown })?.patterns;
  if (!Array.isArray(arr)) {
    throw new Error('[ob-extract] 出力が JSON 配列でない');
  }
  const out: ExtractedPattern[] = [];
  for (const item of arr.slice(0, MAX_PATTERNS)) {
    if (item == null || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('[ob-extract] 要素が object でない');
    }
    const o = item as Record<string, unknown>;
    const question = typeof o['question_pattern'] === 'string' ? o['question_pattern'].trim() : '';
    if (!question) continue; // 質問の無い要素は捨てる (clamp 側)
    out.push({
      theme: (typeof o['theme'] === 'string' ? o['theme'].trim() : '') || 'OB 質問パターン',
      question_pattern: question,
      followup_patterns: (Array.isArray(o['followup_patterns']) ? o['followup_patterns'] : [])
        .filter((f): f is string => typeof f === 'string' && f.trim().length > 0)
        .map((f) => f.trim())
        .slice(0, MAX_FOLLOWUPS),
      axes: (Array.isArray(o['axes']) ? o['axes'] : []).filter((a): a is AxisKey =>
        (AXIS_KEYS as string[]).includes(a as string),
      ),
    });
  }
  return out;
}

/** 抽出の実行 (parse 失敗は 1 回だけ再呼び出し、それでも失敗なら throw)。 */
export async function extractPatterns(
  runLlm: (prompt: string) => Promise<string>,
  opts: { companyName: string; stage: string; role: string; excerpts: string[] },
): Promise<ExtractedPattern[]> {
  const prompt = buildExtractionPrompt(opts);
  try {
    return parseExtractedPatterns(await runLlm(prompt));
  } catch {
    return parseExtractedPatterns(await runLlm(prompt));
  }
}
