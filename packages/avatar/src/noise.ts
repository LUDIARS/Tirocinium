// 決定的な乱数と 1 次元の滑らかなノイズ。同じ seed からは同じ動きになる (動画の再生成で揺れない)。

/** 32bit 整数ハッシュ → [0, 1)。 */
export function hash01(...parts: number[]): number {
  let h = 0x811c9dc5;
  for (const p of parts) {
    h ^= Math.floor(p * 1000003) | 0;
    h = Math.imul(h, 0x01000193);
    h ^= h >>> 13;
    h = Math.imul(h, 0x5bd1e995);
  }
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** 文字列 → seed 用の整数。 */
export function seedOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const smooth = (x: number) => x * x * (3 - 2 * x);

/** 値ノイズ: 周波数 hz で [-1, 1] を滑らかに補間する。 */
export function valueNoise(seed: number, t: number, hz: number): number {
  const x = t * hz;
  const i = Math.floor(x);
  const f = smooth(x - i);
  const a = hash01(seed, i) * 2 - 1;
  const b = hash01(seed, i + 1) * 2 - 1;
  return a + (b - a) * f;
}

/** 2 オクターブの揺らぎ。体の微小な揺れに使う。 */
export function sway(seed: number, t: number, hz: number): number {
  return valueNoise(seed, t, hz) * 0.7 + valueNoise(seed + 7, t, hz * 2.3) * 0.3;
}

export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

/** 0→1 の立ち上がり (smoothstep)。 */
export function ramp(t: number, t0: number, t1: number): number {
  if (t1 <= t0) return t >= t1 ? 1 : 0;
  return smooth(clamp01((t - t0) / (t1 - t0)));
}
