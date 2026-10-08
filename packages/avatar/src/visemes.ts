// VOICEVOX の audio_query (合成に使った値そのもの) から、口形の時系列と文節の切れ目を作る。
// 合成音声と同じ長さ情報を使うので、口パクが音とずれない。
import type { Viseme, VisemeKey } from './types.js';

export type VoicevoxMora = {
  text: string;
  consonant?: string | null;
  consonant_length?: number | null;
  vowel: string;
  vowel_length: number;
};

export type VoicevoxAccentPhrase = {
  moras: VoicevoxMora[];
  pause_mora?: VoicevoxMora | null;
  is_interrogative?: boolean;
};

export type VoicevoxQuery = {
  accent_phrases: VoicevoxAccentPhrase[];
  speedScale: number;
  prePhonemeLength: number;
  postPhonemeLength: number;
};

export type SpeechTiming = {
  visemes: VisemeKey[];
  phraseEnds: number[];
  question: boolean;
  /** 音声全体の長さ (前後の無音を含む)。 */
  duration: number;
};

/** 唇を閉じてから開く子音。母音の前に短く口を閉じる。 */
const BILABIAL = new Set(['m', 'my', 'b', 'by', 'p', 'py']);

function vowelViseme(vowel: string): Viseme {
  const v = vowel.toLowerCase();
  if (v === 'a' || v === 'i' || v === 'u' || v === 'e' || v === 'o') return v;
  if (v === 'n') return 'n';
  return 'closed'; // cl (促音) / pau
}

/**
 * offset (秒) から始まる発話の口形キーを作る。
 * VOICEVOX は長さを speedScale で割って合成するので、ここでも同じく割る。
 */
export function speechTimingFromQuery(query: VoicevoxQuery, offset = 0): SpeechTiming {
  const speed = query.speedScale > 0 ? query.speedScale : 1;
  let t = offset + query.prePhonemeLength / speed;
  const visemes: VisemeKey[] = [];
  const phraseEnds: number[] = [];
  let question = false;
  const push = (t0: number, t1: number, viseme: Viseme) => {
    if (t1 > t0) visemes.push({ t0, t1, viseme });
  };
  for (const phrase of query.accent_phrases) {
    for (const mora of phrase.moras) {
      const c = (mora.consonant_length ?? 0) / speed;
      const v = mora.vowel_length / speed;
      if (c > 0) {
        // 閉唇子音は口を閉じる。それ以外の子音は次の母音の形へ早めに寄せる。
        push(t, t + c, mora.consonant && BILABIAL.has(mora.consonant) ? 'closed' : vowelViseme(mora.vowel));
      }
      push(t + c, t + c + v, vowelViseme(mora.vowel));
      t += c + v;
    }
    phraseEnds.push(t);
    if (phrase.is_interrogative) question = true;
    if (phrase.pause_mora) {
      const p = phrase.pause_mora.vowel_length / speed;
      push(t, t + p, 'closed');
      t += p;
    }
  }
  return { visemes, phraseEnds, question, duration: t - offset + query.postPhonemeLength / speed };
}

/** 文末の記号から問いかけかどうかを補う (is_interrogative が付かない「〜ですか。」も拾う)。 */
export function looksLikeQuestion(text: string): boolean {
  const s = text.trim();
  return /[?？]$/.test(s) || /(ですか|ますか|でしょうか|ませんか)[。．.]?$/.test(s);
}
