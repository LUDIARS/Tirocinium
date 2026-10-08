// 視線: 誰を見るかを区間に分け、目は素早く (サッカード)、頭は遅れて一部だけ追う。
// オンライン面接の画面を想定: 正面 = 受験者 (カメラ)、左右 = 画面上の同席者のタイル、下 = 手元のメモ。
import { hash01, ramp } from '../noise.js';
import { CANDIDATE, type MotionContext, type PanelMember, type Utterance } from '../types.js';

export type GazeSegment = { t0: number; yaw: number; pitch: number; kind: 'camera' | 'colleague' | 'notes' | 'think' };

const CAMERA = { yaw: 0, pitch: 2 } as const; // 画面を見るので、わずかに下
const NOTES_PITCH = 22;
const COLLEAGUE_YAW = 9;

function speakerAt(utts: Utterance[], t: number): Utterance | undefined {
  return utts.find((u) => t >= u.start && t < u.end);
}

/** 区間の境目を発話の切れ目から作り、その時点の注意の向きを決める。 */
export function planGaze(ctx: MotionContext, me: PanelMember, seed: number): GazeSegment[] {
  const segs: GazeSegment[] = [{ t0: 0, ...CAMERA, kind: 'camera' }];
  const add = (s: GazeSegment) => {
    const last = segs[segs.length - 1]!;
    if (s.t0 <= last.t0) return;
    if (last.yaw === s.yaw && last.pitch === s.pitch) return;
    segs.push(s);
  };
  let n = 0;
  for (const u of ctx.utterances) {
    n += 1;
    const r = (k: number) => hash01(seed, n, k);
    if (u.speakerId === me.id) {
      // 話し始めに視線を外して考えることがある
      if (r(1) < 0.3) {
        add({ t0: u.start - 0.15, yaw: (r(2) < 0.5 ? -1 : 1) * 10, pitch: -6, kind: 'think' });
        add({ t0: u.start + 0.5 + r(3) * 0.5, ...CAMERA, kind: 'camera' });
      } else {
        add({ t0: u.start - 0.2, ...CAMERA, kind: 'camera' });
      }
      continue;
    }
    if (u.speakerId === CANDIDATE) {
      add({ t0: u.start + 0.1, ...CAMERA, kind: 'camera' });
      // 回答中、文節の切れ目で時々メモを取る
      for (const p of u.phraseEnds) {
        n += 1;
        if (hash01(seed, n, 5) < 0.12) {
          const len = 1.8 + hash01(seed, n, 6) * 3;
          add({ t0: p + 0.2, yaw: -3 + hash01(seed, n, 7) * 6, pitch: NOTES_PITCH, kind: 'notes' });
          add({ t0: Math.min(p + 0.2 + len, u.end + 0.3), ...CAMERA, kind: 'camera' });
        }
      }
      continue;
    }
    const other = ctx.panel.find((p) => p.id === u.speakerId);
    if (other && r(8) < 0.65) {
      // 同席者が話し出したら、そのタイルの方を見る
      const dir = Math.sign(other.seat - me.seat);
      add({ t0: u.start + 0.25 + r(9) * 0.3, yaw: dir * COLLEAGUE_YAW, pitch: 3, kind: 'colleague' });
      if (r(10) < 0.6) add({ t0: u.start + 1.5 + r(11) * 2, ...CAMERA, kind: 'camera' });
    }
  }
  return segs;
}

function segmentPair(segs: GazeSegment[], t: number): { prev: GazeSegment; cur: GazeSegment } {
  let i = 0;
  while (i + 1 < segs.length && segs[i + 1]!.t0 <= t) i += 1;
  return { prev: segs[Math.max(0, i - 1)]!, cur: segs[i]! };
}

/** 目の向き: 50ms で到達するサッカード。 */
export function eyesAt(segs: GazeSegment[], t: number): { yaw: number; pitch: number } {
  const { prev, cur } = segmentPair(segs, t);
  const k = ramp(t, cur.t0, cur.t0 + 0.05);
  return { yaw: prev.yaw + (cur.yaw - prev.yaw) * k, pitch: prev.pitch + (cur.pitch - prev.pitch) * k };
}

/** 頭の向き: 目から 80ms 遅れ、0.4 秒かけて角度の一部だけ追う (メモの時は大きく下を向く)。 */
export function headGazeAt(segs: GazeSegment[], t: number): { yaw: number; pitch: number } {
  const { prev, cur } = segmentPair(segs, t);
  const follow = (s: GazeSegment) => ({ yaw: s.yaw * 0.45, pitch: s.pitch * (s.kind === 'notes' ? 0.75 : 0.35) });
  const a = follow(prev);
  const b = follow(cur);
  const k = ramp(t, cur.t0 + 0.08, cur.t0 + 0.48);
  return { yaw: a.yaw + (b.yaw - a.yaw) * k, pitch: a.pitch + (b.pitch - a.pitch) * k };
}

export { speakerAt };
