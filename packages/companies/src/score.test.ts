import { describe, it, expect } from 'vitest';
import { scoreCompany, rankCandidates, tokenize } from './score.js';
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

describe('tokenize', () => {
  it('splits on punctuation and drops short tokens', () => {
    const t = tokenize('Unity、C#・ゲーム開発');
    expect(t.has('unity')).toBe(true);
    expect(t.has('ゲーム開発')).toBe(true);
  });
});

describe('scoreCompany', () => {
  const profile: ApplicantProfile = {
    esText: 'Unity でゲーム開発を3年やってきました',
    targetRole: 'programmer',
    tags: ['Unity', 'C#'],
  };

  it('rewards role match + tag overlap + keyword hits', () => {
    const c = company({
      roles: ['programmer'],
      tags: ['Unity'],
      description: 'Unity を使ったゲーム開発',
    });
    const b = scoreCompany(profile, c);
    expect(b.roleMatch).toBe(true);
    expect(b.tagOverlap).toContain('Unity');
    expect(b.score).toBeGreaterThan(35);
  });

  it('gives zero when nothing matches', () => {
    const c = company({ roles: ['designer'], tags: ['Photoshop'], description: '広告制作' });
    expect(scoreCompany(profile, c).score).toBe(0);
  });

  it('caps at 100', () => {
    const c = company({
      roles: ['programmer'],
      tags: ['Unity', 'C#'],
      description: 'Unity C# ゲーム開発 3年',
    });
    expect(scoreCompany(profile, c).score).toBeLessThanOrEqual(100);
  });
});

describe('rankCandidates', () => {
  it('sorts by score desc, drops zero-score, applies limit', () => {
    const profile: ApplicantProfile = { esText: 'Unity', targetRole: 'programmer', tags: ['Unity'] };
    const list = [
      company({ id: 'a', roles: [], tags: [] }), // 0 → dropped
      company({ id: 'b', roles: ['programmer'], tags: [] }), // role only
      company({ id: 'c', roles: ['programmer'], tags: ['Unity'] }), // role + tag
    ];
    const ranked = rankCandidates(profile, list, 5);
    expect(ranked.map((r) => r.company.id)).toEqual(['c', 'b']);
  });
});
