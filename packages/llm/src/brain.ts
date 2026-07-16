// InterviewerBrain — LLM 呼び出しの唯一の境界。
// spec/feature/inference/interviewer-reproduction.md §3:
// 「戦略の再現性はコアが担保し、表現の自然さだけを LLM に払い出す」。
// SessionRuntime は本 interface にのみ依存し、SDK / CLI / API キーの都合を知らない。

import { createAnthropicClient } from './anthropic.js';
import { createOpenAIClient } from './openai.js';
import { streamResponse } from './response.js';
import { streamResponseCli } from './cli.js';
import { assessAnswer, type AnswerSignals } from './judge.js';
import { refine } from './refine.js';
import { evaluate } from './evaluator.js';
import { coerceFocus } from './coerce.js';
import type { Evaluation, Turn } from './types.js';
import type { QuestionSlot } from './question-plan.js';

export type UtteranceContext = {
  /** ブリーフ込みの積層 system prompt (組立は呼び出し側 = 決定的コアの責務)。 */
  systemPrompt: string;
  turns: Turn[];
  /** プラン駆動時のみ。Brain はこのスロットの意図を persona 口調の 1 質問に整形する。 */
  slot?: QuestionSlot | null;
  signal?: AbortSignal;
};

export type AssessContext = {
  question: string;
  answer: string;
  recent?: Turn[];
};

export type RefineContext = { turns: Turn[] };

export type EvalContext = {
  turns: Turn[];
  turnRange: [number, number];
};

export interface InterviewerBrain {
  /** 監査用 (evaluations.method に記録される)。 */
  readonly kind: 'llm' | 'stub';
  /** 質問スロット + 文脈 → 面接官発話。stream は WS 逐次送信のため AsyncIterable。 */
  composeUtterance(ctx: UtteranceContext): AsyncIterable<string>;
  /** 直前 Q&A → phase signal (synthesisReached / contradictionOpen / followupHint)。 */
  assessAnswer(ctx: AssessContext): Promise<AnswerSignals>;
  /** フェーズ遷移時の深掘り論点 (現 refine 相当)。無ければ null。 */
  refineFocus(ctx: RefineContext): Promise<string | null>;
  /** 6 軸評価 (現 evaluator 相当)。 */
  evaluate(ctx: EvalContext): Promise<Evaluation>;
  /** 鍵の有無による機能単位の有効/無効は Brain 内に閉じる。 */
  canCompose(): boolean;
  canAssess(): boolean;
  canRefine(): boolean;
  canEvaluate(): boolean;
}

/** スロットの意図を system prompt に足す (発話の言語化は Brain = LLM の責務)。 */
export function renderSlotBlock(slot: QuestionSlot): string {
  const followups = slot.followups.length
    ? `\n深掘り候補 (回答が浅い時に使う): ${slot.followups.join(' / ')}`
    : '';
  return [
    '## 今回の質問スロット',
    `テーマ: ${slot.theme}`,
    `質問の種: ${slot.question}`,
    `測る軸: ${slot.axes.join(', ')}${followups}`,
    'この意図を、あなたのペルソナの口調で自然な質問 1 つに整形して発話する。',
  ].join('\n');
}

/** parse/coerce 失敗時に 1 回だけ再呼び出しする (transport retry は各 backend 側)。 */
async function retryOnce<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch {
    return await fn();
  }
}

export type LlmBrainOptions = {
  /** 面接官応答の経路。'cli' は claude CLI (-p)、'api' は Anthropic SDK。 */
  llmBackend: 'api' | 'cli';
  env?: NodeJS.ProcessEnv;
};

/** 既存 response / judge / refine / evaluator を内側に移設した本番 Brain。 */
export class LlmBrain implements InterviewerBrain {
  readonly kind = 'llm' as const;
  private readonly llmBackend: 'api' | 'cli';
  private readonly env: NodeJS.ProcessEnv;

  constructor(opts: LlmBrainOptions) {
    this.llmBackend = opts.llmBackend;
    this.env = opts.env ?? process.env;
  }

  canCompose(): boolean {
    return this.llmBackend === 'cli' || Boolean(this.env['ANTHROPIC_API_KEY']);
  }
  canAssess(): boolean {
    return Boolean(this.env['ANTHROPIC_API_KEY']);
  }
  canRefine(): boolean {
    return Boolean(this.env['OPENAI_API_KEY']);
  }
  canEvaluate(): boolean {
    return Boolean(this.env['ANTHROPIC_API_KEY']);
  }

  composeUtterance(ctx: UtteranceContext): AsyncIterable<string> {
    const systemPrompt = ctx.slot
      ? `${ctx.systemPrompt}\n\n${renderSlotBlock(ctx.slot)}`
      : ctx.systemPrompt;
    if (this.llmBackend === 'cli') {
      return streamResponseCli({
        systemPrompt,
        turns: ctx.turns,
        signal: ctx.signal,
        model: 'sonnet',
      });
    }
    return streamResponse(createAnthropicClient({ apiKey: this.env['ANTHROPIC_API_KEY'] }), {
      systemPrompt,
      turns: ctx.turns,
      signal: ctx.signal,
    });
  }

  assessAnswer(ctx: AssessContext): Promise<AnswerSignals> {
    // parse 失敗 (coerce throw 含む) は 1 回だけ再呼び出し。
    // それでも失敗したら throw — 劣化 (DEFAULT_SIGNALS 維持) は呼び出し側の責務。
    return retryOnce(() =>
      assessAnswer(createAnthropicClient({ apiKey: this.env['ANTHROPIC_API_KEY'] }), ctx),
    );
  }

  async refineFocus(ctx: RefineContext): Promise<string | null> {
    const text = await refine(createOpenAIClient({ apiKey: this.env['OPENAI_API_KEY'] }), {
      turns: ctx.turns,
    });
    return coerceFocus(text);
  }

  evaluate(ctx: EvalContext): Promise<Evaluation> {
    return retryOnce(() =>
      evaluate(createAnthropicClient({ apiKey: this.env['ANTHROPIC_API_KEY'] }), ctx),
    );
  }
}

/** 決定的テンプレート Brain (テスト / golden transcript 用)。LLM を一切呼ばない。 */
export class StubBrain implements InterviewerBrain {
  readonly kind = 'stub' as const;
  private assessCount = 0;

  canCompose(): boolean {
    return true;
  }
  canAssess(): boolean {
    return true;
  }
  canRefine(): boolean {
    return true;
  }
  canEvaluate(): boolean {
    return true;
  }

  // eslint-disable-next-line require-yield
  async *composeUtterance(ctx: UtteranceContext): AsyncIterable<string> {
    // スロットの question をそのまま発話 (整形しない = 決定的)。
    // プラン外 (flag off) はターン数による定型文。
    if (ctx.slot) {
      yield ctx.slot.question;
      return;
    }
    const n = ctx.turns.filter((t) => t.role === 'interviewer').length + 1;
    yield `(stub) 質問 ${n}: これまでの取り組みについて教えてください。`;
  }

  async assessAnswer(_ctx: AssessContext): Promise<AnswerSignals> {
    // カウンタ規則: 3 回目の回答ごとに synthesis 到達 (spec §3 の「N turn 目で synthesis」)。
    this.assessCount += 1;
    const synthesis = this.assessCount % 3 === 0;
    return {
      specificity: Math.min(3, this.assessCount % 4),
      synthesisReached: synthesis,
      contradictionOpen: !synthesis,
      followupHint: undefined,
    };
  }

  async refineFocus(_ctx: RefineContext): Promise<string | null> {
    return null;
  }

  async evaluate(ctx: EvalContext): Promise<Evaluation> {
    return {
      turn_range: ctx.turnRange,
      axes: {
        consistency: 3,
        clarity: 3,
        demeanor: 3,
        self_understanding: 3,
        target_fit: 3,
        depth_resilience: 3,
      },
      comment: '(stub) 決定的評価',
      hints: [],
      model: 'stub',
    };
  }
}

export type BrainKind = 'llm' | 'stub';

/**
 * env `TIROCINIUM_BRAIN=llm|stub` (既定 llm) で Brain を選ぶ。
 * 不正値は即 throw — 無言フォールバック禁止 (Pagus PAGUS_BRAIN と同型)。
 */
export function createBrain(
  opts: LlmBrainOptions,
  env: NodeJS.ProcessEnv = process.env,
): InterviewerBrain {
  const raw = (env['TIROCINIUM_BRAIN'] ?? 'llm').toLowerCase();
  switch (raw) {
    case 'llm':
      return new LlmBrain({ ...opts, env });
    case 'stub':
      return new StubBrain();
    default:
      throw new Error(`TIROCINIUM_BRAIN が不正: "${raw}" (llm | stub のみ)`);
  }
}
