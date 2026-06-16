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
function tag(name, country, note) {
  const id = findId(name);
  if (!id) { console.log(`NOT FOUND: ${name}`); return false; }
  addTag(id, '海外企業');
  appendReason(id, `${country}の企業。${note}`);
  return true;
}
function note(name, text) {
  const id = findId(name);
  if (!id) { console.log(`NOT FOUND: ${name}`); return false; }
  appendReason(id, text);
  return true;
}
function descAndNote(name, desc, loc, reason) {
  const row = db.prepare('SELECT id, description, stock_reason FROM companies WHERE name=?').get(name);
  if (!row) { console.log(`NOT FOUND: ${name}`); return; }
  const sets = ["updated_at = datetime('now')"];
  const params = [];
  if (desc && !row.description) { sets.push('description=?'); params.push(desc); }
  if (loc) { sets.push('location=?'); params.push(loc); }
  if (reason) {
    const cur = row.stock_reason || '';
    if (!cur.includes(reason.slice(0,20))) { sets.push('stock_reason=?'); params.push(cur ? cur + ' | ' + reason : reason); }
  }
  params.push(row.id);
  if (sets.length > 1) db.prepare(`UPDATE companies SET ${sets.join(', ')} WHERE id=?`).run(...params);
}

// 明確な海外企業
const overseas = [
  ['Zoo Publishing','アメリカ','Zoo Publishing。M&Mゲーム等の子ども向けゲームをパブリッシュした米国の企業。'],
  ['Apple Inc.','アメリカ','Apple Inc.。iOS向けゲームのプラットフォーム企業。ゲーム開発は行わない。'],
  ['Asphere Innovations','アメリカ','Asphere Innovations。メイプルストーリー等のモバイル版を手がけた米国のスタジオ。'],
  ['Bits Studios','イギリス','Bits Studios。英国のゲームデベロッパー。'],
  ['Black Hole Entertainment','ハンガリー','Black Hole Entertainment。Warhammer: Mark of Chaosを開発したハンガリーのスタジオ。'],
  ['Black Rock Studio','イギリス','Black Rock Studio。ATV Offroad Fury等を開発したディズニー傘下の英国スタジオ。2011年閉鎖。'],
  ['Blitz Arcade','イギリス','Blitz Arcade。英国のゲームスタジオ。PowerUp Forever等を開発。'],
  ['Boss Key Productions','アメリカ','Boss Key Productions。LawBreakersを開発したクリフ・ブレジンスキー主宰の米国スタジオ。2018年閉鎖。'],
  ['Bottlerocket Entertainment','アメリカ','Bottlerocket Entertainment。スプラッターハウス(2010年版)を開発した米国スタジオ。'],
  ['Camouflaj','アメリカ','Camouflaj。リパブリック等を開発した米国スタジオ。Iron Man VR/Bat Man Arkham Shadowも制作。'],
  ['Code Mystics','カナダ','Code Mystics。KOF 2002 Unlimited Match等の格闘ゲーム移植を専門とするカナダのスタジオ。'],
  ['Confounding Factor','イギリス','Confounding Factor。Galleon等を開発した英国スタジオ。'],
  ['Corecell Technology Co. Ltd.','タイ','Corecell Technology。AethenoBlade等を開発したタイのゲームスタジオ。'],
  ['Crunchyroll','アメリカ','Crunchyroll。アニメ配信サービス。プリコネRe:Dive等の海外版パブリッシャー役を担った。ゲーム開発は行わない。'],
  ['Cubejoy','中国','Cubejoy。Sekiro等のゲームを中国市場でパブリッシュした中国の企業。'],
  ['DMA Design','スコットランド','DMA Design。GTA初期シリーズを開発した英国スタジオ。後にRockstar North(Edinburgh)へ。'],
  ['Detn8 Games','アメリカ','Detn8 Games。米国のゲームスタジオ。'],
  ['Digital Embryo','アメリカ','Digital Embryo。M&M等のライセンスゲームを開発した米国スタジオ。'],
  ['Digital Reality','ハンガリー','Digital Reality。Black Knight Sword等を開発したハンガリーのゲームスタジオ。'],
  ['Dispatch Games','アメリカ','Dispatch Games。日本の鉄道シム等をパブリッシュした米国の専門パブリッシャー。'],
  ['Don\'t Nod','フランス','DONTNOD/Don\'t Nod。Life Is Strangeシリーズを開発したフランスのゲームスタジオ。'],
  ['DreamRift','アメリカ','DreamRift。Epic Mickey: Power of Illusion等を開発した米国のスタジオ。'],
  ['EA Sports Big','アメリカ','EA Sports Big (後のEA Canada/EA Black Box)。Def Jam Vendettaのアーケードスポーツタイトルを手がけた米国EAの部門。'],
  ['Eat Sleep Play','アメリカ','Eat Sleep Play。Twisted Metalシリーズを開発した米国スタジオ。2012年閉鎖。'],
  ['Eden Industries','カナダ','Eden Industries。シチズンズ・ユナイト等を開発したカナダのゲームスタジオ。'],
  ['Embark Studios','スウェーデン','Embark Studios。ARC Raidersを開発中のスウェーデンのゲームスタジオ。CODの元スタッフ設立。'],
  ['Engine Software','オランダ','Engine Software。Terrariaをコンソール向け移植したオランダのスタジオ。'],
  ['Eurocom','イギリス','Eurocom。Athens 2004等のライセンスゲームを手がけた英国スタジオ。2012年閉鎖。'],
  ['Eutechnyx','イギリス','Eutechnyx。THE FAST AND THE FURIOUSゲーム等のライセンスゲームを開発した英国スタジオ。'],
  ['Evolution Studios','イギリス','Evolution Studios。MotorStormシリーズを開発したSIE傘下の英国スタジオ。2016年閉鎖。'],
  ['Flagship Studios','アメリカ','Flagship Studios。Hellgate: Londonを開発した米国スタジオ。Blizzard出身者設立。2008年閉鎖。'],
  ['Fox Interactive','アメリカ','Fox Interactive。The X-Files Game等のFox IPゲームを展開した米国のゲームレーベル。'],
  ['Full Fat','イギリス','Full Fat。シムシティ2000等の英国スタジオ。'],
  ['Funbox Media','イギリス','Funbox Media。英国のゲームパブリッシャー。'],
  ['GTインタラクティブ','アメリカ','GT Interactive Software。ウィッチャー等のゲームを北米でパブリッシュした米国のゲームパブリッシャー。1999年頃解散。'],
  ['GameTek','アメリカ','GameTek Inc.。Frontier等をパブリッシュした米国のゲームメーカー。1998年倒産。'],
  ['Gas Powered Games','アメリカ','Gas Powered Games。Supreme Commander 2等を開発した米国スタジオ。Chris Taylor設立。'],
  ['HanbitSoft','韓国','HanbitSoft。ネオスチーム等の韓国オンラインゲームパブリッシャー。'],
  ['Hidden Path Entertainment','アメリカ','Hidden Path Entertainment。エイジ オブ エンパイアII HDを開発した米国スタジオ。'],
  ['IOインタラクティヴ','デンマーク','IO Interactive。HitmanシリーズとProject 007を開発するデンマークのトップスタジオ。'],
  ['Image Works','イギリス','Image Works。Bloodwych等を開発した英国のゲームメーカー(Mirrorsoft系)。'],
  ['Implausible Industries','アメリカ','Implausible Industries。RESEARCH and DESTROYを開発した米国スタジオ。'],
  ['Just Add Water','イギリス','Just Add Water。Gravity Crash等を開発した英国スタジオ。'],
  ['KOG Studios','韓国','KOG Studios。エルソード/Grand Chase等のオンラインアクションRPGを開発した韓国スタジオ。'],
  ['Klei Entertainment','カナダ','Klei Entertainment。Sugar Rush/Don\'t Starveシリーズ等を開発したカナダのインディースタジオ。'],
  ['Koei Tecmo Singapore','シンガポール','Koei Tecmo Singapore。DOA Xtreme等のアジア版展開を担うコーエーテクモのシンガポール子会社。'],
  ['Konami of America','アメリカ','Konami of America。コナミのアメリカ子会社。北米向けゲームの展開/パブリッシュ担当。'],
  ['Krome Studios Melbourne','オーストラリア','Krome Studios Melbourne。スター・ウォーズ等のライセンスゲームを開発したオーストラリアのスタジオ。2010年閉鎖。'],
  ['Level Up! Games','カナダ','Level Up! Games。メイプルストーリー等のゲームを展開したカナダのゲームパブリッシャー。'],
  ['MangaGamer','アメリカ','MangaGamer。日本のビジュアルノベルを英語化して展開する米国のパブリッシャー。'],
  ['Mass Media Inc.','アメリカ','Mass Media Inc.。ラチェット&クランク等のコンバージョンを手がけた米国のデベロッパー。'],
  ['Monolith Productions','アメリカ','Monolith Productions。No One Lives Forever 2/F.E.A.R.等を開発した米国スタジオ。Warner Bros.傘下。'],
  ['NEXON Korea','韓国','NEXON Korea。マビノギ等を開発したNexonの韓国本社スタジオ。'],
  ['NMS Software','イギリス','NMS Software。スター・ウォーズ等の初期PCゲームを開発した英国スタジオ。'],
  ['HanbitSoft','韓国','HanbitSoft。ネオスチーム等の韓国オンラインゲームパブリッシャー。'],
  ['Boltrend Games','台湾','Boltrend Games。Disgaea RPG等の東アジア向けモバイルゲームパブリッシャー(台湾系)。'],
  ['Ini3デジタル','台湾','Ini3デジタル(愛比數位)。プリンセスコネクト！Re:Dive等のゲームを台湾で展開したゲームパブリッシャー。'],
  ['Kru Interactive','韓国','Kru Interactive。MapleStory 2等に関与した韓国のゲームスタジオ。'],
  ['LODUMANI studio','?','LODUMANI studio。詳細不明の海外スタジオ。'],
  ['ERE Informatique','フランス','ERE Informatique。Purple Saturn Day等のフランスの旧ゲームメーカー。1980年代に活動。'],
  ['Metro3D Europe','イギリス','Metro3D Europe。アーマード・コア2等を欧州でパブリッシュした英国のゲームパブリッシャー。'],
  ['Metia Interactive','ポルトガル','Metia Interactive。Cube: 3D Puzzle Mayhemを開発したポルトガルのゲームスタジオ。'],
  ['Manaccom','オーストラリア','Manaccom。Wolfenstein 3Dをオーストラリアでパブリッシュした企業。'],
  ['EAD Tokyo Group No. 2','アメリカ?','EAD Tokyo Group No. 2。任天堂EAD東京の第2グループ。進め！キノピオ隊長等担当。独立法人ではない。'],
];

let tagged = 0, notFound = 0;
for (const [name, country, noteText] of overseas) {
  const id = findId(name);
  if (!id) { console.log(`NOT FOUND: ${name}`); notFound++; continue; }
  addTag(id, '海外企業');
  appendReason(id, `${country}の企業。${noteText}`);
  tagged++;
}

// 解散済み・内部・ブランド（日本）
const resolved = [
  ['CBSソニー','CBS/ソニー株式会社。ソニーミュージックの旧ゲーム部門。アーケードゲーム等を展開。後にソニーミュージックエンタテインメントに統合。HPなし。'],
  ['KCEO','コナミコンピュータエンタテインメント大阪(KCEO)。みつめてナイト等を開発したコナミの内部スタジオ。後にコナミデジタルエンタテインメントに統合。独立採用なし。'],
  ['Konami Computer Entertainment Tokyo, Inc.','コナミコンピュータエンタテインメント東京(KCET)。2004年コナミデジタルエンタテインメントに統合。みつめてナイト等を開発。HPなし。'],
  ['Fortyfive','フォーティファイブ株式会社。ドラえもんゲーム等を開発した日本のゲームメーカー。解散済み。HPなし。'],
  ['EIM','EIM。日本の旧ゲームメーカー。解散済み。HPなし。'],
  ['Hyperware','Hyperware。御存知 弥次喜多珍道中等を開発した日本のゲームメーカー。解散済み。HPなし。'],
  ['I\'MAX','I\'MAX（アイマックス）。日本のPCゲーム/成人向けゲームメーカー。解散済み。HPなし。'],
  ['DMM GAMES','DMM GAMESはEXNOAに改称済み。EXNOAを参照。'],
  ['Epoch','エポック社(Epoch Co., Ltd.)。日本の玩具・ゲームメーカー。パラソルヘンべえ等の自社タイトルと受託を手がける。現在は主に玩具事業が中心でゲーム採用規模縮小。'],
  ['EAD Tokyo Group No. 2','任天堂EAD東京第2グループ。進め！キノピオ隊長等を開発した任天堂の内部チーム。現在はNintendo EPDに統合。独立採用なし。'],
  ['ASK Kodansha Co., Ltd.','アスキー講談社(ASK Kodansha)。アディアンの杖等を展開した日本のゲームパブリッシャー。現在は解散済み。HPなし。'],
  ['King\'s International Multimedia Co., Ltd.','台湾のゲームパブリッシャー。マリオネットカンパニーの台湾版展開を担当。海外企業(台湾)。'],
  ['Bauhaus Entertainment','詳細不明の企業。スーパーマリオ 3Dランドのクレジットは任天堂EPD。DBデータ誤登録の可能性あり。'],
  ['Bitmasters','旧ゲームデベロッパー。Championship Pool等を開発した小規模スタジオ。詳細不明。HPなし。'],
];

let updated = 0;
for (const [name, noteText] of resolved) {
  const id = findId(name);
  if (!id) { console.log(`NOT FOUND(res): ${name}`); continue; }
  appendReason(id, noteText);
  updated++;
}

// アクティブ日本企業に description
descAndNote('トレジャー', 'グラディウスV/バンガイオ/斑鳩/罪と罰等の高品質なアクションゲームで世界的評価を受けるゲームデベロッパー。1992年コナミ出身者が設立。東京。', '東京', null);
descAndNote('ディ・テクノ', 'おそ松さん等のアニメIPゲームを開発する日本のゲームスタジオ。', '日本', null);
descAndNote('ARIA', '千の刃濤、桃花染の皇姫等のビジュアルノベルを制作する日本のゲームブランド。', null, null);
descAndNote('Ambrella', 'スーパーポケモンスクランブル等のポケモンゲームを開発した日本のゲームスタジオ(任天堂/ポケモン社との協業多数)。', '日本', null);
descAndNote('Armor Project', 'ドラゴンクエストシリーズのプロデューサー堀井雄二氏のゲーム制作プロダクション。いただきストリートDS等を担当。独自採用規模は小さい。', '東京', null);
descAndNote('D4エンタープライズ', 'バーチャルコンソール/デジタル配信による旧作ゲームの発掘・配信を専門とする日本のゲームパブリッシャー。', '東京', null);
descAndNote('CLOCKUP', '眠れぬ羊と孤独な狼等の成人向けビジュアルノベルを制作する日本のゲームスタジオ。独特の世界観とシナリオで評価が高い。', '日本', null);
descAndNote('GAE', '女性向けビジュアルノベルを制作する日本のゲームスタジオ。', '日本', null);
descAndNote('GN Software', 'Angel\'s Feather等の成人向けBLビジュアルノベルを制作した日本のゲームスタジオ。', '日本', null);
descAndNote('Hikari Field', 'アオナツライン等のビジュアルノベルを制作する日本のゲームスタジオ。', '日本', null);
descAndNote('Key', 'Heaven Burns Red/Kanon/CLANNAD等の感動的なビジュアルノベルを制作するVisualArts傘下のゲームブランド。音楽とシナリオのクオリティで絶大な人気を誇る。', '大阪', null);
descAndNote('MiCROViSion Inc.', 'サイキン恋シテル？等の乙女向けゲームを制作する日本のゲームスタジオ。', '日本', null);
descAndNote('CRT GAMES', 'サイキン5エターナル等の旧作アーケードゲームの復刻版を手がける日本のゲームスタジオ。', '日本', null);
descAndNote('HUBLOTS CO., Ltd', 'Timepiece Ensemble等のビジュアルノベルを制作する日本のゲームスタジオ。', '日本', null);
descAndNote('Kagami Games', 'かりぐらし恋愛等の乙女向けゲームを制作する日本のゲームスタジオ。', '日本', null);
descAndNote('メディアエンターテイメント', '日本の旧ゲームメーカー。キュイーン等のFC/GB向けゲームを開発。', '日本', '詳細不明、解散済みと思われる。HPなし。');
descAndNote('魔法', '日本の旧アーケードゲームメーカー。スカイデストロイヤー/スクーン等を開発。解散済み。', '日本', '解散済み。HPなし。');
descAndNote('Game Source Entertainment', 'オランピアソワレ等のゲームを台湾/アジア向けにパブリッシュしているゲームパブリッシャー。', null, '台湾系の企業の可能性あり。海外企業として要確認。');

const remaining = db.prepare(`SELECT COUNT(*) AS n FROM companies c
  WHERE c.description = '' AND (c.stock_reason IS NULL OR c.stock_reason = '')
    AND EXISTS (SELECT 1 FROM company_game cg WHERE cg.company_id = c.id)
    AND c.tags NOT LIKE '%個人企業%' AND c.tags NOT LIKE '%海外企業%'`).get().n;
console.log(`\n海外タグ: ${tagged}件 / 記録: ${updated}件 / 未発見: ${notFound}件`);
console.log(`reason未記入かつdescription空の残り: ${remaining}件`);
db.close();
