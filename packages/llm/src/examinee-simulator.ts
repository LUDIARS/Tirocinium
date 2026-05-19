import type Anthropic from '@anthropic-ai/sdk';
import { extractText, MODEL } from './anthropic.js';
import { serializeHistory } from './evaluator.js';
import type { ExamineePersonaInput, Turn } from './types.js';

const SPEECH_LABEL: Record<string, string> = {
  formal: '丁寧で慎重、 結論まで時間がかかる',
  casual: '砕けた口調、 思ったまま喋る',
  nervous: '緊張で言葉に詰まる、 沈黙が出やすい',
  verbose: '言葉が多く、 結論より背景説明が先に出る',
};

export function examineeSystemPrompt(p: ExamineePersonaInput): string {
  const weak = Object.entries(p.weakness_axes)
    .map(([k, v]) => `${k}: ${v}`)
    .join(', ');
  return [
    `あなたは ${p.display_name} という面接候補者を演じます。`,
    `背景: ${p.background}`,
    `志望: ${p.target_role}`,
    `話し方: ${SPEECH_LABEL[p.speech_style] ?? p.speech_style}`,
    p.strengths.length ? `得意分野: ${p.strengths.join(', ')}` : '',
    weak ? `意図的な弱い軸 (0-5、 大きいほど弱い): ${weak}` : '',
    p.intentional_flaws.length ? `顕在化する癖:\n- ${p.intentional_flaws.join('\n- ')}` : '',
    '',
    'ルール:',
    '- 質問に答える時、 弱い軸では「結論先出しが弱い」 「具体例が薄い」 等の癖を再現',
    '- 強い分野では明瞭に答えてよい',
    '- 経歴・経験は背景の範囲内で創作。 ハルシネーション禁止',
    '- 1 回の応答は 50-200 字を目安',
  ]
    .filter(Boolean)
    .join('\n');
}

export type SimulatorInput = {
  persona: ExamineePersonaInput;
  question: string;
  history: Turn[];
};

export async function respondAsExaminee(
  client: Anthropic,
  input: SimulatorInput,
): Promise<string> {
  const res = await client.messages.create({
    model: MODEL.EXAMINEE,
    max_tokens: 512,
    system: examineeSystemPrompt(input.persona),
    messages: [
      {
        role: 'user',
        content: [
          '## これまでの面接',
          serializeHistory(input.history),
          '',
          `## 面接官の最新質問`,
          input.question,
          '',
          '上記の質問に、 ペルソナの癖を反映した形で答えてください。',
        ].join('\n'),
      },
    ],
  });
  return extractText(res.content).trim();
}
