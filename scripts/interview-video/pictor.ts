// Pictor fbx_viewer (SPEC-PC-FBX-TRACK-PLAYBACK) で 1 体ずつ描画し、生フレームを ffmpeg へ流して mp4 にする。
import { spawn, type ChildProcess } from 'node:child_process';
import { dirname } from 'node:path';
import type { AvatarConfig } from './avatars.js';

export type TileSize = { width: number; height: number };

export function renderTile(viewer: string, avatar: AvatarConfig, trackCsv: string, fps: number, size: TileSize, outMp4: string): Promise<void> {
  const viewerArgs = [
    avatar.model,
    '--track', trackCsv,
    '--track-fps', String(fps),
    '--raw-out', '-',
    '--size', `${size.width}x${size.height}`,
    '--camera', avatar.camera.join(','),
    '--clear', avatar.clear.join(','),
    ...(avatar.fov ? ['--fov', String(avatar.fov)] : []),
    '--no-bones',
  ];
  const ffArgs = [
    '-y', '-f', 'rawvideo', '-pix_fmt', 'bgra', '-s', `${size.width}x${size.height}`, '-r', String(fps), '-i', '-',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', outMp4,
  ];
  // viewer はシェーダ (shaders/*.spv) を作業フォルダから探すので、build フォルダ (実行ファイルの 1 つ上) で起動する
  const viewerProc = spawn(viewer, viewerArgs, { cwd: dirname(dirname(viewer)), stdio: ['ignore', 'pipe', 'pipe'] });
  const ff = spawn('ffmpeg', ffArgs, { stdio: ['pipe', 'ignore', 'pipe'] });
  const tail = (s: string, d: Buffer) => (s + d.toString()).slice(-2000);
  let viewerErr = '';
  let ffErr = '';
  viewerProc.stderr.on('data', (d: Buffer) => (viewerErr = tail(viewerErr, d)));
  ff.stderr.on('data', (d: Buffer) => (ffErr = tail(ffErr, d)));
  viewerProc.stdout.pipe(ff.stdin);
  const exited = (p: ChildProcess) => new Promise<number | null>((res, rej) => {
    p.on('error', rej);
    p.on('close', res);
  });
  // 両方の終了を待ってから判定する (片方の close が先に来ても、もう片方の終了コードを取りこぼさない)
  return Promise.all([exited(viewerProc), exited(ff)]).then(([viewerCode, ffCode]) => {
    if (viewerCode !== 0) throw new Error(`pictor viewer exited with ${viewerCode} (${avatar.id}): ${viewerErr}`);
    if (ffCode !== 0) throw new Error(`ffmpeg exited with ${ffCode}: ${ffErr}`);
  });
}

/** 3 枚のタイルを横に並べ (オンライン面接の画面)、音声を重ねる。字幕は出さない。 */
export function composePanel(tiles: string[], audioWav: string, outMp4: string, gap = 8): Promise<void> {
  const inputs = tiles.flatMap((t) => ['-i', t]);
  const padded = tiles.map((_, i) => `[${i}:v]pad=iw+${i < tiles.length - 1 ? gap : 0}:ih:0:0:color=0x111318[v${i}]`).join(';');
  const stack = `${tiles.map((_, i) => `[v${i}]`).join('')}hstack=inputs=${tiles.length},pad=iw+${gap * 2}:ih+${gap * 2}:${gap}:${gap}:color=0x111318[out]`;
  const args = ['-y', ...inputs, '-i', audioWav, '-filter_complex', `${padded};${stack}`, '-map', '[out]', '-map', `${tiles.length}:a`,
    '-c:v', 'libx264', '-crf', '21', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-shortest', outMp4];
  return new Promise((resolvePromise, reject) => {
    const ff = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    ff.stderr.on('data', (d: Buffer) => (err = (err + d.toString()).slice(-2000)));
    ff.on('close', (code) => (code === 0 ? resolvePromise() : reject(new Error(`ffmpeg compose ${code}: ${err}`))));
  });
}
