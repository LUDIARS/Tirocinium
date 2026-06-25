import { describe, it, expect } from 'vitest';
import {
  isHiringNews,
  jobPostingFromFeed,
  parseJobListing,
  jobPostingFromListing,
  isNewgradEligible,
  type JobListingEntry,
} from './job-posting.js';
import type { FeedItem } from './rss.js';

const feed = (over: Partial<FeedItem>): FeedItem => ({
  title: '',
  link: 'https://x.test/1',
  description: '',
  publishedAt: '',
  categories: [],
  ...over,
});

const entry = (over: Partial<JobListingEntry>): JobListingEntry => ({
  title: 'T', companyName: '', url: '', role: '', location: '', employmentType: '',
  snippet: '', deadline: '', newgrad: false, inexperiencedOk: false, ...over,
});

describe('isHiringNews', () => {
  it('タイトル/カテゴリに採用語があれば true', () => {
    expect(isHiringNews(feed({ title: '新卒採用を開始' }))).toBe(true);
    expect(isHiringNews(feed({ title: '中途エンジニアを採用' }))).toBe(true);
    expect(isHiringNews(feed({ categories: ['求人'] }))).toBe(true);
    expect(isHiringNews(feed({ title: 'オンライン採用説明会を定期開催' }))).toBe(true);
  });
  it('採用語が無ければ false', () => {
    expect(isHiringNews(feed({ title: '新作ゲーム発表', description: 'リリース日確定' }))).toBe(false);
  });
  it('本文だけに採用語があっても false (まとめ記事の誤検出を避ける)', () => {
    // ランキング/まとめ記事が本文に採用語を巻き込むケースを除外する。
    expect(isHiringNews(feed({ title: 'Google Playランキング', description: '中途採用のニュースも掲載' }))).toBe(false);
  });
  it('ガチャ/イベントの「募集」では誤検出しない', () => {
    expect(isHiringNews(feed({ title: '復刻ピックアップ募集を開催' }))).toBe(false);
  });
});

describe('jobPostingFromFeed', () => {
  it('rss item を正規化する (dedupKey = hash/query 除去 URL)', () => {
    const item = jobPostingFromFeed('gamebiz-rss', feed({
      title: '採用ニュース',
      link: 'https://gamebiz.jp/news/100?utm=x#top',
      description: 'A'.repeat(500),
      publishedAt: '2026-06-18T00:00:00.000Z',
    }));
    expect(item).not.toBeNull();
    expect(item!.kind).toBe('rss');
    expect(item!.dedupKey).toBe('https://gamebiz.jp/news/100');
    expect(item!.snippet.length).toBe(400);
    expect(item!.postedAt).toBe('2026-06-18T00:00:00.000Z');
  });
  it('title / link 欠落は null', () => {
    expect(jobPostingFromFeed('s', feed({ title: '', link: 'https://x/1' }))).toBeNull();
    expect(jobPostingFromFeed('s', feed({ title: 'x', link: '' }))).toBeNull();
  });
});

describe('parseJobListing', () => {
  it('LLM JSON から jobs を抽出 (title 必須・不明は空文字)', () => {
    const text = `話の前置き\n{"jobs":[
      {"title":"3Dデザイナー","company":"ネコノメ","role":"デザイナー","url":"https://x/job/1","deadline":"2026-07-31","newgrad":true},
      {"title":"","company":"無視される"},
      {"title":"サーバーエンジニア","inexperienced_ok":true}
    ]}`;
    const rows = parseJobListing(text);
    expect(rows).toHaveLength(2);
    expect(rows[0]!.title).toBe('3Dデザイナー');
    expect(rows[0]!.companyName).toBe('ネコノメ');
    expect(rows[0]!.deadline).toBe('2026-07-31');
    expect(rows[0]!.newgrad).toBe(true);
    expect(rows[0]!.inexperiencedOk).toBe(false);
    expect(rows[1]!.title).toBe('サーバーエンジニア');
    expect(rows[1]!.inexperiencedOk).toBe(true);
  });
});

describe('isNewgradEligible', () => {
  it('LLM フラグ newgrad / inexperiencedOk が true なら true', () => {
    expect(isNewgradEligible(entry({ newgrad: true }))).toBe(true);
    expect(isNewgradEligible(entry({ inexperiencedOk: true }))).toBe(true);
  });
  it('フラグ false でもタイトル/説明に新卒・未経験語があれば true', () => {
    expect(isNewgradEligible(entry({ title: '【未経験歓迎】ゲームスクリプター' }))).toBe(true);
    expect(isNewgradEligible(entry({ snippet: '新卒採用を実施中' }))).toBe(true);
    expect(isNewgradEligible(entry({ title: '第二新卒OK' }))).toBe(true);
  });
  it('中途/経験者のみは false', () => {
    expect(isNewgradEligible(entry({ title: 'プロジェクトマネージャー', snippet: '経験者優遇', employmentType: '正社員' }))).toBe(false);
  });
});

describe('jobPostingFromListing', () => {
  it('詳細 URL があればそれを dedupKey に', () => {
    const item = jobPostingFromListing('gamebiz-jobs', 'https://gamebiz.jp/jobs',
      entry({ title: 'プランナー', companyName: 'A社', url: 'https://gamebiz.jp/jobs/55', role: 'プランナー', location: '東京', employmentType: '正社員' }));
    expect(item!.kind).toBe('job-listing');
    expect(item!.dedupKey).toBe('https://gamebiz.jp/jobs/55');
    expect(item!.companyName).toBe('A社');
  });
  it('詳細 URL が無ければ pageUrl#title@company を合成キーに', () => {
    const a = jobPostingFromListing('s', 'https://x/jobs', entry({ title: 'QA', companyName: 'A社' }));
    const b = jobPostingFromListing('s', 'https://x/jobs', entry({ title: 'QA', companyName: 'B社' }));
    // 同じ title でも company が違えば別キー (取りこぼし防止)。
    expect(a!.dedupKey).not.toBe(b!.dedupKey);
    expect(a!.dedupKey).toBe('https://x/jobs#QA@A社');
  });
  it('recruit-page: opts で社名と kind を固定する', () => {
    // 自社採用ページの求人に社名表記が無くても、 既知社名で company_id 解決できるよう固定する。
    const item = jobPostingFromListing('melpot-career', 'https://melpot.com/career/',
      entry({ title: '3Dアーティスト', companyName: '' }),
      { companyName: '株式会社MELPOT', kind: 'recruit-page' });
    expect(item!.kind).toBe('recruit-page');
    expect(item!.companyName).toBe('株式会社MELPOT');
    // dedupKey の合成にも固定社名が乗る (normalizeUrl は末尾スラッシュを落とす)。
    expect(item!.dedupKey).toBe('https://melpot.com/career#3Dアーティスト@株式会社MELPOT');
  });
  it('opts.companyName は LLM 抽出値より優先する', () => {
    const item = jobPostingFromListing('s', 'https://x/career', entry({ title: 'UI', companyName: '誤抽出社' }),
      { companyName: '株式会社リンクトブレイン', kind: 'recruit-page' });
    expect(item!.companyName).toBe('株式会社リンクトブレイン');
  });
});
