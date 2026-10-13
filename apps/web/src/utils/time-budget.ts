/**
 * A read that must settle within a time budget, or reject.
 *
 * WHY A REJECTION. Every route guard awaits a reader (`currentSession`,
 * `currentMemberRole`) and handles its REJECTION — the tested catch paths fail
 * closed: the sign-in redirect for the session, the forward for the role. A
 * promise that never settles is not a rejection: a hung connection, a captive
 * portal or a stalled storage lock leaves `beforeLoad` unresolved, and the
 * navigation simply never completes. Turning "too slow" into a rejection puts
 * it on those same paths, with no new copy and no new branch.
 *
 * The underlying read is not cancelled — nothing here can abort it — so a late
 * answer is discarded rather than delivered. The timer is cleared as soon as
 * the read settles, so a fast read leaves nothing running.
 */

/** How long a guard's reader may take before it counts as failed (B274/B334). */
export const READ_TIME_BUDGET_MS = 10_000;

/** The rejection a read over its budget ends in. A stable code, never shown. */
export const READ_TIMED_OUT = 'READ_TIMED_OUT';

/** The reader, wrapped: same shape, but bounded by `budgetMs`. */
export function withinTimeBudget<Args extends unknown[], T>(
  read: (...args: Args) => Promise<T>,
  budgetMs: number = READ_TIME_BUDGET_MS,
): (...args: Args) => Promise<T> {
  return (...args) =>
    new Promise<T>((resolve, reject) => {
      // CALLED FIRST: a reader that throws synchronously (the client's
      // `SUPABASE_ENVIRONMENT_MISSING`) rejects this promise through the
      // executor and starts no timer.
      const pending = read(...args);
      const timer = setTimeout(() => reject(new Error(READ_TIMED_OUT)), budgetMs);

      pending.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (cause: unknown) => {
          clearTimeout(timer);
          reject(cause);
        },
      );
    });
}
