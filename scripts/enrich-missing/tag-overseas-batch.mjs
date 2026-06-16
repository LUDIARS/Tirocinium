/**
 * 明らかな海外企業を一括タグ付けする
 */
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(join(__dir, '../../data/tirocinium.sqlite'));

/** [企業名, 国/地域, 備考] */
const OVERSEAS = [
  // 北米
  ['Aksys Games',               'アメリカ', 'カリフォルニア州のローカライズパブリッシャー'],
  ['NISアメリカ',               'アメリカ', 'NIS America (日本一ソフトウェアの米国子会社)'],
  ['THQ',                       'アメリカ', '2013年倒産。THQ Nordicに買収'],
  ['Xseed Games',               'アメリカ', 'XSEED Games (Marvelous USA)'],
  ['アクティビジョン',          'アメリカ', 'Activision Blizzard'],
  ['Xbox Game Studios',         'アメリカ', 'Microsoft Games Studios'],
  ['アトラスUSA',               'アメリカ', 'Atlus USA (アトラスの米国子会社)'],
  ['アタリ',                    'アメリカ', 'Atari Inc.'],
  ['エレクトロニック・アーツ', 'アメリカ', 'Electronic Arts (EA)'],
  ['Aspyr',                     'アメリカ', 'Aspyr Media (テキサス州)'],
  ['ヴァルヴ・コーポレーション','アメリカ', 'Valve Corporation (ワシントン州)'],
  ['JAST USA',                  'アメリカ', '成人向けゲーム米国パブリッシャー'],
  ['ルーカスアーツ',            'アメリカ', 'LucasArts。2013年解散'],
  ['ヴィシャス・サイクル・ソフトウェア','アメリカ','Vicious Cycle Software (クローズ)'],
  ['Crave Entertainment',       'アメリカ', '米国のゲームパブリッシャー (解散済み)'],
  ['アクレイム・エンタテインメント','アメリカ','Acclaim Entertainment。2004年倒産'],
  ['ハイボルテージソフトウェア','アメリカ', 'High Voltage Software (イリノイ州)'],
  ['LJN',                       'アメリカ', 'LJN Toys。現在はMattelのブランド'],
  ['ディズニー・インタラクティブ・スタジオ','アメリカ','Disney Interactive Studios (閉鎖2016年)'],
  ['ベセスダ・ソフトワークス',  'アメリカ', 'Bethesda Softworks (メリーランド州)'],
  // 欧州
  ['ユービーアイソフト',        'フランス', 'Ubisoft Entertainment SA'],
  ['505 Games',                 'イタリア', 'ミラノ本社のパブリッシャー'],
  ['PQube',                     'イギリス', 'PQube Ltd (ロンドン)'],
  ['U.S. Gold',                 'イギリス', 'US Gold (バーミンガム)。1997年解散'],
  ['Midas Interactive Entertainment','イギリス','Midas Interactive (解散)'],
  ['アイドス',                  'イギリス', 'Eidos Interactive。2009年Square Enixに買収'],
  ['SCEスタジオ・リバプール',   'イギリス', 'Studio Liverpool。2012年SIEが閉鎖'],
  ['ロンドンスタジオ',          'イギリス', 'SIE London Studio。2023年閉鎖'],
  ['Deep Silver',               'ドイツ',  'Deep Silver (Koch Media/PLAION)'],
  ['ゲリラゲームズ',            'オランダ', 'Guerrilla Games (アムステルダム)'],
  ['Bitwave Games',             'スウェーデン','スウェーデンのパブリッシャー'],
  ['Alawar Entertainment',      'ロシア',   'Alawar Entertainment'],
  // アジア
  ['Eastasiasoft',              '香港',    'Hong Kong のインディーパブリッシャー'],
  // 未確認 → 調査で判明したら追加
  ['アイディアファクトリーインターナショナル','アメリカ','Idea Factory International (カリフォルニア州)'],
];

function addTag(id, tag) {
  const row = db.prepare('SELECT tags FROM companies WHERE id = ?').get(id);
  const cur = JSON.parse(row.tags || '[]');
  if (!cur.includes(tag)) {
    cur.push(tag);
    db.prepare(`UPDATE companies SET tags = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(JSON.stringify(cur), id);
  }
}

function appendReason(id, note) {
  const row = db.prepare('SELECT stock_reason FROM companies WHERE id = ?').get(id);
  const cur = row.stock_reason || '';
  const next = cur ? cur + ' | ' + note : note;
  db.prepare(`UPDATE companies SET stock_reason = ?, updated_at = datetime('now') WHERE id = ?`)
    .run(next, id);
}

let tagged = 0, notFound = 0;
for (const [name, country, note] of OVERSEAS) {
  const row = db.prepare(`SELECT id FROM companies WHERE name = ?`).get(name);
  if (!row) { console.log(`NOT FOUND: ${name}`); notFound++; continue; }
  addTag(row.id, '海外企業');
  appendReason(row.id, `${country}の企業。${note}`);
  console.log(`✓ 海外企業: ${name} (${country})`);
  tagged++;
}

// 残り件数を確認
const remaining = db.prepare(`
  SELECT COUNT(*) AS n FROM companies c
  WHERE c.description = ''
    AND EXISTS (SELECT 1 FROM company_game cg WHERE cg.company_id = c.id)
    AND c.tags NOT LIKE '%個人企業%'
    AND c.tags NOT LIKE '%海外企業%'
`).get().n;

console.log(`\n完了: ${tagged}社に海外企業タグ付与 / 未発見: ${notFound}社`);
console.log(`残り未処理: ${remaining}社`);
db.close();
