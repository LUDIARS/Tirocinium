// パネル面接シミュレーション (scripts/specialist-sim の結果) を動画にする。
//   npx tsx scripts/interview-video --sim <result.json> --avatars <avatars.json> --viewer <pictor_fbx_viewer> --out <dir>
//   [--voicevox http://host:50021] [--fps 30] [--tracks-only]
// 面接中は字幕を出さず、3 人の面接官 (Pictor で描画) の映像と音声だけにする。テキストは最後の振り返りで出す。
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  buildTrackCsv,
  buildUtterances,
  CANDIDATE,
  planMember,
  poseAt,
  speechTimingFromQuery,
  type MotionContext,
  type SpokenTurn,
} from '../../packages/avatar/src/index.js';
import type { SimResult } from '../specialist-sim/simulate.js';
import { mixTimeline } from './audio.js';
import { loadAvatarSet } from './avatars.js';
import { fakeQuery, fakeSynthesize } from './fake-voice.js';
import { composePanel, renderTile } from './pictor.js';
import { renderReflection } from './reflection.js';
import { synthesize } from './voicevox.js';

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? process.argv[i + 1] : fallback;
  if (v === undefined) throw new Error(`--${name} is required`);
  return v;
}
const flag = (name: string) => process.argv.includes(`--${name}`);

const TILE = { width: 416, height: 704 };

async function main(): Promise<void> {
  const sim = JSON.parse(readFileSync(resolve(arg('sim')), 'utf8')) as SimResult;
  const set = loadAvatarSet(resolve(arg('avatars')));
  const out = resolve(arg('out'));
  const voicevox = arg('voicevox', 'http://100.84.227.24:50021');
  const fps = Number(arg('fps', '30'));
  const sc = sim.scenario;
  mkdirSync(out, { recursive: true });

  // 1. 音声合成 (口パクの正本となる audio_query も保存)
  const candidateVoice = set.candidateVoice[sc.profile.role];
  if (candidateVoice === undefined) throw new Error(`candidateVoice for ${sc.profile.role} is missing`);
  const spoken: SpokenTurn[] = [];
  const wavs: string[] = [];
  const maxTurns = Number(arg('max-turns', String(sim.turns.length)));
  for (const t of sim.turns.slice(0, maxTurns)) {
    const speakerId = t.role === 'user' ? CANDIDATE : t.speaker;
    const voice = speakerId === CANDIDATE ? candidateVoice : set.avatars.find((a) => a.id === speakerId)?.voice;
    if (voice === undefined) throw new Error(`no voice for ${speakerId}`);
    const key = `${sc.id}-${String(t.turn_no).padStart(2, '0')}`;
    const s = flag('fake-voice')
      ? fakeSynthesize(join(out, 'voice'), key, t.text, speechTimingFromQuery(fakeQuery(t.text)).duration)
      : await synthesize(voicevox, join(out, 'voice'), key, t.text, voice);
    spoken.push({ speakerId, text: t.text, query: s.query });
    wavs.push(s.wavPath);
    process.stdout.write('.');
  }

  // 2. 会話の時間軸と、面接官ごとの動きのトラック
  const { utterances, duration } = buildUtterances(spoken, 20261008);
  const panel = sc.panel.map((p, seat) => ({ id: p.id, seat, speaks: p.interviewer !== null }));
  const ctx: MotionContext = { panel, utterances, duration, seed: 20261008 };
  const frames = Math.ceil(duration * fps);
  const tracks = set.avatars.map((a) => {
    const member = panel.find((p) => p.id === a.id);
    if (!member) throw new Error(`avatar ${a.id} is not on the panel`);
    const plan = planMember(ctx, member);
    const path = join(out, `track-${sc.id}-${a.id}.csv`);
    writeFileSync(path, buildTrackCsv(frames, fps, a.rig, (t) => poseAt(ctx, plan, t)), 'utf8');
    return { avatar: a, path };
  });
  writeFileSync(join(out, `timeline-${sc.id}.json`), JSON.stringify({ duration, fps, frames, utterances }, null, 1), 'utf8');

  // 3. 音声を 1 本に
  const audio = join(out, `audio-${sc.id}.wav`);
  mixTimeline(utterances.map((u, i) => ({ path: wavs[i]!, start: u.start })), duration, audio);
  console.log(`\n${sc.id}: ${duration.toFixed(1)} s, ${frames} frames, tracks written`);
  if (flag('tracks-only')) return;

  // 4. Pictor で 1 体ずつ描画 → 3 分割に並べる
  const viewer = resolve(arg('viewer'));
  const tiles: string[] = [];
  for (const t of tracks) {
    const tile = join(out, `tile-${sc.id}-${t.avatar.id}.mp4`);
    await renderTile(viewer, t.avatar, t.path, fps, TILE, tile);
    tiles.push(tile);
    console.log(`rendered ${t.avatar.id}`);
  }
  const panelMp4 = join(out, `panel-${sc.id}.mp4`);
  await composePanel(tiles, audio, panelMp4);

  // 5. 振り返り (テキストはここで初めて出す) をつなぐ
  const name = (id: string) => sc.panel.find((p) => p.id === id)?.name ?? '面接官';
  const reflectionMp4 = join(out, `reflection-${sc.id}.mp4`);
  renderReflection({
    title: sc.title,
    turns: sim.turns.map((t) => ({ who: t.role === 'user' ? sc.examinee.display_name : `面接官 ${name(t.speaker)}`, text: t.text, interviewer: t.role !== 'user' })),
    focus: sim.focusPoints,
    summary: sim.summary,
  }, join(out, `reflection-${sc.id}`), reflectionMp4);
  const listFile = join(out, `final-${sc.id}.txt`);
  writeFileSync(listFile, [panelMp4, reflectionMp4].map((p) => `file '${p.split('\\').join('/')}'`).join('\n'), 'utf8');
  const finalMp4 = join(out, `interview-${sc.id}.mp4`);
  execFileSync('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-crf', '22',
    '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-b:a', '128k', '-movflags', '+faststart', finalMp4], { stdio: 'ignore' });
  console.log(`wrote ${finalMp4}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
