import { describe, expect, it } from 'vitest';
import { loadQaSeed } from './qa-seed-loader.js';

// data/general/qa-seed/<stage>/ には現状 programmer.json のみ存在する。
// リポジトリ実ファイルを読む (fixture 複製はしない — シード自体が正本)。

describe('loadQaSeed', () => {
  it('存在する role はそのまま読む (fallback なし)', async () => {
    const r = await loadQaSeed('hr', 'programmer');
    expect(r.fallbackRole).toBeNull();
    expect(r.items.length).toBeGreaterThan(0);
    const item = r.items[0]!;
    expect(item.origin).toBe('seed');
    expect(item.question.length).toBeGreaterThan(0);
    expect(item.theme.length).toBeGreaterThan(0);
  });

  it('role ファイルが無ければ同 stage の先頭ファイルへ明示退避する', async () => {
    const r = await loadQaSeed('hr', 'general');
    expect(r.fallbackRole).toBe('programmer');
    expect(r.items.length).toBeGreaterThan(0);
  });

  it('未知 stage は空 (throw しない — 充足ゲート側で扱う)', async () => {
    const r = await loadQaSeed('unknown-stage', 'programmer');
    expect(r.items).toEqual([]);
    expect(r.fallbackRole).toBeNull();
  });

  it('ENOENT 以外の I/O 障害 (例: stage がディレクトリでない) は握り潰さず throw する', async () => {
    // 'final/programmer.json' はファイルであり readdir 対象のディレクトリではないため、
    // ENOTDIR (ENOENT ではない) で失敗する — 設定不備を「シードなし」に見せかけない。
    await expect(loadQaSeed('final/programmer.json', 'programmer')).rejects.toThrow();
  });

  it('axes は既知の 6 軸のみに濾過される', async () => {
    const r = await loadQaSeed('final', 'programmer');
    for (const item of r.items) {
      for (const a of item.axes) {
        expect([
          'consistency',
          'clarity',
          'demeanor',
          'self_understanding',
          'target_fit',
          'depth_resilience',
        ]).toContain(a);
      }
    }
  });
});
