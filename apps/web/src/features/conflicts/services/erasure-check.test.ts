import { afterEach, describe, expect, it, vi } from 'vitest';

import { CHECK_UNAVAILABLE, checkedOf } from '@/features/conflicts/services/erasure-check';

/** Story 5.5b's shared, never-throwing check run, executed (AD-15). */

afterEach(() => {
  vi.restoreAllMocks();
});

describe('checkedOf', () => {
  it('answers what the decision makes of the reads', async () => {
    expect(await checkedOf(() => Promise.resolve(2), (reads) => ({ kind: 'ready', reads }), true)).toEqual({
      kind: 'ready',
      reads: 2,
    });
  });

  it('answers unavailable offline, without reading', async () => {
    const read = vi.fn(() => Promise.resolve(1));

    expect(await checkedOf(read, () => 'decided', false)).toEqual({ kind: CHECK_UNAVAILABLE });
    expect(read).not.toHaveBeenCalled();
  });

  it('answers unavailable, logged, when a read rejects or the decision throws', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(await checkedOf(() => Promise.reject(new Error('500')), () => 'decided', true)).toEqual({ kind: CHECK_UNAVAILABLE });
    expect(
      await checkedOf(
        () => Promise.resolve(1),
        () => {
          throw new TypeError('broken');
        },
        true,
      ),
    ).toEqual({ kind: CHECK_UNAVAILABLE });
    expect(logged).toHaveBeenCalledTimes(2);
  });
});
