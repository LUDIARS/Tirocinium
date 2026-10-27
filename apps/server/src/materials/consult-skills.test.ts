import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { consultRoot, loadInterviewerSkills, skillPath, stripFrontmatter } from './consult-skills.js';

describe('Consult interviewer skills', () => {
  it('strips frontmatter, BOM and CRLF', () => {
    assert.equal(stripFrontmatter('\uFEFF---\r\nname: x\r\n---\r\n# 本文\r\n'), '# 本文');
    assert.equal(stripFrontmatter('# 本文だけ'), '# 本文だけ');
  });
  it('reads both skills from the deployed interviewer role folder', async () => {
    const read = async (path: string) => `---\nname: n\n---\n${path}`;
    const skills = await loadInterviewerSkills('C:/Consult', read);
    assert.equal(skills.reader, skillPath('C:/Consult', 'interviewer-material-reader'));
    assert.equal(skills.interviewer, join('C:/Consult', 'interviewer', '.agents', 'skills', 'interviewer-mock-interview', 'SKILL.md'));
  });
  it('fails when a skill is missing or empty', async () => {
    await assert.rejects(loadInterviewerSkills('C:/Consult', async () => { throw new Error('ENOENT'); }));
    await assert.rejects(loadInterviewerSkills('C:/Consult', async () => '---\nname: n\n---\n'), /consult_skills_empty/);
  });
  it('uses TIROCINIUM_CONSULT_ROOT when set', () => {
    assert.equal(consultRoot({ TIROCINIUM_CONSULT_ROOT: ' D:/Consult ' }), 'D:/Consult');
    assert.equal(consultRoot({}), 'E:/Document/Consult');
  });
});
