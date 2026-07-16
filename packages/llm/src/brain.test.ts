import { describe, expect, it } from 'vitest';
import { StubBrain, createBrain, renderSlotBlock } from './brain.js';
import { initialPhaseState, nextPhase, type PhaseState } from './phase.js';
import { mulberry32 } from './rng.js';
import {
  compileQuestionPlan,
  nextSlot,
  type PlanBrief,
  type QuestionSlot,
} from './question-plan.js';

const SLOT: QuestionSlot = {
  theme: 'ガクチカ',
  question: '学生時代に最も力を入れたことは何ですか。',
  followups: ['あなた個人の担当は?'],
  axes: ['depth_resilience'],
  origin: 'company',
  phase: 'probe',
};

async function collect(iter: AsyncIterable<string>): Promise<string> {
  let out = '';
  for await (const t of iter) out += t;
  return out;
}

describe('StubBrain', () => {
  it('composeUtterance はスロットの question をそのまま発話する (決定的)', async () => {
    const brain = new StubBrain();
    const text = await collect(brain.composeUtterance({ systemPrompt: '', turns: [], slot: SLOT }));
    expect(text).toBe(SLOT.question);
  });

  it('スロット無しはターン数による定型文', async () => {
    const brain = new StubBrain();
    const text = await collect(brain.composeUtterance({ systemPrompt: '', turns: [] }));
    expect(text).toContain('質問 1');
  });

  it('assessAnswer はカウンタ規則 (3 回目で synthesis 到達)', async () => {
    const brain = new StubBrain();
    const s1 = await brain.assessAnswer({ question: 'q', answer: 'a' });
    const s2 = await brain.assessAnswer({ question: 'q', answer: 'a' });
    const s3 = await brain.assessAnswer({ question: 'q', answer: 'a' });
    expect(s1.synthesisReached).toBe(false);
    expect(s2.synthesisReached).toBe(false);
    expect(s3.synthesisReached).toBe(true);
    expect(s3.contradictionOpen).toBe(false);
  });

  it('evaluate は固定値 (model=stub)', async () => {
    const brain = new StubBrain();
    const ev = await brain.evaluate({ turns: [], turnRange: [1, 5] });
    expect(ev.model).toBe('stub');
    expect(ev.axes.clarity).toBe(3);
  });
});

describe('createBrain', () => {
  it('TIROCINIUM_BRAIN=stub で StubBrain', () => {
    const brain = createBrain({ llmBackend: 'api' }, { TIROCINIUM_BRAIN: 'stub' } as NodeJS.ProcessEnv);
    expect(brain.kind).toBe('stub');
  });

  it('既定 (未設定) は llm', () => {
    const brain = createBrain({ llmBackend: 'cli' }, {} as NodeJS.ProcessEnv);
    expect(brain.kind).toBe('llm');
    expect(brain.canCompose()).toBe(true); // cli は API キー不要
    expect(brain.canAssess()).toBe(false); // ANTHROPIC_API_KEY なし
  });

  it('不正値は即 throw (無言フォールバック禁止)', () => {
    expect(() =>
      createBrain({ llmBackend: 'api' }, { TIROCINIUM_BRAIN: 'gpt' } as NodeJS.ProcessEnv),
    ).toThrow(/TIROCINIUM_BRAIN/);
  });
});

describe('renderSlotBlock', () => {
  it('テーマ / 質問の種 / followups を含む', () => {
    const block = renderSlotBlock(SLOT);
    expect(block).toContain('ガクチカ');
    expect(block).toContain(SLOT.question);
    expect(block).toContain('あなた個人の担当は?');
  });
});

// --- golden transcript (spec §7 表 7: StubBrain + 固定 seed + 固定ブリーフの一巡) ---

const GOLDEN_BRIEF: PlanBrief = {
  stage: 'hr',
  role: 'programmer',
  companyName: 'Example',
  candidates: [
    { theme: '企業質問A', question: '当社製品を改善するなら?', followups: ['なぜ?'], axes: ['target_fit'], origin: 'company' },
    { theme: 'OB質問A', question: 'チーム開発での役割は?', followups: ['衝突は?'], axes: ['demeanor'], origin: 'ob' },
    { theme: '新卒像A', question: '挑戦した経験は?', followups: ['結果は?'], axes: ['depth_resilience'], origin: 'newgrad' },
    { theme: '一般A', question: '志望動機を教えてください', followups: [], axes: ['target_fit'], origin: 'seed' },
    { theme: '一般B', question: '強みと弱みは?', followups: ['具体例は?'], axes: ['self_understanding'], origin: 'seed' },
    { theme: '一般C', question: '5 年後の姿は?', followups: [], axes: ['consistency'], origin: 'seed' },
    { theme: '一般D', question: '最近学んだ技術は?', followups: [], axes: ['clarity'], origin: 'seed' },
    { theme: '一般E', question: '失敗経験は?', followups: ['再発防止は?'], axes: ['depth_resilience'], origin: 'seed' },
  ],
};

type TranscriptEvent = { phase: string; utterance: string };

/** 決定的コア (plan + phase 機) + StubBrain で面接を一巡する。 */
async function runGoldenSession(seed: number): Promise<TranscriptEvent[]> {
  const plan = compileQuestionPlan(GOLDEN_BRIEF, ['clarity'], mulberry32(seed));
  const brain = new StubBrain();
  const cursor: Record<string, number> = {};
  const events: TranscriptEvent[] = [];
  // personaPressure=4 → pressure phase 有効
  let state: PhaseState = initialPhaseState(4);
  let guard = 0;
  while (state.phase !== 'ended' && guard++ < 40) {
    const slot = nextSlot(plan, state.phase, cursor);
    const utterance = await collect(
      brain.composeUtterance({ systemPrompt: '', turns: [], slot }),
    );
    if (slot) cursor[state.phase] = (cursor[state.phase] ?? 0) + 1;
    events.push({ phase: state.phase, utterance });
    const signals = await brain.assessAnswer({ question: utterance, answer: '回答です' });
    state = nextPhase(state, {
      synthesisReached: signals.synthesisReached,
      contradictionOpen: signals.contradictionOpen,
    });
  }
  return events;
}

describe('golden transcript (StubBrain + 固定 seed)', () => {
  it('同じ seed → 全 turn が exact 一致 (決定的再生)', async () => {
    const a = await runGoldenSession(42);
    const b = await runGoldenSession(42);
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(4);
  });

  it('進行は opening → probe → pressure → closing の順で単調', async () => {
    const events = await runGoldenSession(42);
    const order = ['opening', 'probe', 'pressure', 'closing'];
    const seen = events.map((e) => order.indexOf(e.phase));
    for (let i = 1; i < seen.length; i++) {
      expect(seen[i]!).toBeGreaterThanOrEqual(seen[i - 1]!);
    }
    expect(events[0]!.phase).toBe('opening');
    expect(events[0]!.utterance).toContain('自己紹介');
    expect(events[events.length - 1]!.phase).toBe('closing');
  });

  it('異なる seed はプラン順序が変わり得るが、開始と締めの定型は不変', async () => {
    const a = await runGoldenSession(1);
    const b = await runGoldenSession(2);
    expect(a[0]!.utterance).toBe(b[0]!.utterance);
    expect(a[a.length - 1]!.utterance).toBe(b[b.length - 1]!.utterance);
  });
});
