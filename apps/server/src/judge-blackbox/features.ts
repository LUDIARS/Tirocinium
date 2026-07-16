// judge 判定の決定的特徴量 (spec/feature/inference/interviewer-reproduction.md §7.1)。
// 「回答長 < N かつ具体名詞ゼロ → synthesis 不成立」級の規則が書ける粒度で、
// Q&A テキストから FeatureMap をフラットに切り出す。すべて決定的 (LLM 不使用)。

import type { FeatureMap } from '@ludiars/blackbox';

/** 2 文字以上の素朴トークン (role-aliases の splitKeywords と同じ思想の依存ゼロ分解)。 */
function tokens(text: string): string[] {
  return text
    .split(/[\s、。,.!?！?・()（）「」\[\]【】\n]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
}

export function judgeFeatures(question: string, answer: string): FeatureMap {
  const qTokens = tokens(question);
  const aTokens = tokens(answer);
  const aSet = new Set(aTokens);
  const shared = qTokens.filter((t) => aSet.has(t)).length;
  const overlap = qTokens.length > 0 ? shared / qTokens.length : 0;
  return {
    answer_len: answer.length,
    answer_tokens: aTokens.length,
    answer_sentences: answer.split(/[。！？!?\n]+/).filter((s) => s.trim().length > 0).length,
    has_digits: /\d/.test(answer),
    // 具体化マーカー: 例示・体験・数値根拠を示す言い回し
    has_concrete_marker: /(例えば|たとえば|具体的に|実際に|担当した|作った|実装した)/.test(answer),
    question_len: question.length,
    // 質問語彙との重なり (0-1、2 桁丸めで canonical に保つ)
    overlap_ratio: Math.round(overlap * 100) / 100,
  };
}
