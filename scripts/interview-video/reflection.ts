// 面接後の振り返り: 面接中に出さなかったテキスト (発話の文字起こし・聞きたい要点・講評) をカードにして動画にする。
// カードは HTML を headless Edge で撮り、1 枚ずつ静止画の区間にする (音声なし)。
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export type ReflectionInput = {
  title: string;
  turns: { who: string; text: string; interviewer: boolean }[];
  focus: { senior: string[]; field: string[] };
  summary: Record<string, unknown> | null;
};

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const W = 1280;
const H = 720;
const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const list = (xs: unknown) => (Array.isArray(xs) ? xs : []).map((x) => `<li>${esc(x)}</li>`).join('');

const CSS = `*{box-sizing:border-box;margin:0;padding:0}
body{width:${W}px;height:${H}px;overflow:hidden;font-family:"Yu Gothic UI","Meiryo",sans-serif;background:#0f172a;color:#e2e8f0}
.f{position:absolute;inset:0;padding:34px 46px;display:flex;flex-direction:column;gap:14px}
.top{display:flex;justify-content:space-between;color:#94a3b8;font-size:17px}
h1{font-size:34px}h2{font-size:24px}h3{font-size:18px;color:#93c5fd;margin-bottom:6px}
.card{background:#111c33;border:1px solid #23314f;border-radius:12px;padding:14px 18px;overflow:hidden}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:16px;flex:1;min-height:0}
li{margin:4px 0 4px 1.1em;font-size:16px;line-height:1.45}
.t{font-size:16px;line-height:1.5;margin-bottom:8px}.t b{color:#93c5fd}.t.c b{color:#d8b4fe}
.foot{font-size:12px;color:#64748b;text-align:right}`;

function page(title: string, badge: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body><div class="f"><div class="top"><span>${esc(title)}</span><span>${esc(badge)}</span></div>${body}<div class="foot">面接後の振り返り (受験者・企業・ES・逆質問への回答はすべて架空)</div></div></body></html>`;
}

/** 文字起こしは 1 ページ約 520 字で区切る。 */
function transcriptPages(turns: ReflectionInput['turns']): ReflectionInput['turns'][] {
  const pages: ReflectionInput['turns'][] = [];
  let cur: ReflectionInput['turns'] = [];
  let chars = 0;
  for (const t of turns) {
    if (cur.length && chars + t.text.length > 520) {
      pages.push(cur);
      cur = [];
      chars = 0;
    }
    cur.push(t);
    chars += t.text.length;
  }
  if (cur.length) pages.push(cur);
  return pages;
}

export function buildReflectionPages(input: ReflectionInput): { html: string; seconds: number }[] {
  const pages: { html: string; seconds: number }[] = [];
  pages.push({ html: page(input.title, '振り返り', `<div style="flex:1;display:flex;flex-direction:column;justify-content:center;gap:16px"><h1>面接の振り返り</h1><div class="card"><ul>${list(['面接中のやり取りを文字で確認します', '面接官が用意していた「聞きたい要点」', '講評と次の練習'])}</ul></div></div>`), seconds: 5 });
  const tp = transcriptPages(input.turns);
  tp.forEach((ts, i) => {
    const body = ts.map((t) => `<div class="t${t.interviewer ? '' : ' c'}"><b>${esc(t.who)}</b>: ${esc(t.text)}</div>`).join('');
    const chars = ts.reduce((a, t) => a + t.text.length, 0);
    pages.push({ html: page(input.title, `やり取り ${i + 1}/${tp.length}`, `<div class="card" style="flex:1">${body}</div>`), seconds: Math.max(8, Math.round(chars / 45)) });
  });
  pages.push({ html: page(input.title, '面接官が用意していた聞きたい要点', `<div class="cols"><div class="card"><h3>シニア (テックリード)</h3><ul>${list(input.focus.senior)}</ul></div><div class="card"><h3>現場エンジニア</h3><ul>${list(input.focus.field)}</ul></div></div>`), seconds: 18 });
  const s = input.summary ?? {};
  pages.push({ html: page(input.title, '講評', `<h2>${esc(s['headline'])}</h2><div class="cols"><div class="card"><h3>面接官の総評</h3><ul>${list([s['interviewer_note']])}</ul></div><div class="card"><h3>伸ばすところ</h3><ul>${list(s['growth_points'])}</ul><h3 style="margin-top:10px">次回の深掘りテーマ</h3><ul>${list(s['carry_over'])}</ul></div></div>`), seconds: 20 });
  return pages;
}

function shoot(html: string, dir: string, name: string): string {
  const htmlPath = join(dir, `${name}.html`);
  const png = join(dir, `${name}.png`);
  writeFileSync(htmlPath, html, 'utf8');
  execFileSync(EDGE, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1', `--window-size=${W},${H}`, `--screenshot=${png}`, pathToFileURL(htmlPath).href], { stdio: 'ignore' });
  if (!existsSync(png)) throw new Error(`screenshot failed: ${name}`);
  return png;
}

/** 振り返りの mp4 (無音トラック付き、パネル動画と連結できる形式) を作る。 */
export function renderReflection(input: ReflectionInput, dir: string, outMp4: string, size = { width: W, height: H }): void {
  mkdirSync(dir, { recursive: true });
  const segs = buildReflectionPages(input).map((p, i) => {
    const png = shoot(p.html, dir, `r${String(i).padStart(2, '0')}`);
    const mp4 = join(dir, `r${String(i).padStart(2, '0')}.mp4`);
    execFileSync('ffmpeg', ['-y', '-loop', '1', '-t', String(p.seconds), '-i', png, '-f', 'lavfi', '-t', String(p.seconds), '-i', 'anullsrc=r=48000:cl=stereo',
      '-vf', `scale=${size.width}:${size.height}:force_original_aspect_ratio=decrease,pad=${size.width}:${size.height}:(ow-iw)/2:(oh-ih)/2:color=0x0f172a,fps=30`,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', mp4], { stdio: 'ignore' });
    return mp4;
  });
  const listFile = join(dir, 'concat.txt');
  writeFileSync(listFile, segs.map((p) => `file '${p.split('\\').join('/')}'`).join('\n'), 'utf8');
  execFileSync('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', outMp4], { stdio: 'ignore' });
}
