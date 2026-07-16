import { describe, expect, it } from 'vitest';
import { obAlias } from './ob-alias.js';

describe('obAlias (仮名化 serializer)', () => {
  it('決定的: 同じ ID は常に同じ別名', () => {
    expect(obAlias('user-123')).toBe(obAlias('user-123'));
  });

  it('形式は OB# + 6 hex', () => {
    expect(obAlias('user-123')).toMatch(/^OB#[0-9a-f]{6}$/);
  });

  it('異なる ID は異なる別名 (実用上)', () => {
    expect(obAlias('user-a')).not.toBe(obAlias('user-b'));
  });

  it('生 ID を含まない', () => {
    const alias = obAlias('cernere-uuid-abcdef');
    expect(alias).not.toContain('cernere');
    expect(alias.length).toBe(9);
  });
});
