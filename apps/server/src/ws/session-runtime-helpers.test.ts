// session-runtime.ts の純粋ヘルパー関数の単体テスト。
// SessionRuntime 本体は WS/DB/persona/judge-blackbox 等への依存が重く、
// 統合テストの設置は別途の投資が要る (既存にも無い) — まずは今回の突合レビュー対応で
// 抽出した純粋ロジック (再接続時の phase 復元 / session_seed=0 の扱い) を単体で担保する。

import { describe, expect, it } from 'vitest';
import { asPhaseProgress, resolveSessionSeed } from './session-runtime.js';

describe('asPhaseProgress', () => {
  it('妥当な snapshot をそのまま復元する', () => {
    const progress = asPhaseProgress({
      phase: 'pressure',
      phaseTurnNo: 2,
      turnBudget: 7,
      planCursor: { opening: 1, probe: 6 },
    });
    expect(progress).toEqual({
      phase: 'pressure',
      phaseTurnNo: 2,
      turnBudget: 7,
      planCursor: { opening: 1, probe: 6 },
    });
  });

  it('null/undefined は復元しない (初回接続 = 通常の opening 開始)', () => {
    expect(asPhaseProgress(null)).toBeNull();
    expect(asPhaseProgress(undefined)).toBeNull();
  });

  it('必須フィールド欠損/型不一致は null (縮退) — 例外を投げない', () => {
    expect(asPhaseProgress({})).toBeNull();
    expect(asPhaseProgress({ phase: 'probe' })).toBeNull();
    expect(asPhaseProgress({ phase: 1, phaseTurnNo: 1, turnBudget: 1 })).toBeNull();
    expect(asPhaseProgress('probe')).toBeNull();
    expect(asPhaseProgress(['probe'])).toBeNull();
  });

  it('planCursor が壊れていても数値以外のエントリだけ除外して復元する', () => {
    const progress = asPhaseProgress({
      phase: 'probe',
      phaseTurnNo: 1,
      turnBudget: 10,
      planCursor: { opening: 1, probe: 'bogus', pressure: 2 },
    });
    expect(progress?.planCursor).toEqual({ opening: 1, pressure: 2 });
  });

  it('planCursor 自体が無い/壊れていれば空 object で復元する', () => {
    const progress = asPhaseProgress({ phase: 'opening', phaseTurnNo: 0, turnBudget: 20 });
    expect(progress?.planCursor).toEqual({});
  });
});

describe('resolveSessionSeed', () => {
  it('0 は有効な seed として尊重する (欠損扱いして再採番しない)', () => {
    const result = resolveSessionSeed(0);
    expect(result).toEqual({ seed: 0, isNew: false });
  });

  it('正の数値はそのまま使う', () => {
    expect(resolveSessionSeed(42)).toEqual({ seed: 42, isNew: false });
  });

  it('null/undefined は欠損として新規採番する', () => {
    expect(resolveSessionSeed(null).isNew).toBe(true);
    expect(resolveSessionSeed(undefined).isNew).toBe(true);
    expect(Number.isFinite(resolveSessionSeed(null).seed)).toBe(true);
  });

  it('数値化できない壊れた値も欠損と同様に新規採番する', () => {
    expect(resolveSessionSeed('not-a-number').isNew).toBe(true);
    expect(resolveSessionSeed(Number.NaN).isNew).toBe(true);
  });

  it('文字列化された数値は許容する (DB 往復での型揺れ対策)', () => {
    expect(resolveSessionSeed('123')).toEqual({ seed: 123, isNew: false });
  });
});
