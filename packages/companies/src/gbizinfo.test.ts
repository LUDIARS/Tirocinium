import { describe, it, expect } from 'vitest';
import { normalizeCorporateNumber, gbizHojinUrl, gbizInfoRecordToCompany } from './gbizinfo.js';
import type { GBizHojin } from './gbizinfo.js';

describe('normalizeCorporateNumber', () => {
  it('13桁の数字のみ通す (区切り除去)', () => {
    expect(normalizeCorporateNumber('1234567890123')).toBe('1234567890123');
    expect(normalizeCorporateNumber('1234-56-7890123')).toBe('1234567890123');
  });
  it('桁数不正 / 空 は ""', () => {
    expect(normalizeCorporateNumber('123')).toBe('');
    expect(normalizeCorporateNumber(undefined)).toBe('');
    expect(normalizeCorporateNumber('abc')).toBe('');
  });
});

describe('gbizHojinUrl', () => {
  it('法人番号から公開詳細ページ URL を組む', () => {
    expect(gbizHojinUrl('1234567890123')).toBe('https://info.gbiz.go.jp/hojin/ichiran?hojinBango=1234567890123');
  });
  it('不正番号は ""', () => {
    expect(gbizHojinUrl('123')).toBe('');
  });
});

describe('gbizInfoRecordToCompany', () => {
  it('会社属性のみを CompanyInput に写し、 法人番号を分離して返す', () => {
    const rec: GBizHojin = {
      corporate_number: '1234567890123',
      name: '株式会社サンプルゲームズ',
      location: '東京都渋谷区',
      company_url: 'https://example.com',
      business_summary: 'ゲームソフトウェアの開発',
      business_items: ['ソフトウェア業', 'ゲーム'],
      employee_number: 120,
      date_of_establishment: '2005-04-01',
    };
    const out = gbizInfoRecordToCompany(rec)!;
    expect(out.corporate_number).toBe('1234567890123');
    expect(out.input.name).toBe('株式会社サンプルゲームズ');
    expect(out.input.url).toBe('https://example.com');
    expect(out.input.industry).toBe('ゲームソフトウェアの開発');
    expect(out.input.location).toBe('東京都渋谷区');
    expect(out.input.tags).toEqual(['ソフトウェア業', 'ゲーム']);
    expect(out.input.employeeCount).toBe(120);
    expect(out.input.source).toBe('gbizinfo');
    expect(out.input.source_url).toContain('hojinBango=1234567890123');
  });

  it('business_summary 欠落時は business_items の先頭を industry に使う', () => {
    const out = gbizInfoRecordToCompany({ name: 'X社', business_items: ['情報サービス業'] })!;
    expect(out.input.industry).toBe('情報サービス業');
  });

  it('社名空は null、 法人番号不正は corporate_number="" でも CompanyInput は返す', () => {
    expect(gbizInfoRecordToCompany({ name: '' })).toBeNull();
    const out = gbizInfoRecordToCompany({ name: 'Y社', corporate_number: 'bad' })!;
    expect(out.corporate_number).toBe('');
    expect(out.input.source_url).toBe('');
  });

  it('個人列 (representative 等) は型にも結果にも乗らない', () => {
    const out = gbizInfoRecordToCompany({ name: 'Z社', employee_number: 5 } as GBizHojin)!;
    expect(JSON.stringify(out)).not.toMatch(/representative|氏名/);
  });
});
