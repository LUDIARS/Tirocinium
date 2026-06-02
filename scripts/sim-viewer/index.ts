#!/usr/bin/env tsx
// シミュレーションログを「面接 Q&A 形式」で確認できる単体 HTML ビューアを生成する。
// data/training/sim-sessions/**/rounds.json を全部読み、データを inline した
// 自己完結 HTML を 1 枚出力 (サーバ/DB 不要、ダブルクリックで開ける)。
//
//   npx tsx scripts/sim-viewer            # 既定の sim-sessions を読む
//   npx tsx scripts/sim-viewer --out foo.html

import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const ROOT = join(REPO_ROOT, 'data', 'training', 'sim-sessions');

type Turn = { turn_no: number; role: 'interviewer' | 'user'; text: string };
type Axes = Record<string, number>;
type RawRound = { round: number; style: string[]; turns: Turn[]; axes: Axes; comment: string; nextStyle: string };
type Raw = { args: { interviewer: string; examinee: string }; rounds: RawRound[] };

type QA = { q: string; a: string };
type Session = {
  interviewer: string;
  examinee: string;
  rounds: { round: number; style: string[]; qa: QA[]; axes: Axes; comment: string; nextStyle: string }[];
};

function walk(dir: string, out: string[]): void {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (e === 'rounds.json') out.push(p);
  }
}

/** turns を 面接官質問→受験者回答 の Q&A ペアに畳む。 */
function toQA(turns: Turn[]): QA[] {
  const qa: QA[] = [];
  for (let i = 0; i < turns.length; i++) {
    if (turns[i]!.role !== 'interviewer') continue;
    const a = turns[i + 1] && turns[i + 1]!.role === 'user' ? turns[i + 1]!.text : '';
    qa.push({ q: turns[i]!.text, a });
  }
  return qa;
}

function load(): Session[] {
  const files: string[] = [];
  try {
    walk(ROOT, files);
  } catch {
    return [];
  }
  const sessions: Session[] = [];
  for (const f of files) {
    let raw: Raw;
    try {
      raw = JSON.parse(readFileSync(f, 'utf8')) as Raw;
    } catch {
      continue;
    }
    if (!raw.rounds?.length) continue;
    sessions.push({
      interviewer: raw.args.interviewer,
      examinee: raw.args.examinee,
      rounds: raw.rounds.map((r) => ({
        round: r.round,
        style: r.style ?? [],
        qa: toQA(r.turns ?? []),
        axes: r.axes ?? {},
        comment: r.comment ?? '',
        nextStyle: r.nextStyle ?? '',
      })),
    });
  }
  sessions.sort((a, b) => (a.interviewer + a.examinee).localeCompare(b.interviewer + b.examinee));
  return sessions;
}

function render(sessions: Session[]): string {
  const data = JSON.stringify(sessions).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Tirocinium シミュレーション Q&A ビューア</title>
<style>
  :root{--bg:#0f1115;--panel:#171a21;--line:#2a2f3a;--fg:#e6e8ee;--muted:#9aa3b2;--accent:#5b8cff;--warn:#ff6b6b;}
  *{box-sizing:border-box} body{margin:0;font-family:system-ui,"Segoe UI",sans-serif;background:var(--bg);color:var(--fg);}
  header{padding:12px 16px;border-bottom:1px solid var(--line);display:flex;gap:12px;align-items:baseline}
  header h1{font-size:16px;margin:0} header .meta{color:var(--muted);font-size:13px}
  .wrap{display:grid;grid-template-columns:320px 1fr;height:calc(100vh - 49px)}
  .list{border-right:1px solid var(--line);overflow:auto}
  .list input{width:100%;padding:8px 10px;background:var(--panel);border:1px solid var(--line);color:var(--fg);border-radius:8px}
  .list .pad{padding:10px}
  .item{padding:8px 12px;border-bottom:1px solid var(--line);cursor:pointer}
  .item:hover{background:var(--panel)} .item.active{background:#1d2330;border-left:3px solid var(--accent)}
  .item .iv{font-weight:600} .item .ex{color:var(--muted);font-size:12px}
  .detail{overflow:auto;padding:16px}
  .round{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:14px;margin-bottom:16px}
  .round h2{margin:0 0 8px;font-size:15px}
  .style{background:#13202e;border:1px solid #1f3a52;border-radius:8px;padding:8px 10px;color:#bcd6f5;font-size:13px;white-space:pre-wrap}
  .qa{margin:10px 0}
  .q{background:#1b2230;border-radius:8px;padding:8px 10px;margin-top:8px}
  .a{padding:8px 10px;margin-top:4px;color:#dfe4ee}
  .q b{color:var(--accent)} .a b{color:#7ddf9a}
  .axes{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0}
  .ax{font-size:12px;background:#11151d;border:1px solid var(--line);border-radius:6px;padding:3px 8px}
  .ax i{font-style:normal;color:var(--muted)}
  .comment{color:var(--muted);font-size:13px;border-left:3px solid var(--line);padding-left:10px;white-space:pre-wrap}
  .next{margin-top:10px;font-size:13px} .next b{color:var(--warn)}
  .empty{color:var(--muted);padding:40px;text-align:center}
</style></head>
<body>
<header><h1>Tirocinium シミュレーション Q&A ビューア</h1><span class="meta" id="meta"></span></header>
<div class="wrap">
  <div class="list">
    <div class="pad"><input id="filter" placeholder="面接官 / 受験者 で絞り込み"></div>
    <div id="items"></div>
  </div>
  <div class="detail" id="detail"><div class="empty">左のセッションを選んでください</div></div>
</div>
<script>
const DATA = ${data};
const AX = ['consistency','clarity','demeanor','self_understanding','target_fit','depth_resilience'];
const esc = s => (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;');
document.getElementById('meta').textContent = DATA.length + ' セッション (各 ' + (DATA[0]?DATA[0].rounds.length:0) + ' ラウンド)';
let active = -1;
function renderList(q){
  const box = document.getElementById('items'); box.innerHTML='';
  DATA.forEach((s,i)=>{
    if(q && !(s.interviewer+' '+s.examinee).includes(q)) return;
    const d=document.createElement('div'); d.className='item'+(i===active?' active':'');
    d.innerHTML='<div class="iv">'+esc(s.interviewer)+'</div><div class="ex">'+esc(s.examinee)+'</div>';
    d.onclick=()=>{active=i;renderList(q);renderDetail(i);};
    box.appendChild(d);
  });
}
function bar(v){const n=Math.max(0,Math.min(5,v||0));return '★'.repeat(n)+'☆'.repeat(5-n);}
function renderDetail(i){
  const s=DATA[i]; const el=document.getElementById('detail');
  el.innerHTML = '<h2 style="margin:0 0 12px">'+esc(s.interviewer)+' <span style="color:#9aa3b2">×</span> '+esc(s.examinee)+'</h2>' +
    s.rounds.map(r=>{
      const qa = r.qa.map(p=>'<div class="qa"><div class="q"><b>Q.</b> '+esc(p.q)+'</div>'+(p.a?'<div class="a"><b>A.</b> '+esc(p.a)+'</div>':'')+'</div>').join('');
      const axes = AX.map(a=>'<span class="ax"><i>'+a.slice(0,12)+'</i> '+bar(r.axes[a])+'</span>').join('');
      const style = r.style.length ? '<div class="style"><b>この回の聞き方:</b>\\n'+esc(r.style.join('\\n'))+'</div>' : '<div class="style">初回: 素の面接官</div>';
      return '<div class="round"><h2>Round '+r.round+'</h2>'+style+qa+
        '<div class="axes">'+axes+'</div>'+
        '<div class="comment">'+esc(r.comment)+'</div>'+
        '<div class="next"><b>→ 次の聞き方:</b> '+esc(r.nextStyle)+'</div></div>';
    }).join('');
  el.scrollTop=0;
}
document.getElementById('filter').addEventListener('input', e=>renderList(e.target.value.trim()));
renderList('');
</script>
</body></html>`;
}

function main() {
  const args = process.argv.slice(2);
  const oi = args.indexOf('--out');
  const out = oi >= 0 && args[oi + 1] ? args[oi + 1]! : join(ROOT, 'sim-viewer.html');
  const sessions = load();
  writeFileSync(out, render(sessions));
  console.log(`[viewer] ${sessions.length} sessions → ${out}`);
}

main();
