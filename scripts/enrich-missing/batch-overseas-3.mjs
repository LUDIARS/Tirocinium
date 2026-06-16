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

const OVERSEAS = [
  ['アイドス・モントリオール','カナダ','Eidos Montreal。トゥームレイダー/デウスエクス:マンカインドディバイデッドを開発したカナダのスタジオ。Square Enix傘下。'],
  ['エンパイア・インタラクティブ','イギリス','Empire Interactive。フラットアウト等の英国ゲームパブリッシャー。2009年破産。'],
  ['サンザルゲームズ','アメリカ','Sanzaru Games。スライ・クーパー Thieves in Time等を開発した米国スタジオ。Meta傘下(元SIE)。'],
  ['ゾーイ・モード','イギリス','Zoe Mode。Rock Revolution等リズムゲームを開発した英国スタジオ。'],
  ['デジタル・エクリプス','アメリカ','Digital Eclipse。カプコンクラシックスコレクション等のレトロゲーム復刻を専門とする米国スタジオ。'],
  ['ノーティドッグ','アメリカ','Naughty Dog。The Last of Us/Jak&Daxterシリーズを開発したSIE傘下の米国トップスタジオ。'],
  ['ハーモニックス・ミュージック・システムズ','アメリカ','Harmonix Music Systems。FrequencyシリーズとRock Bandシリーズを開発した音楽ゲームの米国パイオニア。'],
  ['バグベアー・エンタテインメント','フィンランド','Bugbear Entertainment。フラットアウトシリーズ/リッジレーサー アンバウンデッドを開発したフィンランドのスタジオ。'],
  ['バックボーン・エンタテインメント','アメリカ','Backbone Entertainment。ソニックアルティメットジェネシスコレクション等のレトロゲーム復刻を専門とした米国スタジオ。'],
  ['パレスソフトウェア','イギリス','Palace Software。Barbarian: The Ultimate Warriorを制作した英国の老舗スタジオ。1992年解散。'],
  ['ファクター5','アメリカ','Factor 5。Rise from Lair等のPS3タイトルを開発した米国/ドイツのゲームスタジオ。2009年閉鎖。'],
  ['フロンティア・ディベロップメント','イギリス','Frontier Developments。Elite/Planet Coasterシリーズを開発した英国のゲームスタジオ。'],
  ['ユナイテッド・フロント・ゲームズ','カナダ','United Front Games。Sleeping Dogsを開発したカナダのゲームスタジオ。2016年閉鎖。'],
  ['レア','イギリス','Rare Ltd.。スーパードンキーコング/Killer Instinct等を開発した英国の老舗スタジオ。Microsoft/Xbox Game Studios傘下。'],
  ['ロックスター・ゲームス','アメリカ','Rockstar Games。GTA/Red Dead Redemptionシリーズを開発・パブリッシュする米国の大手ゲームスタジオ。Take-Two Interactive傘下。'],
  ['マイクロソフト','アメリカ','Microsoft Corporation。Xbox Game Studiosを通じてゲームを展開する米国の大手テックカンパニー。ゲーム開発採用はXbox Game Studios各スタジオ経由。'],
  ['テンセント','中国','Tencent Holdings。あんさんぶるスターズ等に出資する中国の大手ゲーム/テクノロジー企業。ゲーム開発採用はNexon/Epic等子会社経由。'],
  ['ソフトクラブ','ロシア','SoftClub。ロシアのゲームパブリッシャー。B-boy/サイバーパンク2077等のロシア語版を展開。'],
  ['楽陞科技','台湾','楽陞科技(Luckarts Technology)。台湾のゲームパブリッシャー/開発会社。FFXVやDW斬の中国語版展開等を担当。'],
  ['マスティフ','アメリカ','Mastiff LLC。ラ・ピュセル等の日本ゲームを北米でパブリッシュした米国のゲームパブリッシャー。'],
  ['マンガプロダクションズ','サウジアラビア','Manga Productions。サウジアラビアのエンタメ企業。日本のゲームへの出資/パブリッシングも行う。'],
  ['童','フランス','Warashi（童）。紫炎龍等のゲームをフランス/欧州市場向けに展開したフランスの企業。'],
  ['2XL Games','アメリカ','2XL Games。Jeremy McGrathのオフロードゲーム等を開発した米国スタジオ。'],
  ['3D Realms','アメリカ/デンマーク','3D Realms。Wolfenstein 3Dの元版権保有者(旧Apogee)。現在はデンマーク拠点。'],
  ['989 Studios','アメリカ','989 Studios (旧Sony Interactive Studios America)。ESPN Extreme Games等を開発した米国SIEスタジオ。2000年頃解散。'],
  ['ACE Team','チリ','ACE Team。Abyss Odyssey等を開発したチリのゲームスタジオ。'],
  ['Acclaim Studios London','イギリス','Acclaim Studios London。Acclaim倒産で2004年閉鎖した英国スタジオ。'],
  ['Adult Swim Games','アメリカ','Adult Swim Games。サムライジャックゲーム等を手がけた米国のゲームレーベル。'],
  ['Airtight Games','アメリカ','Airtight Games。Dark Voidを開発した米国のゲームスタジオ。Capcomと協業。2014年頃閉鎖。'],
  ['Anco Software','イギリス','Anco Software。サッカーゲームPlayer Managerシリーズで知られた英国のゲームメーカー。'],
  ['Apogee Software','アメリカ','Apogee Software (3D Realms前身)。シェアウェアゲームのパイオニアである米国のゲームメーカー。'],
  ['Armor Games','アメリカ','Armor Games。Webブラウザゲームのポータルサイト。ゲーム開発は行わず主にFlashゲームを配信。'],
  ['Artisan Studios','カナダ','Artisan Studios。勇者ネプテューヌ等のリマスターを手がけたカナダのゲームスタジオ。'],
  ['Atomic Planet Entertainment','イギリス','Atomic Planet Entertainment。Mega Man Anniversary Collectionを開発した英国スタジオ。2003年頃閉鎖。'],
  ['Audiogenic','イギリス','Audiogenic。Bubble and Squeakを開発した英国の旧ゲームメーカー。'],
  ['Babaroga','アメリカ','Babaroga。ぼくとシムのまちのモバイル版等を開発した米国スタジオ。'],
  ['Behaviour Interactive','カナダ','Behaviour Interactive。モンスターズ・インクゲーム等のライセンスゲームや自社タイトルを手がけるカナダのスタジオ。Dead by Daylightで著名。'],
  ['Big Blue Bubble','カナダ','Big Blue Bubble。Mage Knight: Destiny Soldierシリーズ等の子ども向けゲームを開発したカナダのスタジオ。'],
  ['フィールプラス','アメリカ','Feel Plus (フィールプラス)。ロストオデッセイ等のゲームを開発した日本/米国のスタジオ。マイクロソフト向け開発が多数。'],
  ['ブループラネットソフトウェア','アメリカ','Blue Planet Software。テトリスのライセンス管理を行うHenk Rogers主宰の米国企業。ゲーム開発企業ではなくライセンス管理が主業。'],
];

let tagged=0, notFound=0;
for (const [name, country, note] of OVERSEAS) {
  const id = findId(name);
  if (!id) { console.log(`NOT FOUND: ${name}`); notFound++; continue; }
  addTag(id, '海外企業');
  appendReason(id, `${country}の企業。${note}`);
  console.log(`✓ ${name}`);
  tagged++;
}

// 解散済み・内部スタジオ・ブランド（日本）
const RESOLVED = [
  ['クローバースタジオ', 'カプコンの内部スタジオ。大神/ビューティフル ジョーを開発。2007年解散。HPなし。'],
  ['フラグシップ', 'カプコン子会社。ゼルダの伝説 ふしぎの木の実/星のカービィ参上！ドロッチェ団等を開発。2007年解散。HPなし。'],
  ['ヒットメーカー', 'セガの内部スタジオ（Hit Maker、第2AM研究開発部系）。セガラリーチャンピオンシップ等を開発。2004年セガ本体に吸収。HPなし。'],
  ['スマイルビット', 'セガの内部スタジオ（Smileboom→Smilebit）。マリオ&ソニックシリーズのセガ側担当。2004年セガ本体に吸収。HPなし。'],
  ['タクミコーポレーション', 'タクミコーポレーション。ギガウィングシリーズ等のアーケードシューティングを開発した日本のメーカー。2005年解散。HPなし。'],
  ['データイースト', 'Data East Corporation。ファイターズヒストリー/スパルタンX等のアーケードゲームで著名。2003年倒産・解散。HPなし。'],
  ['ネバーランドカンパニー', 'ネバーランドカンパニー。ルーンファクトリーシリーズ/エストポリス伝記等を開発した日本のスタジオ。2013年解散。HPなし。'],
  ['マイクロキャビン', 'Microcabin Corporation。マリオネットカンパニー等のPCゲームを開発した日本のメーカー。2008年解散。HPなし。'],
  ['ホット・ビィ', 'HOT-B Co.,Ltd.。フェアリーランドストーリー等のアーケードゲームを開発・流通した日本のメーカー。解散済み。HPなし。'],
  ['日本コンピュータシステム', 'NCS/Masaya（日本コンピュータシステム）。重装機兵ヴァルケン等を開発したゲームメーカー。解散済み。HPなし。'],
  ['池上通信機', '池上通信機株式会社。ザクソン等の業務用ゲーム機器を製造した電子機器メーカー。ゲーム開発企業ではない。HPなし(ゲーム採用外)。'],
  ['ロボット', '株式会社ロボット。アニメ/映像プロダクション。ゲーム開発企業ではなく採用対象外。'],
  ['集英社', '株式会社集英社。大手出版社。ONE PIECE/ドラゴンボール等のゲームIPライセンス提供元。ゲーム開発は行わない。採用対象外。'],
  ['エクシング', '株式会社エクシング。通信カラオケ/IT企業。帝國カレイド等のゲームに関与した経緯があるが現在はゲーム採用外。'],
  ['ビクターエンタテインメント', 'Victor Entertainment (ビクターエンタテインメント)。音楽レーベル。スター・ウォーズ等のゲームIPを一部展開した経緯があるが現在はゲーム採用外。'],
  ['ポニーキャニオン', 'ポニーキャニオン。音楽・映像レーベル。A列車で行こうシリーズ等のゲームを一時期展開。現在はゲーム開発採用外。'],
  ['エピックレコードジャパン', 'エピックレコードジャパン。ソニーミュージック系の音楽レーベル。旧作ゲームを一部出版した経緯あり。ゲーム採用外。HPなし。'],
  ['ビーピーエス', 'BPS (Bullet Proof Software)。テトリスのライセンス等を手がけたゲームメーカー。Henk Rogersが設立。後にBlue Planet Softwareへ。解散済み。HPなし。'],
  ['マイクロニクス', 'Micronics Corporation。1980〜90年代にFC向けゲーム移植を多数手がけた日本のデベロッパー。解散済み。HPなし。'],
  ['ミッチェル', 'Mitchell Corporation (ミッチェル株式会社)。直感ヒトフデ等の旧アーケードパズルゲームを開発した日本のメーカー。活動停止。HPなし。'],
  ['カシオ計算機', 'CASIO Computer Co., Ltd.。電子機器メーカー。レディバグ等の旧アーケードゲームのライセンス/展開に関与。ゲーム開発採用外。'],
  ['ビクターエンタテインメント', 'Victor Entertainment。音楽レーベルのゲーム部門。解散済み。HPなし。'],
  ['ケマンソウ科', 'DBデータ誤登録。ケマンソウ科はシソ目の植物ファミリーであり、ゲーム会社ではない。チキチキマシン猛レースの開発はNow Productions/SEGA系。'],
  ['ロベール1世', 'DBデータ誤登録。ロベール1世は10世紀フランス王であり、ゲーム会社ではない。ファイティング・ホークの開発はToaplan。'],
  ['北アメリカ', 'DBデータ誤登録。北アメリカは大陸の地名であり、ゲーム会社ではない。マッドワールドの開発はPlatinumGames。'],
  ['キッズステーション', 'キッズステーション。CSアニメ専門チャンネル(SKY PerfecTV系)。式神の城IIの展開元として名が挙がったが、ゲーム開発は行わない。採用対象外。'],
  ['ネオス', 'NEOS Corporation（ネオス株式会社）。IT/サービス企業。クレヨンしんちゃん「オラと博士の夏休み」等はバンダイナムコが開発/発売。DB記載誤りの可能性あり。'],
  ['ランカース', 'Lancarse (ランカース)。Monark/ペルソナシリーズのサブタイトル開発等を手がける日本のゲームデベロッパー。現役のスタジオ。'],
  ['システムソフト・アルファー', 'SystemSoft Alpha (システムソフト・アルファー)。アドバンスド大戦略等のウォーシミュレーションゲームを専門とする日本のメーカー。'],
  ['カバー株式会社', 'Cover Corporation (カバー株式会社)。ホロライブプロダクションを運営するVTuber事務所。hololive Dreamsはゲームタイトル。採用はカバー株式会社経由。'],
];

let updated=0;
for (const [name, note] of RESOLVED) {
  const id = findId(name);
  if (!id) { console.log(`NOT FOUND: ${name}`); continue; }
  appendReason(id, note);
  console.log(`✓ 記録: ${name}`);
  updated++;
}

const remaining = db.prepare(`SELECT COUNT(*) AS n FROM companies c
  WHERE c.description = '' AND (c.stock_reason IS NULL OR c.stock_reason = '')
    AND EXISTS (SELECT 1 FROM company_game cg WHERE cg.company_id = c.id)
    AND c.tags NOT LIKE '%個人企業%' AND c.tags NOT LIKE '%海外企業%'`).get().n;
console.log(`\n海外: ${tagged}件 / 記録: ${updated}件 / 未発見: ${notFound}件`);
console.log(`reason未記入かつdescription空の残り: ${remaining}件`);
db.close();
