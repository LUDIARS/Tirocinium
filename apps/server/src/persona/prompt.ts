import type { InterviewerPersona, ExamineePersona } from './repo.js';

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

const SPEECH_LABEL: Record<string, string> = {
  formal: '丁寧で慎重、 結論まで時間がかかる',
  casual: '砕けた口調、 思ったまま喋る',
  nervous: '緊張で言葉に詰まる、 沈黙が出やすい',
  verbose: '言葉が多く、 結論より背景説明が先に出る',
};

export function interviewerToSystemPrompt(p: InterviewerPersona): string {
  const lensLine = p.role_lens === 'any' ? '' : ` (${p.role_lens} 志望者向け)`;
  const tics = p.tics.length ? `\n- 口癖: ${p.tics.map((t) => `"${t}"`).join(', ')}` : '';
  return [
    `あなたは ${p.display_name} という面接官です。`,
    `所属背景: ${p.bio}`,
    `担当する面接タイプ: ${STAGE_LABEL[p.stage] ?? p.stage}${lensLine}`,
    `性格傾向: ${p.temperament}`,
    `圧の強さ: ${p.pressure}/5 (${PRESSURE_LABEL[p.pressure] ?? ''})${tics}`,
    `評価バイアス: ${JSON.stringify(p.evaluation_bias)}`,
    `- 重みが高い軸 (>1.0) は念入りに探る。 低い軸 (<1.0) は深掘り頻度を下げる。`,
  ].join('\n');
}

export function examineeToSystemPrompt(p: ExamineePersona): string {
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
  ].filter(Boolean).join('\n');
}
