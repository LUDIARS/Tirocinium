import { describe, expect, it } from 'vitest';
import { selectTechnicalTopic } from './technical-topics.js';
import { compileQuestionPlan, type QuestionCandidate } from './question-plan.js';
import { PHASE_SPECS } from './phase.js';
import { mulberry32 } from './rng.js';
import { interviewerLaunch, interviewerModel, parseInterviewerOutput } from './interviewer-cli.js';

describe('company interview boundaries', () => {
  it('reproduces selection and excludes newest topics, rotating oldest first', () => {
    expect(selectTechnicalTopic('programmer', 'entry', [], mulberry32(7)))
      .toEqual(selectTechnicalTopic('programmer', 'entry', [], mulberry32(7)));
    const seen = [5, 4, 3, 2, 1, 0].map(i => `programmer:${i}`);
    expect(selectTechnicalTopic('programmer', 'experienced', seen, () => 0).topicId).toBe('programmer:0');
    expect(() => selectTechnicalTopic('sound', 'entry', [], () => 1)).toThrow('invalid_topic_rng');
  });
  it('reserves all three categories despite theme collisions and crowding', () => {
    const base: QuestionCandidate = { theme: 'same', question: 'question', origin: 'company', followups: [], axes: [] };
    const required = ['random-technical', 'company-color', 'ai-strategy'] as const;
    const candidates = [...Array.from({ length: 30 }, (_, i) => ({ ...base, theme: `ordinary${i}` })), base,
      ...required.map(kind => ({ ...base, required: kind }))];
    const plan = compileQuestionPlan({ stage: 'hr', role: 'programmer', companyName: 'Example', candidates }, [], mulberry32(1));
    expect(plan.filter(s => s.phase === 'probe').slice(0, 3).map(s => s.required)).toEqual(required);
    expect(PHASE_SPECS.probe.minTurns).toBeGreaterThanOrEqual(required.length);
  });
  it('has no Sonnet fallback and rejects tool-bearing or incomplete CLI output', () => {
    expect(interviewerModel(undefined)).toBe('sol');
    expect(() => interviewerModel('sonnet')).toThrow();
    expect(interviewerLaunch('sol').args).toContain('sol');
    expect(interviewerLaunch('opus').args).toContain('opus');
    expect(parseInterviewerOutput('opus', JSON.stringify([{ type: 'result', subtype: 'success', result: 'question' }]))).toBe('question');
    expect(() => parseInterviewerOutput('sol', '{"type":"item.completed","item":{"type":"agent_message","text":"x"}}')).toThrow();
    expect(() => parseInterviewerOutput('sol', '{"type":"item.completed","item":{"type":"command_execution"}}\n{"type":"turn.completed"}')).toThrow('interviewer_tools_forbidden');
  });
});
