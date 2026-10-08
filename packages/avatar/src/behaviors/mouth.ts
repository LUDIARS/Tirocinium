// 口: 口形キーを前後に少し重ねて (調音結合) 母音モーフの重みにする。
import { clamp01, ramp, valueNoise } from '../noise.js';
import type { Utterance, Viseme } from '../types.js';

export type MouthWeights = { a: number; i: number; u: number; e: number; o: number };

const ZERO: MouthWeights = { a: 0, i: 0, u: 0, e: 0, o: 0 };
/** 口形ごとのモーフ配合。ん (n) は唇を軽く閉じたまま少しだけ開く。 */
const SHAPES: Record<Viseme, MouthWeights> = {
  a: { a: 1, i: 0, u: 0, e: 0, o: 0 },
  i: { a: 0, i: 1, u: 0, e: 0, o: 0 },
  u: { a: 0, i: 0, u: 1, e: 0, o: 0 },
  e: { a: 0, i: 0, u: 0, e: 1, o: 0 },
  o: { a: 0, i: 0, u: 0, e: 0, o: 1 },
  n: { a: 0.08, i: 0, u: 0.12, e: 0, o: 0 },
  closed: ZERO,
};

/** 口が形に向かう速さ。開きは速く、閉じはやや遅い。 */
const ATTACK = 0.045;
const RELEASE = 0.07;

/** 実際の発話は毎モーラ全開にならない。0.55〜0.85 の間で句ごとにゆっくり揺らす。 */
function openness(seed: number, t: number): number {
  return 0.7 + 0.15 * valueNoise(seed, t, 1.3);
}

export function mouthAt(own: Utterance[], t: number, seed: number): MouthWeights {
  const u = own.find((x) => t >= x.start - 0.1 && t <= x.end + 0.15);
  if (!u) return ZERO;
  const out: MouthWeights = { ...ZERO };
  for (const k of u.visemes) {
    if (t < k.t0 - ATTACK || t > k.t1 + RELEASE) continue;
    const w = ramp(t, k.t0 - ATTACK, k.t0 + 0.01) * (1 - ramp(t, k.t1 - 0.01, k.t1 + RELEASE));
    if (w <= 0) continue;
    const s = SHAPES[k.viseme];
    out.a += s.a * w;
    out.i += s.i * w;
    out.u += s.u * w;
    out.e += s.e * w;
    out.o += s.o * w;
  }
  const sum = out.a + out.i + out.u + out.e + out.o;
  const scale = (sum > 1 ? 1 / sum : 1) * openness(seed, t);
  return {
    a: clamp01(out.a * scale),
    i: clamp01(out.i * scale),
    u: clamp01(out.u * scale),
    e: clamp01(out.e * scale),
    o: clamp01(out.o * scale),
  };
}
