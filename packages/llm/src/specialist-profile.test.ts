import { describe, expect, it } from 'vitest';
import { SPECIALIST_ROLES, parseSpecialistProfile, specialistFromMetadata, specialistPersona } from './specialist-profile.js';
import { specialistEvaluationPrompt, specialistQuestionPrompt } from './specialist-prompts.js';
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
        expect(specialistEvaluationPrompt(profile)).toContain('comment');
        expect(specialistEvaluationPrompt(profile, true)).toContain('interviewer_note');
      });
    }
  }

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
