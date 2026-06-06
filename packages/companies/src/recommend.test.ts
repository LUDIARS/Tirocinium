import { describe, it, expect } from 'vitest';
import { parseRecommendation, recommendHeuristic, renderProfile } from './recommend.js';
import type { ApplicantProfile, Company } from './types.js';

function company(over: Partial<Company>): Company {
  return {
    id: 'c1',
    name: 'テスト社',
    normalized_name: 'てすと',
    url: '',
    industry: '',
    description: '',
    roles: [],
    tags: [],
    location: '',
    size: '',
    source: 's',
    source_url: '',
    crawled_at: '',
    updated_at: '',
    ...over,
  };
}

describe('parseRecommendation', () => {
  it('keeps only valid ids and clamps score, sorts desc', () => {
    const text = JSON.stringify({
      items: [
        { company_id: 'a', score: 40, reasons: ['r1'], concerns: [] },
        { company_id: 'ghost', score: 99, reasons: ['hallucinated'] }, // dropped
        { company_id: 'b', score: 200, reasons: ['r2'] }, // clamp to 100
      ],
    });
    const out = parseRecommendation(text, new Set(['a', 'b']));
    expect(out.map((i) => i.company_id)).toEqual(['b', 'a']);
    expect(out[0]!.score).toBe(100);
  });

  it('filters blank reason strings', () => {
    const text = JSON.stringify({ items: [{ company_id: 'a', score: 10, reasons: ['ok', ''] }] });
    const out = parseRecommendation(text, new Set(['a']));
    expect(out[0]!.reasons).toEqual(['ok']);
  });
});

describe('recommendHeuristic', () => {
  it('ranks and labels via heuristic, marks role concern when unmatched', () => {
    const profile: ApplicantProfile = {
      esText: 'Unity ゲーム開発',
      targetRole: 'programmer',
      tags: ['Unity'],
    };
    const companies = [
      company({ id: 'match', roles: ['programmer'], tags: ['Unity'], description: 'Unity' }),
      company({ id: 'partial', roles: ['designer'], tags: ['Unity'] }),
      company({ id: 'none', roles: ['designer'], tags: [], description: '無関係' }),
    ];
    const res = recommendHeuristic(profile, companies, { topK: 5 });
    expect(res.method).toBe('heuristic');
    expect(res.items[0]!.company_id).toBe('match');
    expect(res.items[0]!.name).toBe('テスト社');
    const partial = res.items.find((i) => i.company_id === 'partial');
    expect(partial?.concerns).toContain('志望職種の募集有無を要確認');
    expect(res.items.find((i) => i.company_id === 'none')).toBeUndefined();
  });
});

describe('renderProfile', () => {
  it('includes target role and truncates es text', () => {
    const profile: ApplicantProfile = {
      esText: 'x'.repeat(5000),
      targetRole: 'programmer',
      tags: ['Unity'],
      weakAxes: ['clarity'],
    };
    const md = renderProfile(profile);
    expect(md).toContain('志望職種: programmer');
    expect(md).toContain('鍛えたい弱点軸: clarity');
    expect(md.length).toBeLessThan(4300);
  });
});
