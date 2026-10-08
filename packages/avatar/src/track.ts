// 論理名の姿勢を、アバターごとの骨名・モーフ名へ写して Pictor の track CSV にする。
// CSV の形式は Pictor spec/feature/fbx-track-playback.md (SPEC-PC-FBX-TRACK-PLAYBACK)。
import type { AvatarPose, BoneKey, MorphKey, Rotation } from './types.js';

type Axis = 'rx' | 'ry' | 'rz';

/** 論理軸 (rx+ = うつむく / ry+ = 画面右を向く / rz+ = 首をかしげる) をリグの軸と符号へ写す。 */
export type AxisMap = Record<Axis, { axis: Axis; sign: 1 | -1 }>;

export type RigMap = {
  bones: Partial<Record<BoneKey, { name: string; axes?: AxisMap; scale?: number }>>;
  /** 1 つの論理モーフを複数のシェイプへ配る (例: blink → 左右の目) 。重みに掛ける倍率付き。 */
  morphs: Partial<Record<MorphKey, { name: string; gain?: number }[]>>;
  /** 動かさない姿勢補正 (例: T ポーズの腕を下ろす)。リグの軸の角度をそのまま全フレームに書く。 */
  fixed?: { name: string; rx?: number; ry?: number; rz?: number }[];
};

const IDENTITY: AxisMap = { rx: { axis: 'rx', sign: 1 }, ry: { axis: 'ry', sign: 1 }, rz: { axis: 'rz', sign: 1 } };

function header(rig: RigMap): string[] {
  const cols = ['frame'];
  for (const b of Object.values(rig.bones)) cols.push(`bone:${b!.name}.rx`, `bone:${b!.name}.ry`, `bone:${b!.name}.rz`);
  for (const list of Object.values(rig.morphs)) for (const m of list!) cols.push(`morph:${m.name}`);
  for (const f of rig.fixed ?? []) cols.push(`bone:${f.name}.rx`, `bone:${f.name}.ry`, `bone:${f.name}.rz`);
  return cols;
}

function mapRotation(r: Rotation, axes: AxisMap, scale: number): Rotation {
  const out: Rotation = { rx: 0, ry: 0, rz: 0 };
  for (const k of ['rx', 'ry', 'rz'] as const) out[axes[k].axis] += r[k] * axes[k].sign * scale;
  return out;
}

const fmt = (x: number) => (Math.abs(x) < 1e-4 ? '0' : x.toFixed(4));

export function trackRow(frame: number, pose: AvatarPose, rig: RigMap): string {
  const row = [String(frame)];
  for (const [key, b] of Object.entries(rig.bones) as [BoneKey, NonNullable<RigMap['bones'][BoneKey]>][]) {
    const r = mapRotation(pose.bones[key], b.axes ?? IDENTITY, b.scale ?? 1);
    row.push(fmt(r.rx), fmt(r.ry), fmt(r.rz));
  }
  for (const [key, list] of Object.entries(rig.morphs) as [MorphKey, { name: string; gain?: number }[]][]) {
    for (const m of list) row.push(fmt(Math.min(1, pose.morphs[key] * (m.gain ?? 1))));
  }
  for (const f of rig.fixed ?? []) row.push(fmt(f.rx ?? 0), fmt(f.ry ?? 0), fmt(f.rz ?? 0));
  return row.join(',');
}

/** fps でサンプルした全フレームの CSV。 */
export function buildTrackCsv(frames: number, fps: number, rig: RigMap, sample: (t: number) => AvatarPose): string {
  const lines = [header(rig).join(',')];
  for (let f = 0; f < frames; f += 1) lines.push(trackRow(f, sample(f / fps), rig));
  return `${lines.join('\n')}\n`;
}
