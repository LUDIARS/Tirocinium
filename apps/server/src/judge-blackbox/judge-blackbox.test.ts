import { describe, expect, it } from 'vitest';
import { makeMemoryBlackBox } from '@ludiars/blackbox';
import type { AnswerSignals } from '@tirocinium/llm';
import { judgeFeatures } from './features.js';
import {
  JUDGE_DOMAIN,
  decideJudgeSignals,
  judgeBlackboxEnabled,
  seedJudgeRules,
  toJudgeOutput,
} from './index.js';

const LLM_SIGNALS: AnswerSignals = {
  specificity: 2,
  synthesisReached: false,
  contradictionOpen: true,
  followupHint: '担当範囲を聞く',
};

describe('judgeFeatures', () => {
  it('決定的: 同じ入力から同じ特徴量', () => {
    const q = '学生時代に力を入れたことは?';
    const a = '例えば、チーム開発で 3 人のリーダーを担当しました。';
    expect(judgeFeatures(q, a)).toEqual(judgeFeatures(q, a));
  });

  it('具体化マーカー / 数字 / 長さを検出する', () => {
    const f = judgeFeatures('質問', '例えば 3 人チームで実装した経験があります。');
    expect(f['has_concrete_marker']).toBe(true);
    expect(f['has_digits']).toBe(true);
    expect(f['answer_len']).toBeGreaterThan(0);
  });
});

describe('judgeBlackboxEnabled', () => {
  it('0/1 のみ許容、不正値は throw', () => {
    expect(judgeBlackboxEnabled({} as NodeJS.ProcessEnv)).toBe(false);
    expect(judgeBlackboxEnabled({ TIROCINIUM_JUDGE_BLACKBOX: '1' } as NodeJS.ProcessEnv)).toBe(true);
    expect(() => judgeBlackboxEnabled({ TIROCINIUM_JUDGE_BLACKBOX: 'yes' } as NodeJS.ProcessEnv)).toThrow(
      /TIROCINIUM_JUDGE_BLACKBOX/,
    );
  });
});

describe('seedJudgeRules', () => {
  it('冪等: 2 回目は追加しない', () => {
    const bb = makeMemoryBlackBox();
    expect(seedJudgeRules(bb)).toBeGreaterThan(0);
    expect(seedJudgeRules(bb)).toBe(0);
    // seed は candidate — live でないので発火しない
    for (const r of bb.rules.listByDomain(JUDGE_DOMAIN)) {
      expect(r.state).toBe('candidate');
    }
  });
});

describe('decideJudgeSignals', () => {
  it('live ルールが無ければ LLM フォールバック (hint 付き) + ledger 記録', async () => {
    const bb = makeMemoryBlackBox();
    seedJudgeRules(bb);
    let llmCalls = 0;
    const d = await decideJudgeSignals(bb, '質問', 'かなり長い回答をしたとします。', async () => {
      llmCalls += 1;
      return LLM_SIGNALS;
    });
    expect(llmCalls).toBe(1);
    expect(d.source).toBe('llm');
    expect(d.signals.synthesisReached).toBe(false);
    expect(d.signals.followupHint).toBe('担当範囲を聞く');
    expect(bb.ledger.listRecent(JUDGE_DOMAIN, 10)).toHaveLength(1);
  });

  it('卒業済み (auto) ルールが hit すれば LLM をショートサーキット (hint なし)', async () => {
    const bb = makeMemoryBlackBox();
    bb.rules.insert({
      domain: JUDGE_DOMAIN,
      description: '短い回答は synthesis 不成立 (卒業済みテスト用)',
      when: { op: 'cmp', feature: 'answer_len', cmp: '<', value: 40 },
      output: toJudgeOutput({
        specificity: 0,
        synthesisReached: false,
        contradictionOpen: true,
      }),
      state: 'auto',
      source: 'manual',
    });
    let llmCalls = 0;
    const d = await decideJudgeSignals(bb, '質問', 'はい。', async () => {
      llmCalls += 1;
      return LLM_SIGNALS;
    });
    expect(llmCalls).toBe(0);
    expect(d.source).toBe('rule');
    expect(d.signals.specificity).toBe(0);
    expect(d.signals.contradictionOpen).toBe(true);
    expect(d.signals.followupHint).toBeUndefined();
  });

  it('LLM を教師に candidate の影評価カウンタが動く', async () => {
    const bb = makeMemoryBlackBox();
    seedJudgeRules(bb);
    // 「極端に短い回答」ルールの条件を成立させ、LLM は同じ結論を返す → agreement
    await decideJudgeSignals(bb, '質問', 'はい。', async () => ({
      specificity: 0,
      synthesisReached: false,
      contradictionOpen: true,
    }));
    const rule = bb.rules
      .listByDomain(JUDGE_DOMAIN)
      .find((r) => r.description.includes('極端に短い回答'))!;
    expect(rule.shadowAgreements).toBe(1);
    expect(rule.shadowConflicts).toBe(0);
  });
});
