// まばたき: 間隔はばらつき、話している間はやや増える。1 割強は二度まばたき。
// 形は「速く閉じて、少し止まり、ゆっくり開く」。
import { hash01 } from '../noise.js';
import type { Utterance } from '../types.js';

const CLOSE = 0.07;
const HOLD = 0.03;
const OPEN = 0.12;

/** 発話中かどうかで平均間隔を変えながら、まばたき開始時刻を並べる。 */
export function planBlinks(own: Utterance[], duration: number, seed: number): number[] {
  const speaking = (t: number) => own.some((u) => t >= u.start && t <= u.end);
  const out: number[] = [];
  let t = 0.4 + hash01(seed, 1) * 1.6;
  let n = 0;
  while (t < duration) {
    out.push(t);
    n += 1;
    if (hash01(seed, n, 2) < 0.13) {
      t += 0.22 + hash01(seed, n, 3) * 0.08;
      out.push(t);
    }
    const mean = speaking(t) ? 2.6 : 3.6;
    // 0.35〜1.9 倍に散らす (等間隔だと機械的に見える)
    t += mean * (0.35 + 1.55 * hash01(seed, n, 4) ** 1.4);
  }
  return out;
}

export function blinkAt(starts: number[], t: number): number {
  for (const s of starts) {
    if (t < s) break;
    const d = t - s;
    if (d < CLOSE) return d / CLOSE;
    if (d < CLOSE + HOLD) return 1;
    if (d < CLOSE + HOLD + OPEN) return 1 - (d - CLOSE - HOLD) / OPEN;
  }
  return 0;
}
