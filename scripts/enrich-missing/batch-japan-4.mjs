import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dir = dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(join(__dir, '../../data/tirocinium.sqlite'));

function addTag(id, tag) {
  const row = db.prepare('SELECT tags FROM companies WHERE id = ?').get(id);
  const cur = JSON.parse(row.tags || '[]');
  if (!cur.includes(tag)) { cur.push(tag); db.prepare(`UPDATE companies SET tags=?, updated_at=datetime('now') WHERE id=?`).run(JSON.stringify(cur), id); }
}
function update(name, fields) {
  const row = db.prepare('SELECT id, url, description, stock_reason, tags FROM companies WHERE name=?').get(name);
  if (!row) { console.log(`NOT FOUND: ${name}`); return; }
  const sets = ["updated_at = datetime('now')"];
  const params = [];
  if (fields.url && !row.url) { sets.push('url=?'); params.push(fields.url); }
  if (fields.description && !row.description) { sets.push('description=?'); params.push(fields.description); }
  if (fields.location) { sets.push('location=?'); params.push(fields.location); }
  if (fields.reason) {
    const cur = row.stock_reason || '';
    if (!cur.includes(fields.reason.slice(0,20))) {
      sets.push('stock_reason=?'); params.push(cur ? cur + ' | ' + fields.reason : fields.reason);
    }
  }
  if (fields.tag) { addTag(row.id, fields.tag); }
  params.push(row.id);
  if (sets.length > 1) db.prepare(`UPDATE companies SET ${sets.join(', ')} WHERE id=?`).run(...params);
  console.log(`✓ ${name}`);
}

// 海外
update('Metro3D', { tag: '海外企業', reason: 'Metro3D。R-TYPE FINAL/King\'s Field IV等を北米でパブリッシュした米国のゲームパブリッシャー。' });

// アクティブ日本企業
update('アリスソフト', {
  url: 'https://alicesoft.com/',
  description: 'ランスシリーズ/ドーナドーナ いっしょにわるいことをしようで知られる成人向けゲームメーカー。1990年創業。SRPGとADVを組み合わせた独自の作風で根強いファン層を持つ。',
  location: '東京',
});
update('オーバーフロー', {
  description: 'School Daysシリーズのビジュアルノベルとゲームを制作した日本のゲームスタジオ。アニメ化されたSchool Daysの衝撃的な展開で知られる。',
  reason: 'School Days/Summer Days等を開発したスタジオ。現在は活動確認できず。',
});
update('プロペ', {
  url: 'https://www.prope.jp/',
  description: 'IVY THE KIWI?等を制作した中裕司氏(旧セガ)のゲームスタジオ。Wiiリモコンを活用したゲームデザインで知られる。',
  location: '東京',
});
update('千代丸スタジオ', {
  description: 'ANONYMOUS;CODEやシュタインズ・ゲート等の科学アドベンチャーシリーズに関連するゲームスタジオ。千代丸氏(志倉千代丸)が主宰。',
  location: '東京',
});
update('花梨エンターテイメント', {
  description: '英国探偵ミステリアシリーズ等の女性向けアドベンチャーゲームを制作する日本のゲームスタジオ。',
  location: '日本',
});
update('コットンソフト', {
  description: 'ナツメグシリーズ等のビジュアルノベルを制作する日本の成人向けゲームブランド。',
});
update('ウルクスヘブン', {
  description: 'Fragment\'s Noteシリーズ等のビジュアルノベルを制作する日本のゲームブランド。',
});
update('エウシュリー', {
  description: '百千の定にかわたれし剋等のRPG/ビジュアルノベルを制作する日本の成人向けゲームブランド。独自の世界観とシステムで知られる。',
  location: '日本',
});
update('エスクード', {
  description: '姫と穢欲のサクリファイス等の成人向けゲームを制作する日本のゲームブランド。',
});
update('リトルウイッチ', {
  description: '少女魔法学リトルウィッチロマネスク等のビジュアルノベルを制作した日本のゲームブランド。',
  reason: '現在は実質活動停止状態と見られる。',
});
update('minori', {
  description: 'ef - a fairy tale of the two/Eden*等の高品質なビジュアルノベルで知られた日本のゲームブランド。',
  reason: '2019年にサービス終了・解散。HPなし。',
});
update('角川書店', {
  reason: '株式会社角川書店。KADOKAWAグループの出版部門。KILLER IS DEAD等はKADOKAWA Gamesブランドで出版。現在はKADOKAWA株式会社に統合。出版社としての採用のみ。',
});
update('スタジオ最前線', {
  description: 'コットンロックンロール: SUPERLATIVE NIGHT DREAMS等を手がける日本のゲームスタジオ。',
  location: '日本',
});
update('システムソフト・アルファー', {
  description: 'アドバンスド大戦略シリーズ等の本格ウォーシミュレーションゲームを専門とする日本のゲームメーカー。軍事シミュレーションジャンルの老舗。',
  location: '愛知',
});
update('ランカース', {
  description: 'Monarch/カードファイト!! ヴァンガード ディアデイズ等のRPGを手がける日本のゲームデベロッパー。アトラス系の仕事も多数。',
  location: '日本',
});
update('カバー株式会社', {
  url: 'https://cover-corp.com/recruit/',
  description: 'ホロライブプロダクションを運営するVTuber事務所兼ゲーム企業。hololive Dreams等のゲームタイトルも開発・展開する。東京。',
  location: '東京',
});
update('アテナ', {
  reason: '株式会社アテナ(Athena Co., Ltd.)。ファミリークイズ等を開発した日本のゲームメーカー。解散済み。HPなし。',
});
update('アルトロン', {
  reason: 'Altron Corporation。SIMPLE DSシリーズ等の受託開発を手がけた日本のゲームメーカー。解散済み。HPなし。',
});
update('イグニッション・エンターテイメント', {
  reason: 'Ignition Entertainment。レッドシーズプロファイル等を欧米でパブリッシュした英国のゲームパブリッシャー。2014年頃解散。HPなし。',
  tag: '海外企業',
});
update('エイジ', {
  reason: '株式会社エイジ(Age Co., Ltd.)。韓国オンラインゲーム等の日本展開に関与した会社の可能性あり。詳細不明。HPなし。',
});
update('フォグ', {
  description: '風雨来記シリーズ等のロードノベル体験型アドベンチャーゲームを制作してきた日本のゲームメーカー。',
  location: '日本',
});

const remaining = db.prepare(`SELECT COUNT(*) AS n FROM companies c
  WHERE c.description = '' AND (c.stock_reason IS NULL OR c.stock_reason = '')
    AND EXISTS (SELECT 1 FROM company_game cg WHERE cg.company_id = c.id)
    AND c.tags NOT LIKE '%個人企業%' AND c.tags NOT LIKE '%海外企業%'`).get().n;
console.log(`\nreason未記入かつdescription空の残り: ${remaining}件`);
db.close();
