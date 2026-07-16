// 決定的 PRNG (mulberry32) と seed 採番。
// spec/feature/inference/interviewer-reproduction.md §4:
// 乱択は注入 rng のみ (Math.random 直呼び禁止、Pagus TermMachineOptions.rng と同規約)。
// 同じ seed → 同じ乱数列 → 同じ質問プラン、を担保する。

export type Rng = () => number;

/** 32bit seed から [0,1) の決定的乱数列を返す。依存追加なしの 10 行実装。 */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** セッション作成時に 1 回だけ採番する 32bit seed。
 *  ここだけは非決定でよい (採番した値を sessions.metadata に永続化して再現する)。 */
export function newSessionSeed(): number {
  return (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
}

/** rng 注入の Fisher-Yates。入力配列は破壊しない。 */
export function shuffled<T>(items: readonly T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
