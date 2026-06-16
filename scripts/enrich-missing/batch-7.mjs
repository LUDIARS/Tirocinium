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
  if (!row) { console.log(`NOT FOUND id: ${id}`); return; }
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
function tagIndividual(name, note) {
  const id = findId(name);
  if (!id) { console.log(`NOT FOUND: ${name}`); return; }
  addTag(id, '個人企業');
  if (note) appendReason(id, note);
  console.log(`✓ 個人: ${name}`);
}
function noteError(name, note) {
  const id = findId(name);
  if (!id) { console.log(`NOT FOUND: ${name}`); return; }
  appendReason(id, note);
  console.log(`✓ DBエラー記録: ${name}`);
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

// =====================================================================
// 海外企業
// =====================================================================
tagOverseas('クリスタル・ダイナミックス', 'Crystal Dynamics。トゥームレイダーシリーズを手がける米国のゲームデベロッパー。Square Enix傘下を経てEmbracerに移管。');
tagOverseas('ゲリラケンブリッジ', 'Guerrilla Cambridge。英国ケンブリッジのSCE第一パーティースタジオ。MediEvilシリーズ等を開発。2017年閉鎖。');
tagOverseas('コア・デザイン', 'Core Design。トゥームレイダー初代を開発した英国のゲームスタジオ。Eidos所属、2006年解散。');
tagOverseas('コモドール', 'Commodore Business Machines。Amiga/C64を展開した米国のコンピュータ/ゲーム企業。');
tagOverseas('コレコ', 'Coleco Industries。コレコビジョン等を展開した米国の玩具・ゲーム企業。1988年破産。');
tagOverseas('サムスン電子', 'Samsung Electronics Co., Ltd.。韓国の世界最大級の電子機器メーカー。ゲームにも一部関与。');
tagOverseas('サンディエゴスタジオ', 'SIE San Diego Studio。MLB The Showシリーズを開発するソニー米国の第一パーティースタジオ。');
tagOverseas('シアネード', 'Cyanide Studio。プロサイクリングマネジャーシリーズ等を開発するフランスのゲームデベロッパー。');
tagOverseas('スクウェア・エニックス・ヨーロッパ', 'Square Enix Europe (旧Eidos Interactive)。Tomb Raider/Deus Ex等を欧州でパブリッシュするSquare Enix英国子会社。');
tagOverseas('スプラッシュダメージ', 'Splash Damage Ltd.。Quake Wars/Dirty Bomb等を開発した英国のゲームデベロッパー。');
tagOverseas('スペクトラムホロバイト', 'Spectrum HoloByte。Falcon/テトリス北米版等を開発・発売した米国のゲーム会社。後にMicroProseに統合。');
tagOverseas('スレッジハンマーゲームズ', 'Sledgehammer Games。Call of Duty: Advanced Warfare等を開発するActivision傘下の米国スタジオ。');
tagOverseas('ゼニマックス・メディア', 'ZeniMax Media。ベセスダ/id Software等を傘下に持つ米国のゲーム持株会社。2021年Microsoftに買収。');
tagOverseas('タイガー・エレクトロニクス', 'Tiger Electronics。LCD液晶ゲームで知られる米国の玩具・ゲームメーカー。');
tagOverseas('タイタス・ソフトウェア', 'Titus Software。スーパーマン64等を制作したフランスのゲームデベロッパー。2002年破産。');
tagOverseas('ダブルファインプロダクションズ', 'Double Fine Productions。サイコノーツ/ブルータルレジェンド等を開発する米国のゲームスタジオ。ティム・シェイファー設立、現在はXbox Game Studios傘下。');
tagOverseas('テイクツー・インタラクティブ', 'Take-Two Interactive Software。GTA/NBA 2K等を抱える米国の大手ゲームパブリッシャー。2K/Rockstarの親会社。');
tagOverseas('テウォンメディア', '대원미디어(Daewon Media)。韓国のアニメ・マンガ・ゲームメディア会社。');
tagOverseas('デジタル・エクストリームス', 'Digital Extremes。Warframe/Dark Sectorを開発したカナダのゲームスタジオ。');
tagOverseas('デルフィン・ソフトウェア', 'Delphine Software International。アウトランナーズ/エタナム等を開発したフランスのゲームデベロッパー。2003年閉鎖。');
tagOverseas('トイズ・フォー・ボブ', 'Toys for Bob。スパイロ・ザ・ドラゴン/スカイランダーズを開発する米国のゲームスタジオ。Activision傘下。');
tagOverseas('ニヒリスティックソフトウェア', 'Nihilistic Software。Call of Duty: Black Ops Declassified等を開発した米国のゲームスタジオ。');
tagOverseas('ネットマーブル', 'Netmarble Corp.。Lineage2 Revolution等のモバイルゲームを開発・運営する韓国の大手ゲーム企業。');
tagOverseas('ノヴィ・ディスク', 'Novy Disk。ロシアのゲームパブリッシャー。');
tagOverseas('バイアコム (1952-2006)', 'Viacom Inc.。ニコロデオン/MTVを傘下に持つ米国の大手メディアコングロマリット。一部ゲームもライセンス。');
tagOverseas('バイオウェア', 'BioWare Corp.。マスエフェクト/ドラゴンエイジ等のRPGで知られるカナダのゲームデベロッパー。EA傘下。');
tagOverseas('バイカリアス・ビジョンズ', 'Vicarious Visions。スパイロ・ザ・ドラゴン/ディアブロ2:リザレクテッド等を開発した米国スタジオ。現在Blizzardに統合。');
tagOverseas('パイプワークス・スタジオ', 'Pipeworks Studio。マルチプレイヤーゲームを専門とする米国オレゴン州のゲームスタジオ。');
tagOverseas('パワーヘッドゲームズ', 'Powerhead Games。カナダのモバイルゲームデベロッパー。');
tagOverseas('パーカー・ブラザーズ', 'Parker Brothers。モノポリー/Frogger等のボードゲーム・ビデオゲームを展開した米国の玩具会社。現在はハスブロに統合。');
tagOverseas('ビッグ・ヒュージ・ゲームス', 'Big Huge Games。Rise of Nations/Kingdoms of Amalurを開発した米国のゲームスタジオ。');
tagOverseas('ファンコム', 'Funcom Oslo AS。コナン エグザイルズ/Anarchy Onlineを開発したノルウェーのゲームデベロッパー。');
tagOverseas('ファンタグラム', 'Phantagram Co., Ltd.。Kingdom Under Fire/Ninety-Nine Nightsを開発した韓国のゲームスタジオ。');
tagOverseas('フォーカス・ホーム・インタラクティブ', 'Focus Home Interactive (現Focus Entertainment)。Vampyr/Greedfall等をパブリッシュするフランスのゲーム会社。');
tagOverseas('ブリザード・エンターテインメント', 'Blizzard Entertainment, Inc.。ディアブロ/スタークラフト/WoW等を開発する米国の著名ゲームデベロッパー。Activision Blizzard(現Microsoft)傘下。');
tagOverseas('プレイステーションPCLLC', 'PlayStation PC LLC。PC向けにPlayStationゲームをパブリッシュするソニーインタラクティブエンタテインメントの米国子会社。');
tagOverseas('ハーフブリック・スタジオ', 'Halfbrick Studios。フルーツニンジャ/ジェットパックジョイライド等のモバイルゲームを開発したオーストラリアのゲームスタジオ。');
tagOverseas('マーキュリースチーム', 'MercurySteam Entertainment。キャッスルヴァニア:ロードオブシャドウ等を開発したスペインのゲームスタジオ。');
tagOverseas('マインドスケープ', 'Mindscape, Inc.。米国/フランスのゲームパブリッシャー。ブレインエイジ前身のBrain Trainer等を北米展開。');
tagOverseas('メディアモレキュール', 'Media Molecule Ltd.。リトルビッグプラネット/Dreams等を開発する英国のゲームスタジオ。SIE第一パーティー。');
tagOverseas('ユービーアイソフト レミントン', 'Ubisoft Leamington。英国レミントンスパにあるUbisoft傘下のゲームスタジオ。Watch Dogs: Legion等に携わる。');
tagOverseas('リライアンス・エンターテインメント', 'Reliance Entertainment。インドの大手エンターテインメントグループ、Reliance Group傘下。ゲーム事業にも参入。');
tagOverseas('レインボー・アーツ', 'Rainbow Arts Software GmbH。The Great Giana Sisters等を開発したドイツのゲーム会社。');
tagOverseas('レディアットドーン', 'Ready at Dawn Studios, LLC。Daxter/The Order:1886等を開発した米国のゲームスタジオ。現在はMeta傘下。');
tagOverseas('レトロスタジオ', 'Retro Studios, Inc.。メトロイドプライム/ドンキーコングカントリーリターンズを開発する米国のNintendo第一パーティースタジオ。');
tagOverseas('レトロビット', 'Retro-Bit。クラシックゲームコントローラーやレトロゲーム関連製品を展開する米国の企業。');
tagOverseas('ロビオ・エンターテインメント', 'Rovio Entertainment Oyj。アングリーバードを開発したフィンランドのゲームデベロッパー。Sega傘下。');
tagOverseas('ヴァトラゲームズ', 'Vatra Games。サイレントヒル:ダウンプアーを開発したチェコのゲームスタジオ。');
tagOverseas('ヴィヴェンディ・ユニバーサルゲームズ', 'Vivendi Universal Games。Sierra Entertainment等を傘下に持ったフランス/米系の大手ゲームパブリッシャー。Activision Blizzardに統合。');
tagOverseas('網易遊戯', 'NetEase Games(網易遊戯)。陰陽師等のモバイルゲームを開発・運営する中国の大手ゲーム企業。');
tagOverseas('Tommo Inc.', 'Tommo Inc.。北米でレトロゲームや周辺機器を流通・販売する米国の企業。');
tagOverseas('XAX Entertainment, Inc.', 'XAX Entertainment, Inc.。ゲームソフトのライセンスや配信を行う米国の企業。');
tagOverseas('グラビティ', 'Gravity Co., Ltd.(그라비티)。ラグナロクオンライン等を開発・運営する韓国のゲームデベロッパー。');
tagOverseas('シュールなソフトウェア', 'Surreal Software, Inc.。The Lord of the Rings: The Treason of Isengard等を開発した米国のゲームスタジオ。Warner Bros.傘下で解散。');
tagOverseas('現実の端', 'Edge of Reality, Ltd.。シュレック/トニーホーク等の受託開発を行った米国テキサス州のゲームスタジオ。');
tagOverseas('ファンタグラム', 'Phantagram Co., Ltd.。Kingdom Under Fire/Ninety-Nine Nightsを開発した韓国のゲームスタジオ。');

// =====================================================================
// 個人企業
// =====================================================================
tagIndividual('Randy Glover', 'Randy Glover。Jumpman(1983)等を開発したカナダ系個人ゲーム開発者。採用可能性なし。');
tagIndividual('ジャロン・ラニアー', 'Jaron Lanier。VRの父として知られる米国の個人研究者・ミュージシャン。Moondust(1983)等を制作。採用可能性なし。');
tagIndividual('ディノ・ディニ', 'Dino Dini。キックオフシリーズを制作した英国の個人ゲームデザイナー。採用可能性なし。');
tagIndividual('堀井雄二', '堀井雄二。ドラゴンクエストシリーズの原作者・ゲームデザイナー。アーマープロジェクト所属。採用担当部署として登録できないため除外。');
tagIndividual('村山吉隆', '村山吉隆。幻想水滸伝シリーズの元ディレクター。個人としての登録のため除外。Rabbit & Bear Studios代表。');
tagIndividual('鈴木克崇', '鈴木克崇。個人のゲーム開発者・クリエイター。採用窓口としての登録対象外。');

// =====================================================================
// DBエラー (企業でない)
// =====================================================================
noteError('Rambucourt', 'DBエラー: Rambucourt はフランスのコミューン(市町村)であり、ゲーム会社ではない。Wikipedia取込誤り。');
noteError('シパルナ科', 'DBエラー: シパルナ科 (Siparuna) は植物の属名であり、ゲーム会社ではない。Wikipedia取込誤り。');
noteError('北越戦争', 'DBエラー: 北越戦争は歴史的事件であり、ゲーム会社ではない。Wikipedia取込誤り。');
noteError('ニンテンドーDSi', 'DBエラー: ニンテンドーDSiは任天堂のハードウェア製品であり、企業ではない。Wikipedia取込誤り。');

// =====================================================================
// 解散済み / 内部スタジオ (日本)
// =====================================================================
addDesc('コナミコンピュータエンタテインメントスタジオ', {
  description: 'コナミのゲーム開発子会社。メタルギアソリッドシリーズの開発拠点として機能したが、後にコナミ本体に吸収合併。',
  reason: 'コナミの内部スタジオ、現在はコナミに統合済み。採用はコナミ本体経由。',
});
addDesc('スリーディー・エイジス', {
  description: 'セガのアーカイブブランド「3D AGES」または関連スタジオ。セガの往年の名作をリマスターする事業に関連。',
  reason: 'セガ内部のブランド/チーム名。独立した採用窓口なし。',
});
addDesc('セガ フェイブ', {
  description: 'セガのモバイルゲーム子会社。スマートフォン向けゲームの開発・運営を担当したが、セガへ吸収合併。',
  reason: 'セガのモバイル子会社、現在はセガに統合済み。',
});
addDesc('セガ・インタラクティブ', {
  description: 'セガのアーケードゲーム事業子会社。バーチャシリーズ等のアーケードゲームを担当。2020年にセガへ吸収合併。',
  reason: 'セガのアーケード子会社、2020年セガに統合済み。',
});
addDesc('ナムコネットワークス', {
  description: 'バンダイナムコのネットワークゲーム事業子会社。オンライン/モバイル向けゲームを展開したが、バンダイナムコに吸収。',
  reason: 'バンダイナムコのネットワーク子会社、現在は統合済み。',
});
addDesc('ソニーネットワークコミュニケーションズ', {
  reason: 'Sony Network Communications Inc.。主にインターネット回線・So-net事業を担う Sony 子会社。ゲーム開発会社ではない。',
});
addDesc('東京開発室', {
  reason: 'セガ等の大企業が社内開発部門に付けた「東京開発室」の通称。独立企業体ではなく採用窓口なし。',
});

// =====================================================================
// アクティブ日本企業
// =====================================================================
addDesc('オー・エル・エム', {
  url: 'https://www.olm.co.jp/',
  description: 'OLM株式会社(Oriental Light and Magic)。ポケモンアニメシリーズの制作で知られる日本のアニメーションスタジオ。ゲーム映像にも関与。',
  location: '東京',
});
addDesc('クッキングママ リミテッド', {
  description: 'Cooking Mama Limited。料理シミュレーションゲーム「クッキングママ」シリーズのパブリッシャー。',
  location: '日本',
});
addDesc('グラビティゲームアライズ', {
  url: 'https://ggalaxy.co.jp/',
  description: 'グラビティゲームアライズ株式会社。韓国Gravity Co.の日本子会社。ラグナロクオンラインシリーズ等を日本市場向けに展開。',
  location: '東京',
});
addDesc('ジョルダン', {
  url: 'https://www.jorudan.co.jp/',
  description: '株式会社ジョルダン(Jorudan Co., Ltd.)。乗換案内アプリで知られる日本の企業。ゲーム事業も展開。',
  location: '東京',
});
addDesc('ジー・モード', {
  url: 'https://www.g-mode.co.jp/',
  description: '株式会社G-MODE。往年の名作ゲームをモバイル向けにアーカイブ配信する日本のゲーム企業。ゲームギア作品等の復刻で知られる。',
  location: '東京',
});
addDesc('スキップ', {
  description: '株式会社スキップ(Skip Ltd.)。ちびロボ!/ギフトピア等を任天堂と共に開発した日本のゲームデベロッパー。',
  location: '東京',
});
addDesc('シンキングラビット', {
  description: 'シンキングラビット株式会社。倉庫番(Sokoban)シリーズの生みの親。パズルゲームの老舗日本ゲームメーカー。',
  location: '日本',
});
addDesc('セタ', {
  description: '株式会社セタ(SETA Corporation)。アーケードや家庭用ゲーム機向けにゲームを開発・発売した日本のゲームメーカー。',
});
addDesc('ディライトワークス', {
  description: '株式会社ディライトワークス。Fate/Grand Order(FGO)の開発・運営で急成長した日本のゲームデベロッパー。2022年に株式会社ラセングルに社名変更。',
  location: '東京',
  reason: '現在は株式会社ラセングルに社名変更済み。',
});
addDesc('トライアングル・サービス', {
  description: '株式会社トライアングルサービス。Trizeal/XII Stag等の本格シューティングゲームを制作する日本のインディーゲームデベロッパー。',
  location: '日本',
});
addDesc('ドワンゴ', {
  url: 'https://dwango.co.jp/',
  description: '株式会社ドワンゴ。ニコニコ動画を運営する日本のIT企業。ゲーム事業も展開し、アドベンチャーゲーム等をパブリッシュ。KADOKAWAグループ。',
  location: '東京',
});
addDesc('ハピネット', {
  url: 'https://www.happinet.co.jp/',
  description: '株式会社ハピネット。ゲームソフト・玩具・映像商品の流通・販売を行うバンダイナムコグループの総合エンターテインメント企業。ニッチなゲームの国内発売も担う。',
  location: '東京',
});
addDesc('バンプール', {
  description: '株式会社バンプール(Vanpool Inc.)。ドンキーコングなどの任天堂ゲーム受託開発や、Dr. Mario Worldを開発した日本のゲームデベロッパー。',
  location: '東京',
});
addDesc('パック・イン・ビデオ', {
  description: '株式会社パック・イン・ビデオ(Pack-In-Video Co., Ltd.)。ファミコン向けゲームを多数発売した日本のゲームパブリッシャー。後にビクターエンタテインメントに統合。',
  reason: '現在はビクターエンタテインメントに統合済み。',
});
addDesc('パナソニック', {
  description: 'パナソニック株式会社(旧松下電器産業)。3DOゲーム機のReal(FZ-1)等を展開した日本の大手電機メーカー。現在はゲーム事業から撤退。',
  location: '大阪',
});
addDesc('ヘクト', {
  description: '株式会社ヘクト(Hect Co., Ltd.)。ダンジョンRPGシリーズ等を手がけた日本のゲームパブリッシャー/デベロッパー。',
  reason: '現在は実質的に活動停止、HPなし。',
});
addDesc('ポケラボ', {
  url: 'https://pokelabo.co.jp/',
  description: '株式会社ポケラボ(Pokelabo Inc.)。SINoALICE/少女前線等のモバイルゲームを開発した日本のゲームデベロッパー。スクウェア・エニックスグループ。',
  location: '東京',
});
addDesc('マイクロネット', {
  description: '株式会社マイクロネット(Micronet Co., Ltd.)。スーパーハングオン等のアーケード移植を手がけた日本のゲームデベロッパー。',
  reason: '現在は解散、HPなし。',
});
addDesc('メルダック', {
  description: '株式会社メルダック(Meldac Co., Ltd.)。音楽レーベルとゲーム事業を兼ねた日本の企業。上海/ファミスタシリーズ等を発売。',
  reason: '現在は解散/活動停止。HPなし。',
});
addDesc('ルビーパーティー', {
  description: 'Ruby Party(ルビーパーティー)。アンジェリークシリーズ/ネオロマンスシリーズ等の女性向け恋愛シミュレーションゲームを展開するコーエーテクモ(光栄)のブランド。',
  location: '神奈川',
});
addDesc('三洋電機', {
  description: '三洋電機株式会社(Sanyo Electric Co., Ltd.)。テトリス(三洋版)等のゲーム関連製品を発売した日本の大手電機メーカー。現在はパナソニックに統合。',
  location: '大阪',
  reason: '現在はパナソニックに統合済み。主な事業は電機。',
});
addDesc('日本電気', {
  url: 'https://www.nec.com/',
  description: 'NEC(日本電気株式会社)。PC-8800シリーズ/PC-9800シリーズ等でゲーム普及に貢献した日本の大手IT・電機メーカー。',
  location: '東京',
});
addDesc('日本電気ホームエレクトロニクス', {
  description: 'NEC Home Electronics, Ltd.。NECの家電部門子会社。PC Engineの開発・販売を担当し、多数のPCE向けゲームをパブリッシュ。',
  reason: '現在はNECに統合/解散。PC Engine時代の重要企業。',
});
addDesc('日本ビクター', {
  description: '日本ビクター株式会社(Victor Entertainment)。JVC/ビクターブランドで音響・映像機器を展開し、ゲームソフトも発売した日本の企業。',
  reason: '現在はJVCケンウッドに統合。',
});
addDesc('東宝', {
  url: 'https://www.toho.co.jp/',
  description: '東宝株式会社(Toho Co., Ltd.)。ゴジラ/シン・ゴジラ等のIPを持つ日本の大手映画・エンターテインメント会社。IP利用ゲームの版権管理。',
  location: '東京',
});
addDesc('講談社', {
  url: 'https://www.kodansha.co.jp/',
  description: '株式会社講談社(Kodansha Ltd.)。少年マガジン等を発行する日本最大手の出版社。ゲーム化ライセンス元として多くのゲームに関与。',
  location: '東京',
});
addDesc('ノイズファクトリー', {
  description: 'Noise Factory Co., Ltd.。SNKの格闘ゲームエンジンを活用したゲームを開発した日本のゲームデベロッパー。サムライスピリッツ等に参加。',
});
addDesc('ハチノヨン', {
  description: '株式会社ハチノヨン。日本のインディーゲームデベロッパー。',
  location: '日本',
});
addDesc('ポケモンワークス', {
  description: 'ポケモンワークス株式会社。ポケモン映像コンテンツの制作を担う株式会社ポケモンの子会社。',
  location: '東京',
});
addDesc('TakaraTomy', {
  url: 'https://www.takaratomy.co.jp/',
  description: '株式会社タカラトミー(TAKARA TOMY)。ベイブレード/トミカ/リカちゃん等で知られる日本の大手玩具メーカー。ゲームソフトも展開。',
  location: '東京',
});
addDesc('ツクダオリジナル', {
  description: '株式会社ツクダオリジナル(Tsukuda Original Co.)。将棋/囲碁の電子ゲームや家庭用ゲーム機向けソフトを発売した日本の玩具・ゲームメーカー。',
  reason: '現在は解散/廃業。',
});
addDesc('パンチライン', {
  description: '株式会社パンチライン(PUNCHLINE Co., Ltd.)。ゲームの受託開発やアダルトゲームの企画・制作を行う日本のゲームデベロッパー。',
  location: '日本',
});
addDesc('加賀電子', {
  url: 'https://www.kaga.com/',
  description: '加賀電子株式会社(Kaga Electronics Co., Ltd.)。電子部品・半導体の専門商社として知られる日本の企業。かつてゲームソフトの流通も手がけた。',
  location: '東京',
});
addDesc('ホビボックス', {
  description: '株式会社ホビボックス(Hobibox Co., Ltd.)。エロゲーを中心とした日本の成人向けゲームブランド。KMP/ホビジャパン系列。',
  location: '日本',
});
addDesc('チームグリグリ', {
  description: 'チームグリグリ(Team GrisGris)。「魔女の家」「ibe -いいべ-」等のRPGツクール系ホラーゲームを制作した日本のインディーゲームデベロッパー。',
});
addDesc('日本システムサプライ (JSS)', {
  description: '株式会社日本システムサプライ(JSS)。主にMSX/PC向けゲームソフトを発売した日本のゲームパブリッシャー。',
  reason: '現在は解散/廃業。HPなし。',
});
addDesc('フォワードワークス', {
  url: 'https://www.forwardworks.co.jp/',
  description: 'フォワードワークス株式会社(ForwardWorks Corporation)。PlayStation IPのモバイルゲーム化に特化するソニー・インタラクティブエンタテインメントの日本子会社。',
  location: '東京',
});
addDesc('モンキークラフト', {
  description: '株式会社モンキークラフト(MonkeyCraft Co., Ltd.)。「太鼓の達人」シリーズ等のゲームに携わった日本のゲームデベロッパー。',
  location: '日本',
});
addDesc('ジェイピィールーム', {
  description: '株式会社ジェイピィールーム(J.P. Room Co., Ltd.)。日本のゲームデベロッパー・パブリッシャー。',
});
addDesc('セイブ開発', {
  description: '株式会社セイブ開発(SEIBU KAIHATSU Inc.)。ライデンシリーズ等の縦スクロールシューティングゲームで知られる日本のゲームデベロッパー。アーケード中心。',
  reason: '現在は実質活動停止と見られる。',
});
addDesc('マルチメディア インテリジェンス トランスファー', {
  description: '有限会社マルチメディア インテリジェンス トランスファー(MIT)。PS2向けゲームタイトル等を手がけた日本の小規模ゲームデベロッパー。',
});
addDesc('ワークジャム', {
  description: '株式会社ワークジャム(Work Jam Co., Ltd.)。格闘ゲームのアーケード版の開発等を手がけた日本のゲームデベロッパー。',
});
addDesc('悠紀エンタープライズ', {
  description: '悠紀エンタープライズ株式会社(Yuki Enterprise Co., Ltd.)。ゲームソフトの流通・販売に携わった日本の企業。',
});
addDesc('セリウス', {
  description: '株式会社セリウス(Celius Co., Ltd.)。PLAYSTATION3向けのゲーム開発支援を行うためにSCE(現SIE)とコードマスターズが共同設立した合弁会社。',
  reason: '合弁会社として設立されたが現在は解散済み。',
});
addDesc('スターファクトリー', {
  description: 'スターファクトリー。日本のゲームデベロッパー/パブリッシャー。',
});
addDesc('シング', {
  description: 'シング株式会社(SING Co., Ltd.)。日本のゲームデベロッパー。',
});
addDesc('朱雀', {
  description: '朱雀(Suzaku)。日本のゲームデベロッパー。',
});

// =====================================================================
// 残件カウント
// =====================================================================
const remaining = db.prepare(`SELECT COUNT(*) AS n FROM companies c
  WHERE c.description = '' AND (c.stock_reason IS NULL OR c.stock_reason = '')
    AND EXISTS (SELECT 1 FROM company_game cg WHERE cg.company_id = c.id)
    AND c.tags NOT LIKE '%個人企業%' AND c.tags NOT LIKE '%海外企業%'`).get().n;
console.log(`\nreason未記入かつdescription空の残り: ${remaining}件`);
db.close();
