import { useEffect, useRef, useState } from 'react';

import {
  RECHECK_CHANGED,
  erasureKeptOf,
  erasuresConfirmedOf,
  recheckOf,
  type ErasureDecision,
  type ErasureDecisions,
  type ErasureRow,
  type Recheck,
} from '@/features/conflicts/services/erasures';

/** The confirmation's list, and what was checked to derive it: the write writes exactly that. */
export interface ShownErasures<Subject> {
  readonly rows: readonly ErasureRow[];
  /** What the check stood on, as the surface will write it. */
  readonly subject: Subject;
  /** Shown again because the list changed since it was decided. */
  readonly changed: boolean;
}

/**
 * AN ERASURE CONFIRMATION'S STATE AND ITS FRESHNESS LOOP (stories 5.5a,
 * 5.5b), shared by every guarded surface: the list shown with what was
 * checked, each row's decision, and where focus goes. The rules are
 * `@/features/conflicts/services/erasures`'s; this holds state and focus.
 *
 * - A list shown, or shown again, starts with every row undecided and focus
 *   on its first "Potvrdi brisanje" ({@link firstErasure}).
 * - {@link recheck} applies a re-derivation: the same conflicts as shown (or
 *   none any more) `proceed`; a changed list is shown again, undecided, with
 *   its `changed` line.
 * - {@link close} ("Natrag na uređivanje", Escape, the backdrop) returns
 *   focus to `returnFocusTo` once `busy` is over; {@link drop} closes without
 *   it, for a path that moves focus itself.
 */
export function useErasureConfirmation<Subject>(busy: boolean, returnFocusTo: () => HTMLElement | null) {
  const [shown, setShown] = useState<ShownErasures<Subject> | null>(null);
  const [decisions, setDecisions] = useState<ErasureDecisions>({});
  /** The first row's "Potvrdi brisanje", where focus starts whenever a list is shown. */
  const firstErasure = useRef<HTMLButtonElement>(null);
  /** Set when the confirmation closes, until focus is back where it was opened from. */
  const returnFocus = useRef(false);
  const target = useRef(returnFocusTo);

  useEffect(() => {
    target.current = returnFocusTo;
  });

  // A LIST SHOWN, OR SHOWN AGAIN, STARTS ON ITS FIRST ROW: the dialog is
  // already open when a changed list replaces the one decided.
  useEffect(() => {
    if (shown !== null) firstErasure.current?.focus();
  }, [shown]);

  // CLOSED, FOCUS GOES BACK TO WHAT OPENED IT — once it is enabled again,
  // after a write the close started.
  useEffect(() => {
    if (shown !== null || busy || !returnFocus.current) return;

    returnFocus.current = false;
    target.current()?.focus();
  }, [shown, busy]);

  /** A fresh list, every row undecided. */
  function show(rows: readonly ErasureRow[], subject: Subject): void {
    setDecisions({});
    setShown({ rows, subject, changed: false });
  }

  /**
   * The re-derivation `rows` (over `subject`) against the list `decided`:
   * `proceed` when the write may go, or `changed`, the list then shown again.
   */
  function recheck(decided: ShownErasures<Subject>, rows: readonly ErasureRow[], subject: Subject): Recheck {
    const outcome = recheckOf(decided.rows, rows);

    if (outcome === RECHECK_CHANGED) {
      setDecisions({});
      setShown({ rows, subject, changed: true });
    }

    return outcome;
  }

  /** Closes the confirmation; focus goes back to what opened it. */
  function close(): void {
    returnFocus.current = true;
    setShown(null);
  }

  /** Closes the confirmation and leaves focus to the caller. */
  function drop(): void {
    setShown(null);
  }

  /** One row's decision, replacing whatever it had. */
  function decide(key: string, decision: ErasureDecision): void {
    setDecisions((current) => ({ ...current, [key]: decision }));
  }

  return {
    shown,
    decisions,
    firstErasure,
    /** Every row is confirmed: the confirmation's own save may go. */
    confirmed: shown !== null && erasuresConfirmedOf(shown.rows, decisions),
    /** Some row is kept: the hint says so. */
    kept: shown !== null && erasureKeptOf(shown.rows, decisions),
    show,
    recheck,
    close,
    drop,
    decide,
  };
}

export type ErasureConfirmation<Subject> = ReturnType<typeof useErasureConfirmation<Subject>>;
