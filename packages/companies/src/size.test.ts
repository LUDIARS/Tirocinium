import { describe, it, expect } from 'vitest';
import {
  extractEmployeeCount,
  extractEmployeeFromIR,
  parseListingMarket,
  isSMBByEmployees,
  listingLabel,
  SMB_EMPLOYEE_MAX,
} from './size.js';

describe('extractEmployeeCount', () => {
  it('parses 従業員数128名', () => {
    expect(extractEmployeeCount('従業員数128名(2026年2月末)')).toBe(128);
  });
  it('parses 従業員数102人', () => {
    expect(extractEmployeeCount('従業員数102人(2026年4月現在)')).toBe(102);
  });
  it('takes upper bound of a range', () => {
    expect(extractEmployeeCount('従業員数約4〜6名(極小規模スタートアップ)')).toBe(6);
  });
  it('handles comma separators', () => {
    expect(extractEmployeeCount('社員数 1,200名')).toBe(1200);
  });
  it('handles 万 unit', () => {
    expect(extractEmployeeCount('従業員数 約1.2万人')).toBe(12000);
  });
  it('skips 連結/単独 prefix words before the number', () => {
    expect(extractEmployeeCount('従業員数: 連結8,666名・単独3,084名(2026年3月末現在)')).toBe(8666);
    expect(extractEmployeeCount('従業員数: グループ全体1,520名（2026年3月末時点）')).toBe(1520);
  });
  it('does NOT pick capital/other numbers (no 従業員 anchor)', () => {
    expect(extractEmployeeCount('資本金9,000万円。設立2000年6月。')).toBe(0);
  });
  it('returns 0 for unknown / empty', () => {
    expect(extractEmployeeCount(undefined)).toBe(0);
    expect(extractEmployeeCount('非公開')).toBe(0);
  });
});

describe('extractEmployeeFromIR', () => {
  it('falls back to the same anchor extraction as extractEmployeeCount', () => {
    expect(extractEmployeeFromIR('従業員数 540名（2026年3月期）')).toBe(540);
    expect(extractEmployeeFromIR('社員数 1,200名')).toBe(1200);
  });
  it('prefers 連結 (consolidated) over 単体 regardless of marker position', () => {
    // 連結が先 (前置語マーカー)。
    expect(extractEmployeeFromIR('従業員数 連結12,345名 単体3,400名')).toBe(12345);
    // 単体が先・連結が後 でも連結を採る。
    expect(extractEmployeeFromIR('従業員数：単独3,084名／連結8,666名')).toBe(8666);
  });
  it('reads 連結 from a trailing parenthetical note', () => {
    expect(extractEmployeeFromIR('従業員数 8,900名（連結）')).toBe(8900);
    // 末尾注記で連結/単体を区別できる場合は連結を採る (出現順に依らない)。
    expect(extractEmployeeFromIR('従業員数 2,100名（連結）、従業員数 420名（単体）')).toBe(2100);
  });
  it('uses the max when no consolidation marker is present', () => {
    expect(extractEmployeeFromIR('東京拠点 従業員120名、大阪拠点 従業員80名')).toBe(120);
  });
  it('handles 万 unit IR phrasing', () => {
    expect(extractEmployeeFromIR('従業員数 連結 約1.1万人（2026年3月末）')).toBe(11000);
  });
  it('returns 0 when no 従業員 anchor (avoids 資本金/売上 noise)', () => {
    expect(extractEmployeeFromIR('資本金1,000百万円、売上高45,000百万円。')).toBe(0);
    expect(extractEmployeeFromIR(undefined)).toBe(0);
  });
});

describe('isSMBByEmployees', () => {
  it('unknown (0) is SMB', () => expect(isSMBByEmployees(0)).toBe(true));
  it('at threshold is SMB', () => expect(isSMBByEmployees(SMB_EMPLOYEE_MAX)).toBe(true));
  it('above threshold is NOT SMB', () => expect(isSMBByEmployees(SMB_EMPLOYEE_MAX + 1)).toBe(false));
  it('small is SMB', () => expect(isSMBByEmployees(50)).toBe(true));
});

describe('parseListingMarket', () => {
  it('prime from 東証プライム / 一部上場', () => {
    expect(parseListingMarket('東証プライム上場 (証券コード7974)')).toBe('prime');
    expect(parseListingMarket('東証一部上場')).toBe('prime');
  });
  it('growth from 東証グロース / マザーズ', () => {
    expect(parseListingMarket('東証グロース上場 (証券コード: 4199)')).toBe('growth');
    expect(parseListingMarket('マザーズ上場')).toBe('growth');
  });
  it('standard from スタンダード / JASDAQ', () => {
    expect(parseListingMarket('東証スタンダード市場')).toBe('standard');
    expect(parseListingMarket('JASDAQ上場')).toBe('standard');
  });
  it('other for generic 上場 without market', () => {
    expect(parseListingMarket('上場企業')).toBe('other');
  });
  it('empty for 非上場', () => {
    expect(parseListingMarket('非上場スタートアップ。')).toBe('');
    expect(parseListingMarket('非上場。任天堂の100%子会社')).toBe('');
  });
  it('empty for unknown', () => {
    expect(parseListingMarket('', undefined)).toBe('');
  });
  it('uses fallback args (seed.tag)', () => {
    expect(parseListingMarket('', 'ホンネナビ, 上場, ﾃﾞｨﾍﾞﾛｯﾊﾟｰ')).toBe('other');
    expect(parseListingMarket('', 'ホンネナビ, 非上場')).toBe('');
  });
});

describe('listingLabel', () => {
  it('maps codes to JP labels', () => {
    expect(listingLabel('prime')).toContain('一部上場');
    expect(listingLabel('growth')).toContain('マザーズ');
    expect(listingLabel('')).toBe('');
  });
});
