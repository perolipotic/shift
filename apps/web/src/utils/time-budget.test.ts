import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { READ_TIME_BUDGET_MS, READ_TIMED_OUT, withinTimeBudget } from '@/utils/time-budget';

describe('a read bounded by a time budget', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('answers what the read answers when it settles in time', async () => {
    const read = withinTimeBudget(() => Promise.resolve('session'));

    await expect(read()).resolves.toBe('session');
    expect(vi.getTimerCount(), 'a settled read left its timer running').toBe(0);
  });

  it('passes the read its arguments', async () => {
    const read = withinTimeBudget((reuse: boolean) => Promise.resolve(reuse));

    await expect(read(true)).resolves.toBe(true);
  });

  it('rejects with the read\'s own cause when the read rejects', async () => {
    const cause = new Error('SecurityError');
    const read = withinTimeBudget(() => Promise.reject(cause));

    await expect(read()).rejects.toBe(cause);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects with what the read throws synchronously, and starts no timer', async () => {
    const read = withinTimeBudget((): Promise<string> => {
      throw new Error('SUPABASE_ENVIRONMENT_MISSING');
    });

    await expect(read()).rejects.toThrow('SUPABASE_ENVIRONMENT_MISSING');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects a read that never settles once the budget is spent, and not before', async () => {
    const read = withinTimeBudget(() => new Promise<string>(() => undefined));
    const settled = vi.fn();
    const answer = read();
    const rejected = expect(answer).rejects.toThrow(READ_TIMED_OUT);

    answer.then(settled, settled);
    await vi.advanceTimersByTimeAsync(READ_TIME_BUDGET_MS - 1);
    expect(settled, 'the budget ran out early').not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await rejected;
  });

  it('spends about ten seconds by default', () => {
    expect(READ_TIME_BUDGET_MS).toBe(10_000);
  });

  it('ignores an answer that arrives after the budget', async () => {
    let answer: (value: string) => void = () => undefined;
    const read = withinTimeBudget(
      () =>
        new Promise<string>((resolve) => {
          answer = resolve;
        }),
      50,
    );
    const result = read();
    const rejected = expect(result).rejects.toThrow(READ_TIMED_OUT);

    await vi.advanceTimersByTimeAsync(50);
    answer('late');
    await rejected;
  });
});
