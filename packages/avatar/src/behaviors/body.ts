// 体: 呼吸 (胸の上下)、話す直前の息継ぎ、頭と胸のゆっくりした揺れ。話している間は動きが大きくなる。
import { ramp, sway } from '../noise.js';
import type { Rotation, Utterance } from '../types.js';

export type BodyMotion = { chest: Rotation; neck: Rotation; head: Rotation };

function breathRate(seed: number): number {
  return 0.22 + (seed % 7) * 0.008; // 13〜16 回 / 分
}

/** 発話の 0.45 秒前から息を吸い、話し始めで戻る。 */
function inhale(own: Utterance[], t: number): number {
  for (const u of own) {
    if (t >= u.start - 0.45 && t <= u.start + 0.2) return ramp(t, u.start - 0.45, u.start - 0.1) * (1 - ramp(t, u.start, u.start + 0.2));
  }
  return 0;
}

export function bodyAt(own: Utterance[], t: number, seed: number): BodyMotion {
  const speaking = own.some((u) => t >= u.start && t <= u.end);
  const energy = speaking ? 1.8 : 1;
  const breath = Math.sin(2 * Math.PI * breathRate(seed) * t + seed);
  const inh = inhale(own, t);
  return {
    chest: {
      rx: 0.5 * breath - 1.2 * inh,
      ry: 0.7 * sway(seed + 11, t, 0.07),
      rz: 0.4 * sway(seed + 12, t, 0.05),
    },
    neck: {
      rx: 0.4 * sway(seed + 13, t, 0.11),
      ry: 0.5 * sway(seed + 14, t, 0.09),
      rz: 0,
    },
    head: {
      rx: 1.0 * energy * sway(seed + 15, t, 0.23) - 1.5 * inh,
      ry: 1.4 * energy * sway(seed + 16, t, 0.17),
      rz: 1.1 * energy * sway(seed + 17, t, 0.13),
    },
  };
}
