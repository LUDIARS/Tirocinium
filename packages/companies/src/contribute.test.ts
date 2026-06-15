import { describe, it, expect } from 'vitest';
import { parseLinkContribution } from './contribute.js';

describe('parseLinkContribution', () => {
  it('company を抽出する', () => {
    const r = parseLinkContribution(JSON.stringify({
      type: 'company', name: '株式会社X', industry: 'ゲーム開発', description: '自社開発スタジオ',
      location: '東京', tags: ['Unity', 'C#'], reason: '会社概要ページ',
    }));
    expect(r.type).toBe('company');
    expect(r.name).toBe('株式会社X');
    expect(r.industry).toBe('ゲーム開発');
    expect(r.tags).toEqual(['Unity', 'C#']);
  });

  it('game を抽出する (developers/publishers/series)', () => {
    const r = parseLinkContribution(JSON.stringify({
      type: 'game', name: 'スーパーゲーム', developers: ['開発社A'], publishers: ['発売社B'], series: 'シリーズZ',
    }));
    expect(r.type).toBe('game');
    expect(r.name).toBe('スーパーゲーム');
    expect(r.developers).toEqual(['開発社A']);
    expect(r.series).toBe('シリーズZ');
  });

  it('newgrad を抽出する', () => {
    const r = parseLinkContribution('{"type":"newgrad","name":"株式会社Y","description":"内定者インタビュー"}');
    expect(r.type).toBe('newgrad');
    expect(r.description).toBe('内定者インタビュー');
  });

  it('前後にテキストがあっても JSON ブロックを拾う', () => {
    const r = parseLinkContribution('解析結果はこちら:\n{"type":"company","name":"Z社"}\n以上です');
    expect(r.type).toBe('company');
    expect(r.name).toBe('Z社');
  });

  it('未知 type / 壊れた JSON は other に落とす', () => {
    expect(parseLinkContribution('{"type":"weird","name":"a"}').type).toBe('other');
    expect(parseLinkContribution('not json').type).toBe('other');
    expect(parseLinkContribution('not json').name).toBe('');
  });

  it('長すぎる値は切り詰める', () => {
    const r = parseLinkContribution(JSON.stringify({ type: 'company', name: 'あ'.repeat(500) }));
    expect(r.name.length).toBe(200);
  });
});
