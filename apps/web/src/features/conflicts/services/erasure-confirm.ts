import { CHECK_READY, CHECK_REFUSED, CHECK_UNAVAILABLE } from '@/features/conflicts/services/erasure-check';
import { RECHECK_CHANGED, type ErasureRow, type Recheck } from '@/features/conflicts/services/erasures';

/**
 * THE ERASURE CONFIRMATION'S OWN SAVE, once its fresh check has answered
 * (stories 5.5a, 5.5b, 5.5e–5.5h; epics 5–7 retro A15): the one order every
 * guarded surface follows, written once. Each surface still holds its own
 * latch, pending flag, `catch` and `finally` around it, and asks its own
 * check; what it hands here is the answer, and what each step does on its
 * screen.
 *
 * THE ORDER, and nothing else is decided here:
 * 1. `stopped` — the screen moved on while the check ran (another member or
 *    day shown, a review superseded, a day rolled over): the step says so, or
 *    says nothing, and nothing else runs.
 * 2. Unavailable — the check could not be derived: the write is refused with
 *    the retry, where it was asked.
 * 3. Refused — the write is refused anyway: its own refusal, said as the
 *    write would say it.
 * 4. `subjectOf` — what the fresh check stands on, as the write will send it
 *    (the shown subject unless a surface rebuilds it); `null` when the step
 *    refused it itself (a preflight that no longer passes).
 * 5. The freshness rule — a changed list is shown again, undecided, and
 *    nothing is written.
 * 6. The write, with the fresh check and its subject.
 *
 * How each step closes the confirmation — dropped, or closed with focus
 * returned, before or after its write — stays the surface's, in its steps.
 */

/** Any surface's check, as far as the order reads it. */
export type ConfirmableCheck =
  | { readonly kind: typeof CHECK_UNAVAILABLE }
  | { readonly kind: typeof CHECK_REFUSED }
  | { readonly kind: typeof CHECK_READY; readonly rows: readonly ErasureRow[] };

type RefusedOf<Check> = Extract<Check, { readonly kind: typeof CHECK_REFUSED }>;
type ReadyOf<Check> = Extract<Check, { readonly kind: typeof CHECK_READY }>;

/** What each step of the order does on its surface. */
export interface ErasureConfirmSteps<Check extends ConfirmableCheck, Subject> {
  /** True when the screen moved on and this step has said whatever it says: nothing else runs. */
  readonly stopped?: (check: Check) => boolean | Promise<boolean>;
  readonly unavailable: () => void | Promise<void>;
  readonly refused: (check: RefusedOf<Check>) => void | Promise<void>;
  /** The fresh subject the list is judged with and the write sends; `null` when this step refused it. */
  readonly subjectOf?: (check: ReadyOf<Check>) => Subject | null;
  readonly write: (check: ReadyOf<Check>, subject: Subject) => void | Promise<void>;
}

/**
 * `check`, the fresh answer for the confirmation showing `subject`, followed
 * through `steps` in the one order. `recheck` is the confirmation's own
 * freshness rule over the list it decided.
 */
export async function followErasureCheck<Check extends ConfirmableCheck, Subject>(
  check: Check,
  subject: Subject,
  recheck: (rows: readonly ErasureRow[], subject: Subject) => Recheck,
  steps: ErasureConfirmSteps<Check, Subject>,
): Promise<void> {
  if ((await steps.stopped?.(check)) === true) return;

  if (check.kind === CHECK_UNAVAILABLE) {
    await steps.unavailable();

    return;
  }

  if (check.kind === CHECK_REFUSED) {
    await steps.refused(check as RefusedOf<Check>);

    return;
  }

  const ready = check as ReadyOf<Check>;
  const fresh = steps.subjectOf === undefined ? subject : steps.subjectOf(ready);

  if (fresh === null) return;
  if (recheck(ready.rows, fresh) === RECHECK_CHANGED) return;

  await steps.write(ready, fresh);
}
