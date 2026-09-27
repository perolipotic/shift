/**
 * The boot decision, extracted so a test can execute it (story 1.1d, review 1).
 *
 * This lived inline in `main.tsx` and was asserted only by reading the source
 * for the words `if (localizationReady)`. That assertion cannot see POLARITY: a
 * review mutation rewrote the boot as `try { await init(); render(); } catch`,
 * which mounts the application on a failed initialization and paints
 * `⟦auth.heading⟧` over every string on the screen — and all 900 tests stayed
 * green. `main.tsx` itself is unreachable from the node suite (AD-15 bans jsdom,
 * and it needs a `#root` element, a stylesheet import and top-level await), so
 * the only way to execute the decision is to take it out of that file.
 *
 * Three failure shapes, one answer. `init` may reject, it may throw
 * SYNCHRONOUSLY before returning a promise at all — `i18next.init` validating
 * its own options is exactly where that would come from — or it may resolve.
 * `await` inside `try` covers all three, which is why the call is wrapped
 * rather than chained: `init().then(ok, bad)` lets a synchronous throw escape
 * past both handlers and take the module down before the fallback is reached.
 *
 * `LOCALIZATION_INIT_FAILED` is a stable code, not a message — the same
 * convention as `ROOT_ELEMENT_MISSING` in `main.tsx`. Translating it is
 * impossible by construction: the translation layer is what failed.
 */

/** Whether localization initialized, and therefore whether to mount. */
export async function bootLocalization(init: () => Promise<unknown>): Promise<boolean> {
  try {
    await init();

    return true;
  } catch (error) {
    console.error('LOCALIZATION_INIT_FAILED', error);

    return false;
  }
}
