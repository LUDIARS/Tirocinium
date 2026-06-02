import { describe, expect, it } from 'vitest';
import {
  extractJsonBlock,
  parseEvaluation,
  serializeHistory,
  clampAxes,
  averageAxes,
  AXIS_KEYS,
} from './evaluator.js';

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
    expect(() => parseEvaluation('{"comment":"ok","hints":[]}')).toThrow(/missing axes/);
  });

  it('clamps out-of-range axes and fills missing keys with 0', () => {
    const out = parseEvaluation('{"axes":{"clarity":9,"consistency":-2},"comment":"x","hints":[]}');
    expect(out.axes.clarity).toBe(5);
    expect(out.axes.consistency).toBe(0);
    expect(out.axes.demeanor).toBe(0); // 欠損 → 0
    expect(Object.keys(out.axes).sort()).toEqual([...AXIS_KEYS].sort());
  });

  it('drops empty/non-string hints and caps at 3', () => {
    const out = parseEvaluation(
      '{"axes":{},"comment":"","hints":["a","",null,"b","c","d"]}',
    );
    expect(out.hints).toEqual(['a', 'b', 'c']);
  });
});

describe('clampAxes', () => {
  it('rounds and clamps to 0-5', () => {
    const a = clampAxes({ clarity: 4.6, demeanor: 7, target_fit: -3 });
    expect(a.clarity).toBe(5);
    expect(a.demeanor).toBe(5);
    expect(a.target_fit).toBe(0);
    expect(a.consistency).toBe(0);
  });
});

describe('averageAxes', () => {
  it('averages multiple samples and rounds', () => {
    const a = averageAxes([clampAxes({ clarity: 4 }), clampAxes({ clarity: 2 }), clampAxes({ clarity: 3 })]);
    expect(a.clarity).toBe(3); // (4+2+3)/3 = 3
  });
  it('returns zeros for empty input', () => {
    expect(averageAxes([]).clarity).toBe(0);
  });
});
