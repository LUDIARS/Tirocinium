// 振る舞いを合成して 1 人分の姿勢を出す。計画 (まばたき・視線・うなずきの時刻) は最初に 1 回だけ作る。
import { blinkAt, planBlinks } from './behaviors/blink.js';
import { bodyAt } from './behaviors/body.js';
import { browAt, smileAt } from './behaviors/expression.js';
import { eyesAt, headGazeAt, planGaze, type GazeSegment } from './behaviors/gaze.js';
import { mouthAt } from './behaviors/mouth.js';
import { nodAt, planNods, type Nod } from './behaviors/nod.js';
import { hash01, seedOf } from './noise.js';
import type { AvatarPose, MotionContext, PanelMember, Utterance } from './types.js';

export type MemberPlan = {
  member: PanelMember;
  seed: number;
  own: Utterance[];
  blinks: number[];
  gaze: GazeSegment[];
  nods: Nod[];
};

/** 大きく視線を移すときは半分ほどまばたきを伴う (人は視線移動でまばたきしやすい)。 */
function blinksWithGazeShifts(base: number[], gaze: GazeSegment[], seed: number): number[] {
  const extra = gaze
    .filter((g, i) => i > 0 && (g.kind === 'notes' || g.kind === 'colleague') && hash01(seed, i, 41) < 0.5)
    .map((g) => g.t0);
  const all = [...base, ...extra].sort((a, b) => a - b);
  // 0.2 秒以内に重なったまばたきは 1 回にする
  return all.filter((t, i) => i === 0 || t - all[i - 1]! > 0.2);
}

export function planMember(ctx: MotionContext, member: PanelMember): MemberPlan {
  const seed = seedOf(`${ctx.seed}:${member.id}`);
  const own = ctx.utterances.filter((u) => u.speakerId === member.id);
  const gaze = planGaze(ctx, member, seed);
  return {
    member,
    seed,
    own,
    gaze,
    blinks: blinksWithGazeShifts(planBlinks(own, ctx.duration, seed), gaze, seed),
    nods: planNods(ctx, member, seed),
  };
}

export function poseAt(ctx: MotionContext, plan: MemberPlan, t: number): AvatarPose {
  const body = bodyAt(plan.own, t, plan.seed);
  const head = headGazeAt(plan.gaze, t);
  const eyes = eyesAt(plan.gaze, t);
  const mouth = mouthAt(plan.own, t, plan.seed);
  const eye = { rx: eyes.pitch, ry: eyes.yaw, rz: 0 };
  return {
    bones: {
      chest: body.chest,
      neck: { rx: body.neck.rx + head.pitch * 0.3, ry: body.neck.ry + head.yaw * 0.3, rz: body.neck.rz },
      head: {
        rx: body.head.rx + head.pitch * 0.7 + nodAt(plan.nods, t),
        ry: body.head.ry + head.yaw * 0.7,
        rz: body.head.rz,
      },
      eyeL: eye,
      eyeR: eye,
    },
    morphs: {
      ...mouth,
      blink: blinkAt(plan.blinks, t),
      browUp: browAt(plan.own, t),
      smile: smileAt(ctx.utterances, plan.member.id, t, plan.seed),
    },
  };
}
