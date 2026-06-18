import { describe, it, expect } from 'vitest';
import { parseBackdoorCommand } from './backdoor-commands.js';

describe('parseBackdoorCommand', () => {
  const p = '!ob';

  it('prefix が無ければ none', () => {
    expect(parseBackdoorCommand('hello', p)).toEqual({ kind: 'none' });
    expect(parseBackdoorCommand('!tr text', p)).toEqual({ kind: 'none' });
  });

  it('prefix のみ / help は help', () => {
    expect(parseBackdoorCommand('!ob', p)).toEqual({ kind: 'help' });
    expect(parseBackdoorCommand('  !ob help ', p)).toEqual({ kind: 'help' });
  });

  it('show / link / delete', () => {
    expect(parseBackdoorCommand('!ob show', p)).toEqual({ kind: 'show' });
    expect(parseBackdoorCommand('!ob link', p)).toEqual({ kind: 'link' });
    expect(parseBackdoorCommand('!ob delete', p)).toEqual({ kind: 'delete' });
  });

  it('set 系は本文を value に取り込む (空白も保持)', () => {
    expect(parseBackdoorCommand('!ob company 株式会社 サンプル', p)).toEqual({
      kind: 'set-company', value: '株式会社 サンプル',
    });
    expect(parseBackdoorCommand('!ob students がんばって', p)).toEqual({
      kind: 'set-students', value: 'がんばって',
    });
    expect(parseBackdoorCommand('!ob industry 採用してます', p)).toEqual({
      kind: 'set-industry', value: '採用してます',
    });
    expect(parseBackdoorCommand('!ob name 山田', p)).toEqual({ kind: 'set-name', value: '山田' });
  });

  it('set 系で本文が無ければ unknown', () => {
    expect(parseBackdoorCommand('!ob company', p)).toEqual({ kind: 'unknown' });
    expect(parseBackdoorCommand('!ob students   ', p)).toEqual({ kind: 'unknown' });
  });

  it('hide は students/industry のみ受理', () => {
    expect(parseBackdoorCommand('!ob hide students', p)).toEqual({ kind: 'hide', target: 'students' });
    expect(parseBackdoorCommand('!ob hide industry', p)).toEqual({ kind: 'hide', target: 'industry' });
    expect(parseBackdoorCommand('!ob hide foo', p)).toEqual({ kind: 'unknown' });
    expect(parseBackdoorCommand('!ob hide', p)).toEqual({ kind: 'unknown' });
  });

  it('未知のサブコマンドは unknown', () => {
    expect(parseBackdoorCommand('!ob frobnicate', p)).toEqual({ kind: 'unknown' });
  });

  it('カスタム prefix にも追従', () => {
    expect(parseBackdoorCommand('!alumni link', '!alumni')).toEqual({ kind: 'link' });
  });
});
