// うなずき: 聞き手は受験者の文節の切れ目で相づちのようにうなずき、回答の終わりにはよりはっきりうなずく。
// 話し手は文節の頭で小さく頭を振って強調する。
import { hash01 } from '../noise.js';
import { CANDIDATE, type MotionContext, type PanelMember } from '../types.js';

export type Nod = { t0: number; dur: number; amp: number };

export function planNods(ctx: MotionContext, me: PanelMember, seed: number): Nod[] {
  const nods: Nod[] = [];
  let n = 0;
  for (const u of ctx.utterances) {
    n += 1;
    if (u.speakerId === CANDIDATE) {
      for (const p of u.phraseEnds) {
        n += 1;
        const r = hash01(seed, n, 1);
        if (r < 0.42) {
          const amp = 3.5 + hash01(seed, n, 2) * 4;
          const t0 = p + 0.05 + hash01(seed, n, 3) * 0.2;
          nods.push({ t0, dur: 0.42, amp });
          // 「うん、うん」の二度うなずき
          if (hash01(seed, n, 4) < 0.25) nods.push({ t0: t0 + 0.38, dur: 0.32, amp: amp * 0.6 });
        }
      }
      // 回答の終わりの受け止め
      if (hash01(seed, n, 5) < 0.75) nods.push({ t0: u.end + 0.15, dur: 0.55, amp: 7 + hash01(seed, n, 6) * 3 });
      continue;
    }
    if (u.speakerId === me.id) {
      let prev = u.start;
      for (const p of u.phraseEnds) {
        n += 1;
        if (hash01(seed, n, 7) < 0.45) nods.push({ t0: prev + 0.05, dur: 0.35, amp: 2 + hash01(seed, n, 8) * 1.5 });
        prev = p;
      }
      continue;
    }
    // 同席者の話には時々だけ同意のうなずき
    for (const p of u.phraseEnds) {
      n += 1;
      if (hash01(seed, n, 9) < 0.12) nods.push({ t0: p + 0.1, dur: 0.4, amp: 3 });
    }
  }
  return nods;
}

/** 頭の前屈 (rx+) への加算。半周期の正弦で下がって戻る。 */
export function nodAt(nods: Nod[], t: number): number {
  let v = 0;
  for (const d of nods) {
    if (t < d.t0) break;
    const x = (t - d.t0) / d.dur;
    if (x < 1) v += d.amp * Math.sin(Math.PI * x) * (1 - 0.25 * x);
  }
  return v;
}
