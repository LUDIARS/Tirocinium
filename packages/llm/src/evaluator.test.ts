import { describe, expect, it } from 'vitest';
import { extractJsonBlock, parseEvaluation, serializeHistory } from './evaluator.js';

describe('serializeHistory', () => {
  it('formats turn list as numbered transcript', () => {
    const out = serializeHistory([
      { turn_no: 1, role: 'interviewer', text: 'こんにちは' },
      { turn_no: 2, role: 'user', text: 'よろしくお願いします' },
    ]);
    expect(out).toBe('[1] (面接官): こんにちは\n[2] (受験者): よろしくお願いします');
  });
});

describe('extractJsonBlock', () => {
  it('extracts JSON inside ```json fences', () => {
    const block = extractJsonBlock('前置き\n```json\n{"a": 1}\n```\n後置き');
    expect(block).toBe('{"a": 1}');
  });

  it('extracts JSON from raw text with surrounding noise', () => {
    const block = extractJsonBlock('結果を出します: {"a": 1, "b": [2, 3]} 以上です。');
    expect(block).toBe('{"a": 1, "b": [2, 3]}');
  });

  it('throws when no JSON found', () => {
    expect(() => extractJsonBlock('意味のないテキスト')).toThrow(/no JSON/);
  });
});

describe('parseEvaluation', () => {
  it('parses well-formed evaluator JSON', () => {
    const out = parseEvaluation(`{
      "axes": {
        "consistency": 3, "clarity": 4, "demeanor": 2,
        "self_understanding": 3, "target_fit": 3, "depth_resilience": 2
      },
      "comment": "結論先出しが弱いが学習姿勢あり",
      "hints": ["結論を先に", "具体例を 1 つ"]
    }`);
    expect(out.axes.consistency).toBe(3);
    expect(out.hints).toHaveLength(2);
    expect(out.comment).toMatch(/結論先出し/);
  });

  it('parses JSON wrapped in ```json fences', () => {
    const out = parseEvaluation('```json\n{"axes":{"clarity":4},"comment":"ok","hints":["x"]}\n```');
    expect(out.axes.clarity).toBe(4);
  });

  it('throws on missing axes field', () => {
    expect(() => parseEvaluation('{"comment":"ok","hints":[]}')).toThrow(/schema mismatch/);
  });
});
