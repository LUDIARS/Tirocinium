import type Anthropic from '@anthropic-ai/sdk';
import { MODEL } from './anthropic.js';
import type { ExamineePersonaInput, InterviewerPersonaInput, Turn } from './types.js';

const STAGE_LABEL: Record<string, string> = {
  hr: '人事 (1次)',
  'peer-tech': '技術者面接 (現場 peer)',
  'lead-tech': '2 次技術者面接 (部長 / テックリード)',
  final: '最終面接 (社長 / 役員 / CTO)',
};

const PRESSURE_LABEL: Record<number, string> = {
  1: '穏やか、 相槌多め',
  2: '優しめ、 軽い深掘り',
  3: '中立、 反応控えめ',
  4: '押し強め、 矛盾を突く',
  5: '厳しい、 反論や沈黙圧を多用',
};

const STATIC_ROOT = `
あなたは LUDIARS Tirocinium 内の面接 AI です。
役柄に従って受験者に質問を投げ、 引き出す情報を増やす役回りを担当します。

ルール:
- 1 回の応答は 30-200 字を目安
- 結論先出し / 因果先出しを意識する
- 候補者を萎縮させる言葉は使わない (圧の強さで挑むが、 人格否定はしない)
- 質問を 1 turn に 1 つだけ
- 候補者の答えが薄かったら、 1 段深掘りする
`.trim();

export function buildInterviewerPromptBlock(p: InterviewerPersonaInput): string {
  const lens = p.role_lens && p.role_lens !== 'any' ? ` (${p.role_lens} 志望者向け)` : '';
  const tics = p.tics.length ? `\n- 口癖: ${p.tics.map((t) => `"${t}"`).join(', ')}` : '';
  return [
    `あなたは ${p.display_name} という面接官です。`,
    `所属: ${p.bio}`,
    `担当: ${STAGE_LABEL[p.stage] ?? p.stage}${lens}`,
    `性格傾向: ${p.temperament}`,
    `圧の強さ: ${p.pressure}/5 (${PRESSURE_LABEL[p.pressure] ?? ''})${tics}`,
    `評価バイアス: ${JSON.stringify(p.evaluation_bias)} (重み 1.0 を超える軸を念入りに探る)`,
  ].join('\n');
}

export function buildWeaknessBlock(weakTop3: string[]): string {
  if (!weakTop3.length) return '';
  return `今回の session では、 以下の軸を特に問うてください: ${weakTop3.join(', ')}`;
}

export function buildSystemPrompt(opts: {
  interviewer: InterviewerPersonaInput;
  weakTop3?: string[];
  ragBlock?: string;
  refineBlock?: string;
}): string {
  return [
    STATIC_ROOT,
    '',
    buildInterviewerPromptBlock(opts.interviewer),
    opts.weakTop3 && opts.weakTop3.length ? '\n' + buildWeaknessBlock(opts.weakTop3) : '',
    opts.ragBlock ? '\n## 参考素材\n' + opts.ragBlock : '',
    opts.refineBlock ? '\n## 次に深掘るべき論点\n' + opts.refineBlock : '',
  ].filter(Boolean).join('\n');
}

export type StreamResponseInput = {
  systemPrompt: string;
  turns: Turn[];
  /** 中断用 */
  signal?: AbortSignal;
};

/** Sonnet で stream 応答。 token (string) を yield する async generator */
export async function* streamResponse(
  client: Anthropic,
  input: StreamResponseInput,
): AsyncGenerator<string, void, unknown> {
  const messages: Anthropic.Messages.MessageParam[] = input.turns
    .filter((t) => t.role === 'interviewer' || t.role === 'user')
    .map((t) => ({
      role: t.role === 'interviewer' ? 'assistant' : 'user',
      content: t.text,
    }));

  const stream = client.messages.stream(
    {
      model: MODEL.RESPONSE,
      max_tokens: 1024,
      system: input.systemPrompt,
      messages,
    },
    { signal: input.signal },
  );

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      yield event.delta.text;
    }
  }
}

/** examinee からの応答も sonnet/haiku で受けたいときの簡易版 (Haiku は別ファイル) */
export function asMessages(turns: Turn[]): Anthropic.Messages.MessageParam[] {
  return turns.map((t) => ({
    role: t.role === 'interviewer' ? 'assistant' : 'user',
    content: t.text,
  }));
}
