import { describe, it, expect } from 'vitest';
import { resolveModels } from './model-profiles.js';

describe('resolveModels', () => {
  it('returns the 3-model defaults when nothing is set', () => {
    const m = resolveModels({});
    expect(m.RESPONSE).toBe('sonnet');
    expect(m.EVALUATOR).toBe('opus');
    expect(m.JUDGE).toBe('haiku');
  });

  it('applies the opus-only profile (collapse to Opus)', () => {
    const m = resolveModels({ TIROCINIUM_MODEL_PROFILE: 'opus-only' });
    expect(m.RESPONSE).toBe('opus');
    expect(m.JUDGE).toBe('opus');
    expect(m.EVALUATOR).toBe('opus'); // 既定のまま
  });

  it('applies the economy profile (upper LLMs → Sonnet)', () => {
    const m = resolveModels({ TIROCINIUM_MODEL_PROFILE: 'economy' });
    expect(m.EVALUATOR).toBe('sonnet');
    expect(m.SUMMARIZER).toBe('sonnet');
    expect(m.RESPONSE).toBe('sonnet'); // 既定のまま
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
    expect(m.RESPONSE).toBe('sonnet');
  });
});
