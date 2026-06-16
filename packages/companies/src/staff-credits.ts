// スタッフロール (クレジット) 掲載元ページ本文 → ゲーム + 関与企業群 の決定論パーサ。
// 純粋関数 (LLM 不使用)。 spec/companies/game-graph.md §4 / §5.2 (Phase2 発見クロール)。
// 「full credits」対応: 開発/発売だけでなく 開発協力/外注/移植/QA 等の section も拾い、
// 外注スタジオの発見精度を上げる。 個人名は企業指標が無いため自然に除外される。

/** クレジット上の役割。 company_game.role に対応 (developer/publisher/support/credited)。 */
export type StaffCreditRole = 'developer' | 'publisher' | 'support' | 'credited';

export type StaffCredit = { company: string; role: StaffCreditRole };

export type StaffCredits = {
  /** ゲーム名 (hint 優先、 無ければ本文先頭の見出し行) */
  game: string;
  credits: StaffCredit[];
};

// section 見出しの役割判定。 「開発協力」は support、「開発」は developer なので support を先に判定する。
const ROLE_PATTERNS: { role: StaffCreditRole; re: RegExp }[] = [
  { role: 'support', re: /(co-?development|開発協力|協力会社|協力|support|外注|outsourc\w*|cooperation|porting|移植|qa\b|デバッグ|debug)/i },
  { role: 'publisher', re: /(publish\w*|発売元?|販売元?|パブリッシ\w*|distributed\s+by|distribution)/i },
  { role: 'developer', re: /(develop\w*|開発元?|デベロッパ\w*|制作|grid\s*studio)/i },
  { role: 'credited', re: /(special\s*thanks|スペシャルサンクス|協賛|関連会社|in\s+association\s+with|presented\s+by|localization|ローカライズ)/i },
];

// 企業らしさの指標。 これを含む行/トークンのみ企業として採り、 個人名・役職行を除外する。
const COMPANY_RE =
  /(株式会社|有限会社|合同会社|（株）|\(株\)|\bInc\.?|\bLtd\.?|\bLLC\b|\bCorp\.?|Co\.,?\s*Ltd|\bStudios?\b|\bGames?\b|\bInteractive\b|\bEntertainment\b|\bSoftware\b|スタジオ|ソフト(?:ウェア)?|ゲームス|エンタテインメント|インタラクティブ)/i;

function classifySection(line: string): StaffCreditRole | null {
  for (const p of ROLE_PATTERNS) if (p.re.test(line)) return p.role;
  return null;
}

/** 1 行から企業名トークンを切り出す (区切り 、，・/&「and」)。 企業指標を持つものだけ採る。
 *  ASCII ',' は "Cygames, Inc." 等の法人格表記に含まれるので区切りにしない。 */
function splitCompanies(s: string): string[] {
  return s
    .split(/[、，・/]|\s&\s|\sand\s/i)
    .map((t) => t.replace(/^[\s:：・\-―—]+|[\s:：・\-―—]+$/g, '').trim())
    .filter((t) => t.length >= 2 && t.length <= 80 && COMPANY_RE.test(t));
}

const MAX_CREDITS = 300;

/**
 * クレジット本文を解析して「ゲーム → 関与企業群 (役割つき)」を抽出する。
 * - section 見出し行で現在の役割を切り替え、 続く企業行を採る。
 * - 「役割: 企業A, 企業B」形式 (同一行) も解釈する。
 * - 企業指標 (株式会社 / Inc / Studio 等) を持つトークンのみ企業として採用 (個人名を除外)。
 * - game は opts.game (hint) を優先、 無ければ section/企業でない最初の行を見出しとみなす。
 * 役割不明の企業行は credited (関与) に倒す。 純粋・決定論。
 */
export function parseStaffCredits(pageText: string, opts: { game?: string } = {}): StaffCredits {
  let game = (opts.game ?? '').trim();
  const credits: StaffCredit[] = [];
  const seen = new Set<string>();
  let currentRole: StaffCreditRole = 'credited';

  const addCredit = (role: StaffCreditRole, company: string): void => {
    const name = company.trim();
    if (!name || credits.length >= MAX_CREDITS) return;
    const key = `${role}|${name}`;
    if (seen.has(key)) return;
    seen.add(key);
    credits.push({ company: name, role });
  };

  for (const raw of (pageText ?? '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;

    // 本文先頭の見出し行をゲーム名にする (section でも企業でもない最初の行)。
    if (!game && !classifySection(line) && !COMPANY_RE.test(line)) {
      game = line.slice(0, 200);
      continue;
    }

    // 「役割: 企業…」(同一行)。
    const ci = line.search(/[:：]/);
    if (ci > 0) {
      const head = line.slice(0, ci);
      const role = classifySection(head);
      if (role && !COMPANY_RE.test(head)) {
        currentRole = role;
        for (const c of splitCompanies(line.slice(ci + 1))) addCredit(role, c);
        continue;
      }
    }

    // section 見出し行 (役割語を含み、 それ自体は企業でない)。
    const headerRole = classifySection(line);
    if (headerRole && !COMPANY_RE.test(line)) {
      currentRole = headerRole;
      continue;
    }

    // 企業行 (現在の section の役割で採る)。
    if (COMPANY_RE.test(line)) {
      const parts = splitCompanies(line);
      if (parts.length > 0) for (const c of parts) addCredit(currentRole, c);
      else addCredit(currentRole, line.slice(0, 80));
    }
  }

  return { game, credits };
}
