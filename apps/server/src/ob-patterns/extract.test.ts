import { describe, expect, it } from 'vitest';
import { buildExtractionPrompt, extractPatterns, parseExtractedPatterns } from './extract.js';

const VALID = JSON.stringify([
  {
    theme: 'チーム開発',
    question_pattern: 'チーム開発での衝突をどう解決したか',
    followup_patterns: ['あなた個人の判断は?', '再発防止は?', '余分1', '余分2'],
    axes: ['demeanor', 'unknown-axis'],
  },
  { theme: '', question_pattern: '  代表作の技術選定の根拠  ' },
  { theme: '捨てられる', question_pattern: '' },
]);

describe('parseExtractedPatterns', () => {
  it('正常系: followups は上限で clamp、未知 axes は濾過、空 theme は既定値', () => {
    const out = parseExtractedPatterns(VALID);
    expect(out).toHaveLength(2); // 質問の無い要素は捨てる
    expect(out[0]!.followup_patterns).toHaveLength(3);
    expect(out[0]!.axes).toEqual(['demeanor']);
    expect(out[1]!.theme).toBe('OB 質問パターン');
    expect(out[1]!.question_pattern).toBe('代表作の技術選定の根拠');
  });

  it('```json フェンス付きでもパースできる', () => {
    const out = parseExtractedPatterns('```json\n' + VALID + '\n```');
    expect(out).toHaveLength(2);
  });

  it('構造違反 (配列でない / 要素が object でない) は throw', () => {
    expect(() => parseExtractedPatterns('{"theme":"x"}')).toThrow(/配列/);
    expect(() => parseExtractedPatterns('["text"]')).toThrow(/object/);
  });
});

describe('extractPatterns', () => {
  it('parse 失敗は 1 回だけ再呼び出しする', async () => {
    let calls = 0;
    const runLlm = async () => {
      calls += 1;
      return calls === 1 ? 'ごめんなさい、わかりません' : VALID;
    };
    const out = await extractPatterns(runLlm, {
      companyName: 'Example',
      stage: 'hr',
      role: 'general',
      excerpts: ['抜粋'],
    });
    expect(calls).toBe(2);
    expect(out).toHaveLength(2);
  });
});

describe('buildExtractionPrompt', () => {
  it('個人情報禁止の指示と抜粋を含む', () => {
    const p = buildExtractionPrompt({
      companyName: 'Example',
      stage: 'hr',
      role: 'programmer',
      excerpts: ['抜粋A', '抜粋B'],
    });
    expect(p).toContain('個人情報を一切含めない');
    expect(p).toContain('抜粋A');
    expect(p).toContain('Example');
  });
});
