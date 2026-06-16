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
function appendReason(id, note) {
  const row = db.prepare('SELECT stock_reason FROM companies WHERE id = ?').get(id);
  const cur = row.stock_reason || '';
  if (cur.includes(note.slice(0,20))) return;
  db.prepare(`UPDATE companies SET stock_reason=?, updated_at=datetime('now') WHERE id=?`).run(cur ? cur + ' | ' + note : note, id);
}
function findId(name) { const r = db.prepare('SELECT id FROM companies WHERE name=?').get(name); return r ? r.id : null; }
function doTag(name, country, note) {
  const id = findId(name);
  if (!id) { console.log(`NOT FOUND: ${name}`); return; }
  addTag(id, '海外企業');
  appendReason(id, `${country}の企業。${note}`);
  console.log(`✓ 海外: ${name}`);
}
function doNote(name, text) {
  const id = findId(name);
  if (!id) { console.log(`NOT FOUND: ${name}`); return; }
  appendReason(id, text);
  console.log(`✓ 記録: ${name}`);
}
function doDesc(name, desc, loc) {
  const row = db.prepare('SELECT id, description FROM companies WHERE name=?').get(name);
  if (!row) { console.log(`NOT FOUND: ${name}`); return; }
  const sets = ["updated_at = datetime('now')"];
  const params = [];
  if (desc && !row.description) { sets.push('description=?'); params.push(desc); }
  if (loc) { sets.push('location=?'); params.push(loc); }
  params.push(row.id);
  if (sets.length > 1) db.prepare(`UPDATE companies SET ${sets.join(', ')} WHERE id=?`).run(...params);
  console.log(`✓ desc: ${name}`);
}

// 海外企業
doTag('Conspiracy Entertainment(コンスピラシー・エンタテインメント)', 'アメリカ', 'Conspiracy Entertainment。たころん等のライセンスゲームを展開した米国パブリッシャー。');
doTag('Nacon', 'フランス', 'Nacon (旧Bigben Interactive)。ドカポンキングダム等を展開するフランスのゲームパブリッシャー。');
doTag('Namco Bandai Games Europe SAS', 'フランス', 'Bandai Namco Europeの旧社名。聖闘士星矢等の欧州パブリッシング担当。');
doTag('Namco Hometek Inc.', 'アメリカ', 'Namco Hometek Inc.。バンダイナムコの米国子会社。パックマン等の北米パブリッシング担当。');
doTag('Neko Entertainment', 'フランス', 'Neko Entertainment。Super Army War等を開発したフランスのゲームスタジオ。');
doTag('Nerve Software', 'アメリカ', 'Nerve Software。Wolfenstein 3D等のコンバージョンを手がけた米国スタジオ。');
doTag('Nexon Europe', 'ルクセンブルク', 'Nexon Europe。Counter-Strike Nexon等を欧州でサービスしたNexonの欧州法人。');
doTag('Next Level Games', 'カナダ', 'Next Level Games。マリオストライカーズシリーズを開発したカナダのスタジオ。任天堂に買収。');
doTag('Nicalis', 'アメリカ', 'Nicalis。洞窟物語3D等の日本インディーゲームを北米でパブリッシュした米国のゲーム会社。');
doTag('Nintendo Australia', 'オーストラリア', 'Nintendo Australia。任天堂のオーストラリア子会社。地域パブリッシング担当。独立採用なし。');
doTag('Nobilis', 'フランス', 'Nobilis。フランスのゲームパブリッシャー。');
doTag('Onion Soup Interactive', 'イギリス', 'Onion Soup Interactive。Nippon Marathon等を開発したスコットランドの小規模スタジオ。');
doTag('Other Ocean', 'カナダ', 'Other Ocean。Yu-Gi-Oh!等のゲーム移植を手がけた米国/カナダのスタジオ。');
doTag('Phoenix Studio', 'アメリカ', 'Phoenix Studio。ライセンスゲームを開発した米国スタジオ。');
doTag('Psygnosis', 'イギリス', 'Psygnosis。ヴァンパイアハンター等を欧州でパブリッシュした英国のゲームメーカー。1999年SIEに吸収。後のSCEスタジオ・リバプール。');
doTag('QLOC', 'ポーランド', 'QLOC。ゴッドイーター2等のゲーム移植を専門とするポーランドのスタジオ。');
doTag('Queasy Games', 'カナダ', 'Queasy Games。Everyday Shooterを開発したカナダのインディースタジオ。');
doTag('Renovation Products', 'アメリカ', 'Renovation Products。アローフラッシュ等をGenesis向けに展開した米国パブリッシャー。');
doTag('Rival Games', 'フィンランド', 'Rival Games。Alien: Blackout等を開発したフィンランドのスタジオ。');
doTag('SSI (アメリカ合衆国のゲーム会社)', 'アメリカ', 'Strategic Simulations Inc. (SSI)。Eye of the Beholder等の米国のRPGゲームメーカー。Ubisoft傘下後解散。');
doTag('Shanda', '中国', 'Shanda Games。メイプルストーリー等をサービスした中国のゲーム会社。');
doTag('Skybound Games', 'アメリカ', 'Skybound Games。Skullgirls等のインディーゲームを展開した米国のゲームパブリッシャー。');
doTag('Sony Imagesoft', 'アメリカ', 'Sony Imagesoft。ESPN Hockey Night等のゲームをパブリッシュした米国ソニーのゲームレーベル。');
doTag('Storm', 'イギリス', 'Storm Software。妖精物語ロッドランド等の英国ゲームメーカー。');
doTag('Studio 33', 'イギリス', 'Studio 33 (Psygnosis系)。デストラクション・ダービーシリーズを開発した英国スタジオ。');
doTag('THQ Nordic', 'スウェーデン/オーストリア', 'THQ Nordic。AEW等のゲームを多数パブリッシュするスウェーデン/オーストリアの大手ゲームパブリッシャー。');
doTag('THQ Studio Australia', 'オーストラリア', 'THQ Studio Australia。Avatar等のゲームを開発したTHQのオーストラリアスタジオ。');
doTag('TX Digital Illusions', 'スウェーデン', 'TX Digital Illusions (DICE前身)。Sub Battle Simulator等を開発したスウェーデンのスタジオ。');
doTag('Take-Two Licensing', 'アメリカ', 'Take-Two Licensing。Take-Two InteractiveのIPライセンスを管理する部門。ゲーム開発は行わない。');
doTag('Tarsier Studios', 'スウェーデン', 'Tarsier Studios。Little Nightmaresシリーズを開発したスウェーデンのゲームスタジオ。');
doTag('Team17', 'イギリス', 'Team17。Wormsシリーズ等を開発・パブリッシュする英国のゲームスタジオ。');
doTag('Tiertex Design Studios', 'イギリス', 'Tiertex Design Studios。スター・ウォーズ等のライセンスゲームを開発した英国スタジオ。');
doTag('Torus Games', 'オーストラリア', 'Torus Games。ガーディアンズ等のライセンスゲームを開発したオーストラリアのスタジオ。');
doTag('UserJoy Technology', '台湾', 'UserJoy Technology (遊戲橘子)。英雄伝説 暁の軌跡を台湾でサービスした台湾のゲーム会社。');
doTag('Vblank Entertainment', 'カナダ', 'Vblank Entertainment。Retro City Rampage等のレトロスタイルゲームを開発したカナダのインディースタジオ。');
doTag('Volatile Games', 'オーストラリア', 'Volatile Games。Dead to Rights: Retributionを開発したオーストラリアのスタジオ。');
doTag('Wahoo Studios', 'アメリカ', 'Wahoo Studios。Space Station Tycoon等を開発した米国スタジオ。');
doTag('Walt Disney Imagineering', 'アメリカ', 'Walt Disney Imagineering。GT 64等の一部ゲーム開発に関与した米国ディズニーの研究開発部門。ゲーム開発採用外。');
doTag('Westwood', 'アメリカ', 'Westwood Studios。Eye of the Beholder/Command & Conquerシリーズを開発した米国スタジオ。2003年EA傘下で閉鎖。');
doTag('WildWorks', 'アメリカ', 'WildWorks。子ども向けオンラインゲームを開発した米国スタジオ。');
doTag('Wizet', '韓国', 'Wizet。MapleStory原版を開発した韓国のゲームスタジオ。Nexon傘下。');
doTag('XS Games', 'アメリカ', 'XS Games。子ども向けゲームをパブリッシュした米国のゲームメーカー。');
doTag('Xicat Interactive', 'アメリカ', 'Xicat Interactive。釣りゲーム等をパブリッシュした米国のゲームメーカー。');
doTag('ZlonGame', '韓国', 'ZlonGame。Counter:Side等を開発した韓国のゲームスタジオ。');
doTag('Zushi Games', 'スペイン', 'Zushi Games。シムシティ2000等をパブリッシュしたスペインのゲームパブリッシャー。');
doTag('cdp.pl', 'ポーランド', 'cdp.pl。ウィッチャー2等を展開したCD ProjektのEコマース/流通部門。');
doTag('ngmoco', 'アメリカ', 'ngmoco (DeNA subsidiary)。モバイルゲームを展開した米国のゲームスタジオ。DeNA傘下。');
doTag('アタリSA', 'フランス', 'Atari SA。みんなで遊ぼう!ナムコカーニバルを展開したフランスのゲームパブリッシャー（旧Infogrames）。');
doTag('アンサンブルスタジオ', 'アメリカ', 'Ensemble Studios。エイジ オブ エンパイアシリーズを開発したMicrosoft傘下の米国スタジオ。2009年解散。');
doTag('アーマチュアスタジオ', 'アメリカ', 'Armature Studio。メタルギア ソリッドHD等を開発した米国スタジオ。Retro Studios出身者設立。');
doTag('インコグニート', 'アメリカ', 'Incognito Entertainment。Twisted Metal: Blackを開発した米国スタジオ。SIE傘下。2009年閉鎖。');
doTag('ウォルト・ディズニー・ジャパン', 'アメリカ', 'Walt Disney Japan (ウォルト・ディズニー・ジャパン)。ディズニーの日本法人。ツイステッドワンダーランド等のパブリッシャー。ゲーム開発採用外。');
doTag('エキシディ', 'アメリカ', 'Exidy Inc.。Fax等の旧アーケードゲームを開発した米国の旧ゲームメーカー。1999年閉鎖。');
doTag('オブシディアン・エンターテインメント', 'アメリカ', 'Obsidian Entertainment。ダンジョン・シージIII等のRPGを開発した米国スタジオ。Xbox Game Studios傘下。');
doTag('オペラ・ソフトウェア', 'ノルウェー', 'Opera Software。ニンテンドーDSブラウザーを提供したノルウェーのブラウザメーカー。ゲーム開発採用外。');
doTag('オライオン・ピクチャーズ', 'アメリカ', 'Orion Pictures。Sonic Schoolhouse等に絡んだ米国の映画会社。ゲーム開発採用外。');
doTag('カカオゲームズ', '韓国', 'Kakao Games。プリコネRe:Dive等を韓国/東南アジアでサービスする韓国のゲームパブリッシャー。');
doTag('クライテリオン・ゲームズ', 'イギリス', 'Criterion Games。AirBladeを開発した英国スタジオ。EA傘下。Burnoutシリーズで著名。');
doTag('クランチロール (企業)', 'アメリカ', 'Crunchyroll。アニメ配信サービス。幻日のヨハネ等の海外版パブリッシャーとして関与。ゲーム開発採用外。');
doTag('Boltrend Games', '台湾', 'Boltrend Games。Disgaea RPG等のモバイルゲームを東アジアでパブリッシュした台湾系企業。');
doTag('Aplus Co., Ltd.', 'イギリス', 'Aplus Co., Ltd.。キルラキル ザ・ゲーム -異布-を欧州でパブリッシュした英国の企業。');
doTag('Machatin, Inc.', 'アメリカ', 'Machatin Inc.。WE CHEER等の音楽ゲームに関与した米国の企業。');
doTag('Neutron Games', 'ドイツ', 'Neutron Games。IHF Handball Challenge等を開発したドイツのゲームスタジオ。');
doTag('Nice Ideas', 'イギリス', 'Nice Ideas。Stunt Flyerを開発した英国のゲームスタジオ。');
doTag('Kru Interactive', '韓国', 'Kru Interactive。MapleStory 2等に関与した韓国のゲームスタジオ。');
doTag('ZlonGame', '韓国', 'ZlonGame。韓国のゲームスタジオ。');

// 解散済み・内部・ブランド（日本）
doNote('RGGスタジオ', 'RGGスタジオ（龍が如くスタジオ）。セガの内部開発スタジオ。クロヒョウ2/龍が如くシリーズ担当。独立法人ではない。採用はセガ経由。');
doNote('Project Soul', 'Project Soul。バンダイナムコエンターテインメントのソウルキャリバーシリーズ担当内部チーム。独立法人ではない。採用はバンダイナムコ経由。');
doNote('Team Ico', 'Team Ico。SIEの内部開発チーム(ICO/ワンダと巨像担当)。2012年にgenDESIGNとして独立。独立後は人喰いの大鷲トリコを制作。');
doNote('アミューズメントヴィジョン', 'アミューズメントヴィジョン（AV）。セガの内部スタジオ。デイトナUSA 2001等を開発。2004年セガ本体に吸収。HPなし。');
doNote('クインテット', 'クインテット（Quintet Co.,Ltd.）。アクトレイザー/ソウルブレイザー/天地創造等のSRPG/アクションRPGで著名。2002年解散。HPなし。');
doNote('クエスト', 'クエスト株式会社（Quest Corporation）。オウガバトルシリーズを開発した日本のゲームメーカー。1999年スクウェアに吸収。HPなし。');
doNote('Tokai Engineering', 'Tokai Engineering(東海エンジニアリング)。ラフワールド等の古いゲームを手がけた日本のゲームメーカー。解散済み。HPなし。');
doNote('VISエンターテインメント', 'VISエンターテインメント。激突四駆バトル等を開発した日本のゲームメーカー。解散済み。HPなし。');
doNote('Vingt-et-un Systems Corporation', 'ヴァン・テ・アン システムズ。スプラッターアクション等を開発した日本の旧ゲームメーカー。解散済み。HPなし。');
doNote('SAS Sakata / Sakata SAS Co., Ltd.', 'Sakata SAS（坂田SAS株式会社）。日本のゲームメーカー。解散済み。HPなし。');
doNote('Sakata SAS Co., Ltd.', '坂田SAS株式会社。パラソルヘンべえ等を開発した旧日本のゲームメーカー。解散済み。HPなし。');
doNote('SAS Sakata', '坂田SAS株式会社。ドラえもん2等を開発した旧日本のゲームメーカー。解散済み。HPなし。');
doNote('エイプ', 'APE Inc.（エイプ株式会社）。マザーシリーズ等を開発した任天堂関連会社。後にハル研究所に統合。HPなし。');
doNote('エルフ', 'ELF Corporation（株式会社エルフ）。同級生シリーズ等の成人向けアドベンチャーゲームで著名な日本のゲームメーカー。2011年解散。HPなし。');
doNote('エンターブレイン', 'Enterbrain（エンターブレイン）。ガレリアンズ等のゲームを出版した日本のゲーム/書籍パブリッシャー。2013年KADOKAWAに統合。HPなし。');
doNote('ONE COMPATH', 'ONE COMPATH（ワンコンパス）。地図/アプリサービス企業。ケータイ国盗り合戦等のモバイルゲームを展開した経緯があるが現在はゲーム採用外。');
doNote('Machatin, Inc.', 'Machatin Inc.。WE CHEER等に関与した企業。詳細不明。');
doNote('エーアイ', '株式会社エーアイ（AI Corporation）。究極タイガーの流通に関与した可能性。詳細不明、現在はゲーム事業外。HPなし。');

// DB誤登録
doNote('Nepisiquit Protected Natural Area', 'DBデータ誤登録。Nepisiquit Protected Natural AreaはカナダNBの自然保護区であり、ゲーム会社ではない。コードシフターの開発はArca Games。');

// アクティブ日本企業
doDesc('PLAYISM', 'インディーゲームの日本国内展開/海外パブリッシングを専門とするActive Gaming Mediaのゲームレーベル。日本インディーゲームのグローバル展開を積極的に支援。', '東京');
doDesc('Phoenixx', 'インディーゲームや中小規模タイトルのパブリッシングを手がける日本のゲームパブリッシャー。Survival Quiz CITY等。', '東京');
doDesc('Dico', '個性的なインディーゲームを開発・パブリッシュする日本の小規模ゲームスタジオ。Gleamlight等。', '日本');
doDesc('Pixel', 'Cave Story（洞窟物語）を制作した天谷大輔氏の個人/小規模スタジオブランド。', '日本');
doDesc('NTTソルマーレ', '電子書籍やモバイルゲームのサービスを提供するNTTドコモグループのサービス会社。', '大阪');
doDesc('ESP (ゲーム会社)', '神機世界エヴォリューション等のゲームを開発した日本のゲームスタジオ。', '日本');
doDesc('comcept', '稲船敬二氏が設立したゲームスタジオ。Kaio: King of Pirates等の意欲的なタイトルを開発。後にカプコンと一部統合。', '東京');
doDesc('genDESIGN', '人喰いの大鷲トリコを開発したSIEジャパンスタジオ出身者(上田文人氏等)による独立スタジオ。', '東京');
doDesc('イニス', 'iNiS。燃えろ!熱血リズム魂 応援団シリーズを開発した日本の音楽ゲームスタジオ。', '東京');
doDesc('キャトルコール', 'Cattle Call。アライアンス・アライブ等のRPGを開発した日本のゲームデベロッパー。フリューの子会社。', '東京');
doDesc('キノトロープ', 'だんじょん商店会等のユニークなゲームを制作した日本のゲームスタジオ。', '日本');
doDesc('エイリム', 'eraim(エイリム)。Voice of Cards等のモバイル/コンソールゲームを手がけた日本のゲームスタジオ。', '東京');
doDesc('オルカ', 'Orca Co. (株式会社オルカ)。ドラゴンクエストXII等に関与した日本のゲームスタジオ。', '日本');
doDesc('Seed & Flower', '欅のキセキ等のアイドルIPゲームを開発した日本のゲームスタジオ。', '日本');
doDesc('キラウェア', 'Another Time Another Leaf 鏡の中の探偵等のコマンドアドベンチャーゲームを制作した日本のゲームスタジオ。', '日本');
doDesc('アクラス', 'School Days等のアニメIPゲームをパブリッシュした日本のゲームパブリッシャー。', '日本');
doDesc('ウィッチクラフト', 'THE 裁判員等のアドベンチャーゲームを制作した日本のゲームスタジオ。', '日本');
doDesc('アエリア', 'オンラインゲームのサービス運営を行う日本のゲーム会社。ソーサリアン等のゲームサービスも担当。', '東京');
doDesc('アジェンダ', 'ドラえもん4 のび太と月の王国等のゲームを開発した日本のゲームスタジオ。', '日本');
doDesc('アトリエドゥーブル', '日本のゲームスタジオ。Snowboarding等を開発。', '日本');
doDesc('ウエストン ビット エンタテインメント', 'Westone Bit Entertainment。ワンダーボーイシリーズ等を開発した日本のゲームメーカー。', '東京');
doDesc('エイブルコーポレーション', '日本のゲームメーカー。ポチっとにゃ〜等を開発。', '日本');
doDesc('GAE', '世界はあたしでまわってる等の女性向けゲームを制作した日本のゲームスタジオ。', '日本');
doDesc('GN Software', 'Angel\'s Feather等の成人向けBLビジュアルノベルを制作した日本のゲームスタジオ。', '日本');
doDesc('インテンス', '脱出アドベンチャー等のゲームを制作した日本の小規模ゲームスタジオ。', '日本');
doDesc('ウェーブ', 'あしたのジョー伝説等のゲームを開発した日本のゲームスタジオ。', '日本');
doDesc('ギブロ', '新・熱血硬派くにおたちの挽歌等の受託開発を手がけた日本のゲームスタジオ。', '日本');
doDesc('カゼ・ネット', '暴れん坊天狗等のゲームを開発した日本の旧ゲームスタジオ。', '日本');
doDesc('カルチュア・パブリッシャーズ', '日本のゲームパブリッシャー。THE レース等を展開。', '日本');
doDesc('カンダバ', 'ラストストーリー等のゲーム制作に関与した日本のゲームプロダクション。', '日本');
doDesc('クライマックス', 'クライマックス株式会社（日本）。ランドストーカー 〜皇帝の財宝〜等を開発した日本のゲームスタジオ（英国のClimax Studiosとは別会社）。', '日本');

// DB誤登録（wikidataブランクノードURI）
const wikidataRows = db.prepare("SELECT id, name FROM companies WHERE name LIKE 'http://www.wikidata.org/.well-known/%'").all();
for (const r of wikidataRows) {
  appendReason(r.id, 'DBデータ誤登録。Wikidataのブランクノード識別子であり、ゲーム会社ではない。');
  console.log(`✓ wikidata誤登録: ${r.name.slice(0,60)}`);
}

const remaining = db.prepare(`SELECT COUNT(*) AS n FROM companies c
  WHERE c.description = '' AND (c.stock_reason IS NULL OR c.stock_reason = '')
    AND EXISTS (SELECT 1 FROM company_game cg WHERE cg.company_id = c.id)
    AND c.tags NOT LIKE '%個人企業%' AND c.tags NOT LIKE '%海外企業%'`).get().n;
const total = db.prepare(`SELECT COUNT(*) AS n FROM companies c WHERE c.description = ''
    AND EXISTS (SELECT 1 FROM company_game cg WHERE cg.company_id = c.id)
    AND c.tags NOT LIKE '%個人企業%' AND c.tags NOT LIKE '%海外企業%'`).get().n;
console.log(`\nreason未記入かつdescription空の残り: ${remaining}件`);
console.log(`全体残り（description空）: ${total}件`);
db.close();
