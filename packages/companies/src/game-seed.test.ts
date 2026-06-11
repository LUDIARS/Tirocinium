import { describe, it, expect } from 'vitest';
import { mapGameCompanySeed } from './game-seed.js';
import { normalizeCompany } from './normalize.js';

const seed = {
  name: '株式会社ネコノメ',
  company_url: 'https://neconome.co.jp/#message',
  recruit_url: 'https://neconome.co.jp/#recruit',
  titles: '神託のメソロギア',
  platform: 'モバイル',
  roles: 'クライアントプログラマー',
  tech: 'Unity, C#',
  tag: 'ベンチャー',
  location: '東京都中央区',
};

const research = {
  name: '株式会社ネコノメ',
  recruiting_status: '募集中',
  recruit_url: 'https://sg.wantedly.com/companies/neconome',
  recruiting_note: 'Wantedlyで3Dモデラー職を1件募集中。新卒も歓迎。',
  ir_recent: 'シリーズAで1億1,000万円を調達。',
  size: '設立: 2024年1月。従業員数: 約4〜6名(極小規模スタートアップ)。',
  games: '神託のメソロギア, 棋桜-KIOU-',
  game_kind: 'ソーシャル',
  tech_stack: ['Unity', 'C#', 'iOS'],
  features: '「ゲーム好きの、ゲーム好きによる、ゲーム好きのための会社」を掲げる超少数精鋭スタートアップ。',
  sources: ['https://example.com/research'],
};

describe('mapGameCompanySeed', () => {
  it('returns null when name is missing', () => {
    expect(mapGameCompanySeed({})).toBeNull();
  });

  it('maps seed + research into a company input + signals + profile', () => {
    const m = mapGameCompanySeed(seed, research)!;
    expect(m).not.toBeNull();
    expect(m.input.name).toBe('株式会社ネコノメ');
    expect(m.input.industry).toBe('ゲーム');
    expect(m.input.source).toBe('game-seed');
    // 職種は含有判定で programmer を拾う ("クライアントプログラマー")
    expect(m.input.roles).toContain('programmer');
    // tags は tag / platform / game_kind / tech を統合
    expect(m.input.tags).toEqual(expect.arrayContaining(['ベンチャー', 'モバイル', 'ソーシャル', 'Unity']));
    // size は従業員数の「値」部分を優先抽出 (ラベルは落とす)
    expect(m.input.size).toContain('約4〜6名');
    expect(m.input.size).not.toContain('設立');
  });

  it('derives flags: game always true, opening from status, newgrad from notes', () => {
    const m = mapGameCompanySeed(seed, research)!;
    expect(m.flags.isGame).toBe(true);
    expect(m.flags.hasOpening).toBe(true);
    expect(m.flags.isNewgrad).toBe(true);
    expect(m.stockReason).toContain('募集中');
    expect(m.stockReason).toContain('新卒採用あり');
  });

  it('builds profile from features / ir / games', () => {
    const m = mapGameCompanySeed(seed, research)!;
    expect(m.profile.philosophy).toContain('ゲーム好き');
    expect(m.profile.ir_summary).toContain('1億1,000万円');
    expect(m.profile.business).toContain('神託のメソロギア');
    expect(m.profile.sources).toContain('https://example.com/research');
  });

  it('hasOpening false when not 募集中', () => {
    const m = mapGameCompanySeed(seed, { ...research, recruiting_status: '募集なし', recruiting_note: '' })!;
    expect(m.flags.hasOpening).toBe(false);
    expect(m.flags.isNewgrad).toBe(false);
    expect(m.stockReason).toBe('ゲーム企業');
  });

  it('output feeds normalizeCompany without loss of key fields', () => {
    const m = mapGameCompanySeed(seed, research)!;
    const n = normalizeCompany(m.input)!;
    expect(n).not.toBeNull();
    expect(n.normalized_name).toBe('ネコノメ');
    expect(n.roles).toContain('programmer');
  });
});
