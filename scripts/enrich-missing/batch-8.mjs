import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(join(__dir, '../../data/tirocinium.sqlite'));

function addTag(id, tag) {
  const row = db.prepare('SELECT id, tags FROM companies WHERE id = ?').get(id);
  if (!row) { console.log(`NOT FOUND id: ${id}`); return; }
  const cur = JSON.parse(row.tags || '[]');
  if (!cur.includes(tag)) { cur.push(tag); db.prepare(`UPDATE companies SET tags=?, updated_at=datetime('now') WHERE id=?`).run(JSON.stringify(cur), id); }
}
function appendReason(id, note) {
  const row = db.prepare('SELECT id, stock_reason FROM companies WHERE id = ?').get(id);
  if (!row) { return; }
  const cur = row.stock_reason || '';
  if (!cur.includes(note.slice(0, 20))) {
    db.prepare(`UPDATE companies SET stock_reason=?, updated_at=datetime('now') WHERE id=?`).run(cur ? cur + ' | ' + note : note, id);
  }
}
function findId(name) {
  return db.prepare('SELECT id FROM companies WHERE name=?').get(name)?.id;
}
function tagOverseas(name, note) {
  const id = findId(name);
  if (!id) { console.log(`NOT FOUND: ${name}`); return; }
  addTag(id, '海外企業');
  if (note) appendReason(id, note);
  console.log(`✓ 海外: ${name}`);
}
function addDesc(name, fields) {
  const row = db.prepare('SELECT id, description, url, stock_reason FROM companies WHERE name=?').get(name);
  if (!row) { console.log(`NOT FOUND: ${name}`); return; }
  const sets = ["updated_at = datetime('now')"];
  const params = [];
  if (fields.description && !row.description) { sets.push('description=?'); params.push(fields.description); }
  if (fields.url && !row.url) { sets.push('url=?'); params.push(fields.url); }
  if (fields.location) { sets.push('location=?'); params.push(fields.location); }
  if (fields.reason) {
    const cur = row.stock_reason || '';
    if (!cur.includes(fields.reason.slice(0, 20))) {
      sets.push('stock_reason=?'); params.push(cur ? cur + ' | ' + fields.reason : fields.reason);
    }
  }
  params.push(row.id);
  if (sets.length > 1) db.prepare(`UPDATE companies SET ${sets.join(', ')} WHERE id=?`).run(...params);
  console.log(`✓ desc: ${name}`);
}

// 海外企業
tagOverseas('ハウスマーク', 'Housemarque Oy。Dead Nation/Returnal等を開発したフィンランドの著名ゲームデベロッパー。SIE第一パーティー。');
tagOverseas('トレコ', 'Treco Corp.。Growl/エル・ヴィエントを北米でパブリッシュした米国のゲームパブリッシャー(東映系)。');
tagOverseas('シルバーボール・スタジオ', 'Silverball Studios Ltd.。スーパーマリオボール(GBA)等のピンボール系ゲームを開発した英国のゲームスタジオ。');

// アクティブ / 解散日本企業
addDesc('ヘクト (ゲーム会社)', {
  description: '株式会社ヘクト(Hect Co., Ltd.)。ゴルフゲームやスポーツゲームを中心に家庭用ゲームソフトを発売した日本のゲームパブリッシャー。',
  reason: '現在は実質活動停止、HPなし。',
});
addDesc('データム・ポリスター', {
  description: '株式会社データム・ポリスター(Datam Polystar)。魔剣道シリーズやグラディウス外伝等を手がけた日本のゲームパブリッシャー。音楽ソフトも展開。',
  reason: '現在は解散/廃業。',
});
addDesc('ニンジャスタジオ', {
  description: '株式会社ニンジャスタジオ(Ninja Studio Inc.)。降魔霊符伝イヅナシリーズ等の和風アクションRPGを開発した日本のゲームデベロッパー。',
  location: '日本',
});
addDesc('テンキー', {
  description: '株式会社テンキー(10key Inc.)。蟲師やオトメイトIPのモバイルゲームを開発した日本のゲームデベロッパー。',
  location: '日本',
});
addDesc('小学館', {
  url: 'https://www.shogakukan.co.jp/',
  description: '株式会社小学館(Shogakukan Inc.)。コロコロコミック等を発行する日本の大手出版社。ドラえもん/ポケモン等のIPゲーム版権管理元。',
  location: '東京',
});
addDesc('データソフト', {
  description: 'データソフト(Datasoft)。エンジェルナイト等の成人向けアドベンチャーゲームを手がけた日本のゲームブランド。',
  reason: '現在は活動停止、HPなし。',
});
addDesc('クレアテック', {
  description: 'クレアテック株式会社(Cleartech Co., Ltd.)。メタルサーガ等のRPGに開発で携わった日本のゲームデベロッパー。',
});
addDesc('トムキャットシステム', {
  description: '株式会社トムキャットシステム(Tomcat System)。爆弾処理班等の日本語アドベンチャーゲームを制作した日本のゲームデベロッパー。',
});
addDesc('水口エンジニアリング', {
  description: '水口エンジニアリング株式会社。ヒットラーの復活等のMSX/ファミコン向けゲームを手がけた日本のゲームデベロッパー。',
  reason: '現在は解散/廃業。HPなし。',
});
addDesc('空想科学', {
  description: '空想科学。上海IIIシリーズ等のパズルゲームを展開した日本のゲームブランド。',
});
addDesc('株式会社アメディオ', {
  description: '株式会社アメディオ(Amedio Co., Ltd.)。D3パブリッシャーのSIMPLEシリーズ等を受託開発した日本のゲームデベロッパー。',
});
addDesc('ロジック', {
  description: 'ロジック(Logic Corp.)。鈴木亜久里のF1スーパードライビング等のPC向けゲームを発売した日本のゲームパブリッシャー。',
});
addDesc('Dice Co., Ltd.', {
  description: '株式会社ダイス(Dice Co., Ltd.)。ファミコン向けゲームソフトを発売した日本のゲームパブリッシャー。',
  reason: '現在は解散/廃業。HPなし。',
});
addDesc('Toka', {
  description: '株式会社トカ(Toka Co., Ltd.)。スカイサーファー等のアクションゲームを制作した日本のゲームデベロッパー。',
  reason: '現在は解散/廃業。HPなし。',
});
addDesc('ザウルス', {
  description: 'ザウルス。クイズKOF等のアーケードゲーム関連タイトルに携わった日本の企業。',
});
addDesc('フィクションズ', {
  description: 'フィクションズ(Fictions)。PC-98等向けの成人向けアドベンチャーゲームを制作した日本のゲームブランド。',
  reason: '現在は活動停止。HPなし。',
});

const remaining = db.prepare(`SELECT COUNT(*) AS n FROM companies c
  WHERE c.description = '' AND (c.stock_reason IS NULL OR c.stock_reason = '')
    AND EXISTS (SELECT 1 FROM company_game cg WHERE cg.company_id = c.id)
    AND c.tags NOT LIKE '%個人企業%' AND c.tags NOT LIKE '%海外企業%'`).get().n;
console.log(`\nreason未記入かつdescription空の残り: ${remaining}件`);
db.close();
