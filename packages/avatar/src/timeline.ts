// 会話の時間軸: 発話を順に並べ、話者交代の間 (考える間・受け止める間) を入れる。
import { hash01 } from './noise.js';
import { looksLikeQuestion, speechTimingFromQuery, type VoicevoxQuery } from './visemes.js';
import { CANDIDATE, type Utterance } from './types.js';

export type SpokenTurn = { speakerId: string; text: string; query: VoicevoxQuery };

/** 前の話者と次の話者から、間の長さを決める。受験者は考えてから答える。 */
function gapBefore(prev: SpokenTurn | undefined, next: SpokenTurn, i: number, seed: number): number {
  if (!prev) return 0.8;
  const r = hash01(seed, i, 51);
  if (next.speakerId === CANDIDATE) return 0.9 + r * 0.9;
  if (prev.speakerId === CANDIDATE) return 0.6 + r * 0.6;
  return 0.35 + r * 0.3; // 面接官どうしの引き継ぎ
}

export function buildUtterances(turns: SpokenTurn[], seed: number): { utterances: Utterance[]; duration: number } {
  const utterances: Utterance[] = [];
  let t = 0;
  turns.forEach((turn, i) => {
    t += gapBefore(turns[i - 1], turn, i, seed);
    const timing = speechTimingFromQuery(turn.query, t);
    utterances.push({
      speakerId: turn.speakerId,
      start: t,
      end: t + timing.duration,
      text: turn.text,
      visemes: timing.visemes,
      phraseEnds: timing.phraseEnds,
      question: timing.question || looksLikeQuestion(turn.text),
    });
    t += timing.duration;
  });
  return { utterances, duration: t + 1.5 };
}
