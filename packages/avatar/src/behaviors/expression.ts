// 表情: 自分の問いかけの終わりに眉を上げる。礼やあいさつでは笑む。
// 聞いている間は穏やかな面接官として薄く笑みを保ち、回答の受け止めで少し笑む。
import { clamp01, ramp, valueNoise } from '../noise.js';
import { CANDIDATE, type Utterance } from '../types.js';

const THANKS = /(ありがとう|よろしく|お疲れ|お願いします|はじめまして)/;

export function browAt(own: Utterance[], t: number): number {
  let v = 0;
  for (const u of own) {
    if (!u.question) continue;
    const up = ramp(t, u.end - 0.6, u.end - 0.2);
    const down = 1 - ramp(t, u.end + 0.5, u.end + 1.1);
    v = Math.max(v, 0.55 * up * down);
  }
  return v;
}

export function smileAt(all: Utterance[], ownId: string, t: number, seed: number): number {
  let v = 0.08 + 0.05 * valueNoise(seed + 31, t, 0.05);
  for (const u of all) {
    if (u.speakerId === ownId && THANKS.test(u.text.slice(0, 40))) {
      v = Math.max(v, 0.55 * ramp(t, u.start - 0.2, u.start + 0.3) * (1 - ramp(t, u.start + 1.6, u.start + 2.4)));
    }
    if (u.speakerId === ownId && THANKS.test(u.text.slice(-40))) {
      v = Math.max(v, 0.5 * ramp(t, u.end - 1.4, u.end - 0.8) * (1 - ramp(t, u.end + 0.6, u.end + 1.4)));
    }
    if (u.speakerId === CANDIDATE) {
      v = Math.max(v, 0.22 * ramp(t, u.end + 0.1, u.end + 0.4) * (1 - ramp(t, u.end + 1.2, u.end + 1.8)));
    }
  }
  return clamp01(v);
}
