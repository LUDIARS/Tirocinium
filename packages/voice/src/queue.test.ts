import { describe, expect, it } from 'vitest';
import { AsyncQueue } from './queue.js';

describe('AsyncQueue', () => {
  it('yields pushed values in order', async () => {
    const q = new AsyncQueue<number>();
    q.push(1);
    q.push(2);
    q.push(3);
    q.close();
    const out: number[] = [];
    for await (const v of q) out.push(v);
    expect(out).toEqual([1, 2, 3]);
  });

  it('blocks then resolves on push', async () => {
    const q = new AsyncQueue<string>();
    const iterator = q[Symbol.asyncIterator]();
    const promise = iterator.next();
    setTimeout(() => q.push('hello'), 5);
    const r = await promise;
    expect(r.value).toBe('hello');
    q.close();
    const done = await iterator.next();
    expect(done.done).toBe(true);
  });

  it('close terminates pending waiters', async () => {
    const q = new AsyncQueue<number>();
    const iterator = q[Symbol.asyncIterator]();
    const promise = iterator.next();
    q.close();
    const r = await promise;
    expect(r.done).toBe(true);
  });

  it('ignores push after close', async () => {
    const q = new AsyncQueue<number>();
    q.push(1);
    q.close();
    q.push(2); // ignored
    const out: number[] = [];
    for await (const v of q) out.push(v);
    expect(out).toEqual([1]);
  });
});
