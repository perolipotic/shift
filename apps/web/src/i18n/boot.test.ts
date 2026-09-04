import { afterEach, describe, expect, it, vi } from 'vitest';

import { bootLocalization } from '@/i18n/boot';

/**
 * The boot decision, EXECUTED rather than read (story 1.1d, review 1).
 *
 * The gap this closes was found by mutation: the mount was guarded correctly,
 * but the only assertion over that guard matched the source text
 * `if (localizationReady)`. Rewriting the boot as `try`/`catch` around the
 * render mounted the application on a failed initialization — `⟦key⟧` painted
 * over every string — and left all 900 tests green, because a wording match
 * cannot see which branch renders.
 *
 * So the decision is a function now, and these run it. Each case is a shape
 * that actually reaches it, and `true`/`false` is the whole contract: `main.tsx`
 * mounts on `true` and leaves the static `index.html` fallback in place on
 * `false`.
 */

afterEach(() => {
  vi.restoreAllMocks();
});

/** `console.error` is silenced, not ignored: the code it logs is asserted
 *  below, and an unsilenced expected error makes a passing run look broken. */
function silenceErrors(): ReturnType<typeof vi.spyOn> {
  return vi.spyOn(console, 'error').mockImplementation(() => undefined);
}

describe('a successful initialization clears the application to mount', () => {
  it('answers true when init resolves', async () => {
    await expect(bootLocalization(() => Promise.resolve())).resolves.toBe(true);
  });

  it('logs nothing on the way through', async () => {
    const logged = silenceErrors();

    await bootLocalization(() => Promise.resolve());

    expect(logged).not.toHaveBeenCalled();
  });
});

describe('a failed initialization refuses the mount', () => {
  it('answers false when init rejects', async () => {
    silenceErrors();

    await expect(bootLocalization(() => Promise.reject(new Error('nope')))).resolves.toBe(false);
  });

  it('answers false when init throws synchronously, before any promise exists', async () => {
    // The shape `init().then(ok, bad)` would let this escape past both handlers.
    // `i18next.init` rejecting its own options is where it would come from.
    silenceErrors();

    await expect(
      bootLocalization(() => {
        throw new Error('nope');
      }),
    ).resolves.toBe(false);
  });

  it('never resolves true on a failure, in either shape', async () => {
    // Named separately from the two above because `false` is the load-bearing
    // half: a handler that swallowed the error and returned `true` would keep
    // both assertions above passing only by accident of their expected value.
    silenceErrors();

    const answers = await Promise.all([
      bootLocalization(() => Promise.reject(new Error('nope'))),
      bootLocalization(() => {
        throw new Error('nope');
      }),
    ]);

    expect(answers).toEqual([false, false]);
  });

  it('reports the failure as a stable code with the cause beside it', async () => {
    const logged = silenceErrors();
    const cause = new Error('nope');

    await bootLocalization(() => Promise.reject(cause));

    expect(logged).toHaveBeenCalledWith('LOCALIZATION_INIT_FAILED', cause);
  });

  it('does not rethrow, so the fallback is never replaced by an unhandled error', async () => {
    silenceErrors();

    await expect(
      bootLocalization(() => Promise.reject(new Error('nope'))),
    ).resolves.not.toThrow();
  });
});
