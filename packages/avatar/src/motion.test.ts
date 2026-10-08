import { describe, expect, it } from 'vitest';
import { blinkAt, planBlinks } from './behaviors/blink.js';
import { nodAt } from './behaviors/nod.js';
import { buildUtterances, type SpokenTurn } from './timeline.js';
import { planMember, poseAt } from './pose.js';
import { buildTrackCsv, type RigMap } from './track.js';
import { speechTimingFromQuery, type VoicevoxQuery } from './visemes.js';
import { CANDIDATE, type MotionContext, type PanelMember } from './types.js';

function query(moras: string, opts: { question?: boolean; speed?: number } = {}): VoicevoxQuery {
  // 1 文字 = 1 モーラ (子音 0.05 秒 + 母音 0.1 秒)。'm' で始まる文字は閉唇子音。
  const phrase = (s: string) => ({
    moras: [...s].map((ch) => ({ text: ch, consonant: ch === 'm' ? 'm' : 'k', consonant_length: 0.05, vowel: ch === 'm' ? 'a' : ch, vowel_length: 0.1 })),
    pause_mora: { text: '、', vowel: 'pau', vowel_length: 0.3 },
    is_interrogative: opts.question ?? false,
  });
  return { accent_phrases: moras.split(' ').map(phrase), speedScale: opts.speed ?? 1, prePhonemeLength: 0.1, postPhonemeLength: 0.1 };
}

const PANEL: PanelMember[] = [
  { id: 'field', seat: 0, speaks: true },
  { id: 'senior', seat: 1, speaks: true },
  { id: 'observer', seat: 2, speaks: false },
];

function ctxFor(turns: SpokenTurn[], seed = 7): MotionContext {
  const { utterances, duration } = buildUtterances(turns, seed);
  return { panel: PANEL, utterances, duration, seed };
}

const conversation: SpokenTurn[] = [
  { speakerId: 'senior', text: '本日はよろしくお願いします。自己紹介をお願いできますか。', query: query('aiu eo aaa', { question: true }) },
  { speakerId: CANDIDATE, text: 'はい。', query: query('aiueo aiueo aiueo aiueo aiueo aiueo aiueo aiueo') },
  { speakerId: 'field', text: 'ありがとうございます。担当範囲を教えてください。', query: query('ooo iii') },
  { speakerId: CANDIDATE, text: 'えっと。', query: query('eee aaa ooo uuu iii eee aaa ooo uuu iii eee') },
];

describe('speech timing from VOICEVOX audio_query', () => {
  it('lays visemes on the same clock as the synthesized audio, including speedScale', () => {
    const t = speechTimingFromQuery(query('aa ia', { question: true }), 2);
    expect(t.visemes[0]!.t0).toBeCloseTo(2.1);
    expect(t.phraseEnds).toHaveLength(2);
    expect(t.question).toBe(true);
    // 2 句 × (2 モーラ × 0.15 + 間 0.3) + 前後 0.2
    expect(t.duration).toBeCloseTo(1.4);
    expect(speechTimingFromQuery(query('aa ia'), 0).duration * 2).toBeCloseTo(
      speechTimingFromQuery(query('aa ia', { speed: 0.5 }), 0).duration,
    );
  });

  it('closes the lips for bilabial consonants', () => {
    const t = speechTimingFromQuery(query('m'), 0);
    expect(t.visemes[0]!.viseme).toBe('closed');
    expect(t.visemes[1]!.viseme).toBe('a');
  });
});

describe('human-like motion', () => {
  const ctx = ctxFor(conversation);
  const plans = PANEL.map((m) => planMember(ctx, m));
  const [field, senior, observer] = plans;
  const at = (fps: number) => Array.from({ length: Math.floor(ctx.duration * fps) }, (_, i) => i / fps);

  it('blinks irregularly at a human rate and never twice within 0.2 s', () => {
    const blinks = planBlinks([], 600, 12345);
    const gaps = blinks.slice(1).map((t, i) => t - blinks[i]!);
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    expect(mean).toBeGreaterThan(2);
    expect(mean).toBeLessThan(5);
    expect(Math.min(...gaps)).toBeGreaterThan(0.2);
    expect(new Set(gaps.map((g) => g.toFixed(1))).size).toBeGreaterThan(10);
    expect(blinkAt([1], 1.08)).toBe(1);
    expect(blinkAt([1], 0.9)).toBe(0);
  });

  it('moves a mouth only while that member is speaking', () => {
    const open = (p: ReturnType<typeof poseAt>) => p.morphs.a + p.morphs.i + p.morphs.u + p.morphs.e + p.morphs.o;
    for (const t of at(30)) {
      const speaking = (id: string) => ctx.utterances.some((u) => u.speakerId === id && t >= u.start - 0.1 && t <= u.end + 0.15);
      if (!speaking('field')) expect(open(poseAt(ctx, field!, t))).toBe(0);
      expect(open(poseAt(ctx, observer!, t))).toBe(0);
    }
    const seniorTalk = ctx.utterances[0]!;
    const opens = at(60).filter((t) => t > seniorTalk.start && t < seniorTalk.end).map((t) => open(poseAt(ctx, senior!, t)));
    expect(Math.max(...opens)).toBeGreaterThan(0.5);
  });

  it('nods while the candidate answers and takes notes only during answers', () => {
    const answers = ctx.utterances.filter((u) => u.speakerId === CANDIDATE);
    const during = (t: number) => answers.some((u) => t >= u.start && t <= u.end + 1);
    const nodding = plans.some((p) => at(30).some((t) => during(t) && nodAt(p.nods, t) > 3));
    expect(nodding).toBe(true);
    for (const p of plans) {
      for (const g of p.gaze.filter((s) => s.kind === 'notes')) {
        expect(answers.some((u) => g.t0 >= u.start && g.t0 <= u.end + 0.5)).toBe(true);
      }
    }
  });

  it('raises the brows at the end of its own question and stays deterministic per seed', () => {
    const q = ctx.utterances[0]!;
    expect(poseAt(ctx, senior!, q.end - 0.1).morphs.browUp).toBeGreaterThan(0.3);
    const again = planMember(ctxFor(conversation), PANEL[1]!);
    expect(poseAt(ctx, again, 3.3)).toEqual(poseAt(ctx, senior!, 3.3));
    const other = planMember(ctxFor(conversation, 8), PANEL[1]!);
    expect(other.blinks).not.toEqual(senior!.blinks);
  });

  it('writes a Pictor track CSV with mapped bone axes and morph names', () => {
    const rig: RigMap = {
      bones: { head: { name: 'Head', axes: { rx: { axis: 'rz', sign: -1 }, ry: { axis: 'ry', sign: 1 }, rz: { axis: 'rx', sign: 1 } } } },
      morphs: { a: [{ name: 'MTH_A' }], blink: [{ name: 'EYE_L' }, { name: 'EYE_R', gain: 0.5 }] },
      fixed: [{ name: 'LeftArm', ry: -70 }],
    };
    const csv = buildTrackCsv(3, 30, rig, () => ({
      bones: { chest: zero(), neck: zero(), head: { rx: 10, ry: 2, rz: 0 }, eyeL: zero(), eyeR: zero() },
      morphs: { a: 0.5, i: 0, u: 0, e: 0, o: 0, blink: 1, browUp: 0, smile: 0 },
    }));
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('frame,bone:Head.rx,bone:Head.ry,bone:Head.rz,morph:MTH_A,morph:EYE_L,morph:EYE_R,bone:LeftArm.rx,bone:LeftArm.ry,bone:LeftArm.rz');
    expect(lines).toHaveLength(4);
    expect(lines[2]).toBe('1,0,2.0000,-10.0000,0.5000,1.0000,0.5000,0,-70.0000,0');
  });
});

function zero() {
  return { rx: 0, ry: 0, rz: 0 };
}
