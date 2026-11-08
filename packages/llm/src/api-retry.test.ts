import { HttpError } from '@ludiars/portus/net';
import { describe, expect, it } from 'vitest';
import { isRetryable, retryDelayMs, withRetry } from './api-retry.js';

const noSleep = async () => {};

describe('isRetryable (旧 SDK と同じ条件)', () => {
  it('408 / 409 / 429 / 5xx は再試行する', () => {
    for (const status of [408, 409, 429, 500, 502, 503, 504, 529]) {
      expect(isRetryable(new HttpError('x', status, ''))).toBe(true);
    }
  });
  it('それ以外の 4xx は再試行しない', () => {
    for (const status of [400, 401, 403, 404, 413, 422]) {
      expect(isRetryable(new HttpError('x', status, ''))).toBe(false);
    }
  });
  it('接続失敗 (TypeError) とタイムアウトは再試行し、呼び出し側の中断はしない', () => {
    expect(isRetryable(new TypeError('fetch failed'))).toBe(true);
    expect(isRetryable(Object.assign(new Error('t'), { name: 'TimeoutError' }))).toBe(true);
    expect(isRetryable(Object.assign(new Error('a'), { name: 'AbortError' }))).toBe(false);
    expect(isRetryable(new SyntaxError('bad json'))).toBe(false);
    expect(isRetryable('string')).toBe(false);
  });
});

describe('retryDelayMs', () => {
  it('0.5 秒から倍々で上限 8 秒、ゆらぎは最大 25% 短く', () => {
    expect(retryDelayMs(0, () => 0)).toBe(500);
    expect(retryDelayMs(1, () => 0)).toBe(1000);
    expect(retryDelayMs(10, () => 0)).toBe(8000);
    expect(retryDelayMs(0, () => 1)).toBe(375);
  });
});

describe('withRetry', () => {
  it('再試行できる失敗は最大 2 回まで繰り返して成功を返す', async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls++;
        if (calls < 3) throw new HttpError('busy', 529, '');
        return 'ok';
      },
      { sleep: noSleep },
    );
    expect(result).toBe('ok');
    expect(calls).toBe(3);
  });
  it('3 回目の失敗はそのまま投げる', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new HttpError('busy', 429, '');
        },
        { sleep: noSleep },
      ),
    ).rejects.toMatchObject({ status: 429 });
    expect(calls).toBe(3);
  });
  it('再試行しない失敗は 1 回で投げる', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new HttpError('bad', 400, '');
        },
        { sleep: noSleep },
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(calls).toBe(1);
  });
  it('待ち時間は retryDelayMs に従う', async () => {
    const waits: number[] = [];
    await withRetry(
      async () => {
        if (waits.length < 2) throw new TypeError('fetch failed');
        return 1;
      },
      { sleep: async (ms) => void waits.push(ms), random: () => 0 },
    );
    expect(waits).toEqual([500, 1000]);
  });
});
