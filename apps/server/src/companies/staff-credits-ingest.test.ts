import { describe, it, expect } from 'vitest';
import {
  ingestStaffCredits,
  emptyStaffCreditsSummary,
  type StaffCreditsDeps,
} from './staff-credits-ingest.js';

type Edge = { companyId: string; gameId: string; role: string };

function fakeDeps(known: Set<string>, edges: Edge[]): StaffCreditsDeps {
  let gameSeq = 0;
  return {
    async resolveGameId(title) {
      return title ? `game:${title}` : null;
    },
    async resolveCompanyId(name) {
      if (!name) return null;
      const isNew = !known.has(name);
      known.add(name);
      return { id: `co:${name}`, isNew };
    },
    async link(companyId, gameId, role) {
      void gameSeq;
      edges.push({ companyId, gameId, role });
    },
  };
}

describe('ingestStaffCredits', () => {
  it('resolves the game and links credited companies with their roles', async () => {
    const edges: Edge[] = [];
    const deps = fakeDeps(new Set(), edges);
    const summary = emptyStaffCreditsSummary();
    const text = ['Gの伝説', 'Developed by', '株式会社開発元', '開発協力', '株式会社外注スタジオ'].join('\n');
    await ingestStaffCredits(text, deps, summary);
    expect(summary.games).toBe(1);
    expect(summary.edges).toBe(2);
    expect(edges).toContainEqual({ companyId: 'co:株式会社開発元', gameId: 'game:Gの伝説', role: 'developer' });
    expect(edges).toContainEqual({ companyId: 'co:株式会社外注スタジオ', gameId: 'game:Gの伝説', role: 'support' });
  });

  it('counts only previously-unknown companies as newCompanies (auto-discovery)', async () => {
    const edges: Edge[] = [];
    const known = new Set<string>(['株式会社既知']);
    const deps = fakeDeps(known, edges);
    const summary = emptyStaffCreditsSummary();
    const text = ['G', 'Developed by', '株式会社既知', '株式会社新顔'].join('\n');
    await ingestStaffCredits(text, deps, summary);
    expect(summary.edges).toBe(2);
    expect(summary.newCompanies).toBe(1); // 株式会社新顔 のみ
  });

  it('skips when no game title or no company credits', async () => {
    const summary = emptyStaffCreditsSummary();
    await ingestStaffCredits('株式会社A', fakeDeps(new Set(), []), summary); // game title 無し
    await ingestStaffCredits('Gだけ\n（クレジットなし）', fakeDeps(new Set(), []), summary); // company 無し
    expect(summary.games).toBe(0);
    expect(summary.edges).toBe(0);
  });
});
