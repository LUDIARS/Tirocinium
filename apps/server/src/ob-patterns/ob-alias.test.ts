import { describe, expect, it } from 'vitest';
import { obAlias } from './ob-alias.js';

describe('obAlias (仮名化 serializer)', () => {
  it('決定的: 同じ ID は常に同じ別名', () => {
    expect(obAlias('user-123')).toBe(obAlias('user-123'));
  });

  it('形式は OB# + 12 hex (48bit — 24bit 切詰めの列挙耐性を強化)', () => {
    expect(obAlias('user-123')).toMatch(/^OB#[0-9a-f]{12}$/);
  });

  it('異なる ID は異なる別名 (実用上)', () => {
    expect(obAlias('user-a')).not.toBe(obAlias('user-b'));
  });

  it('生 ID を含まない', () => {
    const alias = obAlias('cernere-uuid-abcdef');
    expect(alias).not.toContain('cernere');
    expect(alias.length).toBe(15);
  });

  it('salt が異なれば同じ ID でも別名が変わる (無塩ハッシュの総当り逆引き耐性)', () => {
    expect(obAlias('user-123', 'salt-a')).not.toBe(obAlias('user-123', 'salt-b'));
  });
});
