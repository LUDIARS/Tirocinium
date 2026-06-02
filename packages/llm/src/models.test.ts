import { describe, it, expect } from 'vitest';
import { resolveModels } from './anthropic.js';

describe('resolveModels', () => {
  it('returns the 3-model defaults when nothing is set', () => {
    const m = resolveModels({});
    expect(m.RESPONSE).toBe('claude-sonnet-4-6');
    expect(m.EVALUATOR).toBe('claude-opus-4-7');
    expect(m.JUDGE).toBe('claude-haiku-4-5-20251001');
  });

  it('applies the opus-only profile (collapse to Opus)', () => {
    const m = resolveModels({ TIROCINIUM_MODEL_PROFILE: 'opus-only' });
    expect(m.RESPONSE).toBe('claude-opus-4-7');
    expect(m.JUDGE).toBe('claude-opus-4-7');
    expect(m.EVALUATOR).toBe('claude-opus-4-7'); // 既定のまま
  });

  it('applies the economy profile (upper LLMs → Sonnet)', () => {
    const m = resolveModels({ TIROCINIUM_MODEL_PROFILE: 'economy' });
    expect(m.EVALUATOR).toBe('claude-sonnet-4-6');
    expect(m.SUMMARIZER).toBe('claude-sonnet-4-6');
    expect(m.RESPONSE).toBe('claude-sonnet-4-6'); // 既定のまま
  });

  it('per-role env overrides win over profile and default', () => {
    const m = resolveModels({
      TIROCINIUM_MODEL_PROFILE: 'economy',
      TIROCINIUM_MODEL_EVALUATOR: 'my-custom-model',
    });
    expect(m.EVALUATOR).toBe('my-custom-model'); // env > profile(sonnet) > default(opus)
  });

  it('falls back to default for an unknown profile', () => {
    const m = resolveModels({ TIROCINIUM_MODEL_PROFILE: 'bogus' });
    expect(m.RESPONSE).toBe('claude-sonnet-4-6');
  });
});
