/**
 * 解散済み・統合済み・内部部署・ブランドなど
 * 「採用できない理由」が確実にわかっている日本企業を一括で stock_reason に記録する。
 * description は空のまま (情報なし=現状ママ)。
 */
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(join(__dir, '../../data/tirocinium.sqlite'));

/**
 * [企業名, stock_reason に追記するノート]
 * 解散済み / 統合済み / 内部部署 / ブランド
 */
const KNOWN_STATUS = [
  // ===== 解散・統合済み (HP なし) =====
  ['ナムコ',          '2006年バンダイと経営統合しバンダイナムコエンターテインメントへ。独立会社は解散済み。HPなし。'],
  ['ハドソン',        '2012年コナミデジタルエンタテインメントに吸収合併・解散。HPなし。'],
  ['スクウェア',      '2003年エニックスと合併しスクウェア・エニックス設立。独立会社は解散済み。HPなし。'],
  ['エニックス',      '2003年スクウェアと合併しスクウェア・エニックス設立。独立会社は解散済み。HPなし。'],
  ['彩京',            '2003年解散。格闘ゲームIPはアリカ等に売却。HPなし。'],
  ['東亜プラン',      '1994年倒産・解散。シューティングゲームの名門。HPなし。'],
  ['Marvelous Entertainment', '2011年マーベラスAQLへ統合。2014年Marvelous Inc.として再編。独立会社は解散済み。HPなし。'],
  ['コーエー',        '2009年テクモと経営統合しコーエーテクモホールディングスへ。ゲーム開発はコーエーテクモゲームスが継承。HPなし。'],
  ['テクモ',          '2009年コーエーと経営統合しコーエーテクモホールディングスへ。独立会社は解散済み。HPなし。'],
  ['スパイク',        '2012年チュンソフトと合併しスパイク・チュンソフト設立。独立会社は解散済み。HPなし。'],
  ['5pb.',            '2015年MAGES.に社名変更。独立ブランドとして5pb.は消滅。HPなし。'],
  ['アスキー',        'アスキーメディアワークスを経てKADOKAWAグループに吸収。ゲーム事業は継承されず。HPなし。'],
  ['タカラ',          '2006年トミーと合併しタカラトミー設立。玩具事業はタカラトミーへ、ゲーム部門は終了。HPなし。'],
  ['テクノスジャパン','1996年倒産・解散。ダブルドラゴン等で著名。HPなし。'],
  ['バンプレスト',    'バンダイナムコのキャラクター玩具ブランド。2020年バンダイスピリッツに業務移管。独立会社なし。HPなし。'],
  ['バンダイナムコホールディングス', '持株会社。ゲーム開発・採用はバンダイナムコエンターテインメント等の事業会社経由。'],
  ['ジャレコ',        '複数回の会社変更・解散を経て実質消滅。HP確認不可。HPなし。'],
  ['アゲテック',      '旧アガツマエンタテインメント。事業縮小・解散済み。HPなし。'],
  ['戯画',            '成人向けゲームブランド。マーベラス傘下入り後ブランド終了。HPなし。'],
  ['NMK',             '日本ミコム開発 (NMK)。1994年頃倒産・解散。HPなし。'],
  ['テイジイエル',    'TGL (Takeda Game Lab)。成人向けゲームメーカー。解散済み。HPなし。'],
  ['ゴッチテクノロジー', 'ナムコ関連の開発会社。詳細不明、現存確認できず。HPなし。'],
  ['アルケミスト',    '成人向けゲームパブリッシャー。経営状態悪化、実質活動停止。HPなし。'],
  ['日本物産',        '旧ニチブツ。アーケードゲームの名門。倒産・解散済み。HPなし。'],
  ['アクアプラス',    'HIKE Inc. 傘下の成人向けゲームブランド。URL更新済み。'],

  // ===== 内部部署 / 内製スタジオ (採用は親会社経由) =====
  ['任天堂情報開発本部', '任天堂の内部開発部門 (旧EAD)。現在はNintendo EPDに再編。独立採用なし、任天堂経由。'],
  ['任天堂開発第一部',   '任天堂の内部開発部門 (旧R&D1)。現在はNintendo EPDに統合。独立採用なし。'],
  ['任天堂企画制作本部', '任天堂の内部開発部門 (旧SPD)。現在はNintendo EPDに統合。独立採用なし。'],
  ['任天堂企画開発本部', '任天堂の内部部門 (IRD)。独立採用なし、任天堂経由。'],
  ['ソニックチーム',     'セガの内部開発チーム (ソニックシリーズ担当)。独立法人ではない。採用はセガ経由。'],
  ['オメガフォース',     'コーエーテクモゲームスの内部スタジオ (無双シリーズ担当)。独立法人ではない。'],
  ['ナムコ・テイルズスタジオ', 'バンダイナムコの内部スタジオ。後にテイルズ オブ スタジオに改名・統合。独立法人ではない。'],
  ['パワプロプロダクション', 'コナミデジタルエンタテインメントの内部チーム (実況パワフルプロ野球担当)。独立法人ではない。'],
  ['ジャパンスタジオ',   'SIEジャパンスタジオ。2021年3月に閉鎖。HPなし。'],

  // ===== ブランド (別会社が実体) =====
  ['オトメイト',  'アイディアファクトリーの乙女ゲームブランド。独立法人ではない。採用はアイディアファクトリー経由。'],
  ['ガスト',      'コーエーテクモゲームスのアトリエシリーズブランド。独立法人ではない。採用はコーエーテクモゲームス経由。'],
  ['Leaf',        'アクアプラスの成人向けゲームブランド。独立法人ではない。採用はアクアプラス経由。'],
];

function appendReason(id, note) {
  const row = db.prepare('SELECT stock_reason FROM companies WHERE id = ?').get(id);
  const cur = row.stock_reason || '';
  if (cur.includes(note.slice(0, 20))) return; // 重複回避
  const next = cur ? cur + ' | ' + note : note;
  db.prepare(`UPDATE companies SET stock_reason = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(next, id);
}

let updated = 0, notFound = 0;
for (const [name, note] of KNOWN_STATUS) {
  const row = db.prepare('SELECT id, tags FROM companies WHERE name = ?').get(name);
  if (!row) { console.log(`NOT FOUND: ${name}`); notFound++; continue; }
  const tags = JSON.parse(row.tags || '[]');
  if (tags.includes('海外企業') || tags.includes('個人企業')) {
    console.log(`SKIP (already tagged): ${name}`);
    continue;
  }
  appendReason(row.id, note);
  console.log(`✓ 記録: ${name}`);
  updated++;
}

const remaining = db.prepare(`
  SELECT COUNT(*) AS n FROM companies c
  WHERE c.description = ''
    AND EXISTS (SELECT 1 FROM company_game cg WHERE cg.company_id = c.id)
    AND c.tags NOT LIKE '%個人企業%'
    AND c.tags NOT LIKE '%海外企業%'
`).get().n;

console.log(`\n完了: ${updated}社記録 / 未発見: ${notFound}社`);
console.log(`残り未処理 (descriptionなし): ${remaining}社`);
db.close();
