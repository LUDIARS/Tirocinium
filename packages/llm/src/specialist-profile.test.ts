import { describe, expect, it } from 'vitest';
import { SPECIALIST_ROLES, parseSpecialistProfile, specialistFromMetadata, specialistPersona } from './specialist-profile.js';
import { REVERSE_QUESTION_RULE, specialistEvaluationPrompt, specialistQuestionPrompt } from './specialist-prompts.js';
import { buildSystemPrompt } from './response.js';

describe('specialist interview contract', () => {
  for (const role of Object.keys(SPECIALIST_ROLES)) {
    for (const level of ['entry', 'experienced']) {
      it(`restores ${role}/${level} across both metadata storage formats`, () => {
        const profile = parseSpecialistProfile({ role, level })!;
        const metadata = { specialist_interview: profile, unrelated: true };
        expect(specialistFromMetadata(metadata)).toEqual(profile);
        expect(specialistFromMetadata(JSON.stringify(metadata))).toEqual(profile);
        const persona = specialistPersona(profile);
        expect(persona.role_lens).toBe(role);
        expect(persona.stage).toBe(level === 'entry' ? 'peer-tech' : 'lead-tech');
        for (const briefMd of [undefined, '既存の質問ブリーフ']) {
          expect(buildSystemPrompt({ interviewer: persona, specialist: profile, briefMd }))
            .toContain(specialistQuestionPrompt(profile));
        }
        expect(specialistQuestionPrompt(profile)).toContain(REVERSE_QUESTION_RULE);
        expect(specialistEvaluationPrompt(profile)).toContain('comment');
        expect(specialistEvaluationPrompt(profile, true)).toContain('interviewer_note');
      });
    }
  }

  it('lets the field or senior interviewer be chosen independently of experience', () => {
    for (const level of ['entry', 'experienced'] as const) {
      for (const [interviewer, stage] of [['field', 'peer-tech'], ['senior', 'lead-tech']] as const) {
        const profile = parseSpecialistProfile({ role: 'programmer', level, interviewer })!;
        expect(profile.interviewer).toBe(interviewer);
        expect(specialistPersona(profile).stage).toBe(stage);
        expect(specialistFromMetadata(JSON.stringify({ specialist_interview: profile }))).toEqual(profile);
      }
    }
    expect(() => parseSpecialistProfile({ role: 'programmer', level: 'entry', interviewer: 'hr' }))
      .toThrow('invalid_specialist_interview');
  });

  it('preserves legacy sessions and fails closed on explicit invalid profiles', () => {
    expect(specialistFromMetadata('{}')).toBeUndefined();
    expect(specialistQuestionPrompt()).toBe('');
    expect(specialistEvaluationPrompt()).toBe('');
    for (const invalid of [null, [], 'programmer', {}, { role: 'general', level: 'entry' },
      { role: '__proto__', level: 'entry' }, { role: 'planner', level: 'expert' }]) {
      expect(() => parseSpecialistProfile(invalid)).toThrow('invalid_specialist_interview');
      expect(() => specialistFromMetadata({ specialist_interview: invalid })).toThrow();
    }
  });
});
