import { onlineManager, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import { useErasureConfirmation } from '@/features/conflicts/hooks/use-erasure-confirmation';
import { useErasureReads } from '@/features/conflicts/hooks/use-erasure-reads';
import { CHECK_REFUSED, CHECK_UNAVAILABLE } from '@/features/conflicts/services/erasure-check';
import { RECHECK_CHANGED } from '@/features/conflicts/services/erasures';
import {
  overrideErasureCheckOf,
  type OverrideAmendChange,
  type OverrideChange,
  type OverrideConfirmChange,
} from '@/features/conflicts/services/override-erasures';
import { ROTATION_KEY, type RotationSnapshot } from '@/features/rotation/services/list';
import {
  DISPOSITION_AMENDED,
  DISPOSITION_CONFIRMED,
  DISPOSITION_DISCARDED,
  DISPOSITION_ARCHIVED,
  DISPOSITION_FAILED,
  DISPOSITION_GONE,
  DISPOSITION_REASON,
  amendDefaultsOf,
  amendEntryOf,
  amendShiftTypeOverride,
  confirmShiftTypeOverride,
  discardShiftTypeOverride,
  overrideReviewOf,
  rowOffersOf,
  type DispositionDone,
  type DispositionFailure,
  type DispositionOutcome,
  type DispositionRpc,
  type PendingOverrideRow,
} from '@/features/rotation/services/override-disposition';
import {
  reviewAmendChangeOf,
  reviewConfirmChangeOf,
  reviewRefusalOf,
  staleRefusalOf,
} from '@/features/rotation/services/override-review-erasures';
import { ROTATION_SAVE_DEPENDENTS, refreshAfterWrite } from '@/features/teams/services/dependents';
import { supabaseClient } from '@/lib/supabase/client';
import { firstEnabledOf, focusLater } from '@/utils/focus-later';

/** What the amend's two fields held when it was submitted: restored when the admin goes back to it. */
export interface AmendEntered {
  readonly shiftTypeId: string;
  readonly reason: string;
}

/** The dialog open over the review: an amend (with what was entered, when reopened) or a discard of one row. */
export type Armed =
  | { readonly kind: typeof DISPOSITION_AMENDED; readonly row: PendingOverrideRow; readonly entered?: AmendEntered }
  | { readonly kind: typeof DISPOSITION_DISCARDED; readonly row: PendingOverrideRow };

/** What a confirm's or an amend's erasure check stood on: the write writes exactly this. */
export type CheckedDisposition =
  | { readonly kind: typeof DISPOSITION_CONFIRMED; readonly row: PendingOverrideRow; readonly change: OverrideConfirmChange }
  | {
      readonly kind: typeof DISPOSITION_AMENDED;
      readonly row: PendingOverrideRow;
      readonly change: OverrideAmendChange;
      readonly entered: AmendEntered;
    };

/** An amend the erasure check stood on, as it would be opened again: its row and what was entered. */
interface CheckedAmend {
  readonly row: PendingOverrideRow;
  readonly entered: AmendEntered;
}

/** Which write could not check what it would erase: a confirm (said in the review) or an amend (in its dialog). */
export type ReviewUnchecked =
  | { readonly kind: typeof DISPOSITION_CONFIRMED; readonly row: PendingOverrideRow }
  | { readonly kind: typeof DISPOSITION_AMENDED };

/**
 * IZMJENE ZA PREGLED'S STATE AND WIRING (story 3.5c; story 5.5h): every
 * override a rotation change left pending, for the admin to confirm, amend or
 * discard. `override-review.tsx` renders what this holds and reads no query.
 *
 * Which are pending and what each call sends are
 * `@/features/rotation/services/override-disposition`'s, and how the erasure
 * check is asked and answered is
 * `@/features/rotation/services/override-review-erasures`'s, both executed by
 * the node suite.
 *
 * ONE WRITE AT A TIME: `writing` latches a second one, from the press to the
 * write's end — the check included — and `pending` keeps the amend, the
 * discard and the erasure confirmation from being dismissed, and every button
 * disabled, until it has settled. A REFUSAL KEEPS WHAT WAS ENTERED — the
 * amend's fields are uncontrolled — and focuses the refused field. `gone`
 * (disposed of elsewhere) and `archived` (the team or type archived
 * meanwhile) re-read, close the dialog and say so in the review. What the
 * review said last is cleared when the next disposition starts and when the
 * builder saves (`savedTimes`). A review that cannot be derived says so,
 * never "nothing".
 *
 * A CONFIRM OR AN AMEND NEVER QUIETLY ERASES A CONFLICT (story 5.5h, on
 * 5.5f's terms). In order: the row's own offers (`rowOffersOf`, the existing
 * `governed` refusal), the amend's preflight (`amendEntryOf`, refused inside
 * its dialog with no check), then the check — the calendar, the
 * organization's leave and its resolutions read afresh, and the override,
 * matched by id there, confirmed or amended in the "after". None erased: the
 * write goes at once, a confirm in one click as before. Some: the shared
 * `ErasureDialog` opens (an amend's own dialog closes first, what was entered
 * kept), and the write waits until every row is confirmed; the check is
 * derived again before the write, and a changed list is shown again,
 * undecided. "Natrag na uređivanje" returns focus to the row's confirm (or
 * the heading), or reopens the amend with what was entered. A check that
 * cannot be derived refuses the write, with a retry: in the review for a
 * confirm, inside the amend's dialog for an amend. Nothing new is written.
 * DISCARD IS NEVER CHECKED (human, 2026-10-05).
 *
 * THE ERASURE DIALOG STAYS SHOWN, BUSY, UNTIL ITS WRITE SETTLES, and only
 * then closes (as the rotation cancel's, 5.5g). AN AMEND IS NEVER REOPENED
 * OVER A ROW THAT LEFT THE REVIEW: its row is looked up again by id, and one
 * gone is said as `gone` in the review; a type entered that is no longer
 * offered falls back to the amend's defaults and says `archived`. A BUILDER
 * SAVE SUPERSEDES WHAT IS OPEN: `generation` is bumped whenever the erasure
 * dialog is closed from outside its own write (going back, a builder save),
 * and a handler that finds it changed after an await settles nothing.
 *
 * A LANDED CONFIRM OR AMEND re-reads the rotation and its dependents — the
 * calendar, the organization's leave and its resolutions
 * (`ROTATION_SAVE_DEPENDENTS`) — so a conflict it erased leaves the queue on
 * the next read. A discard and every refusal re-read `ROTATION_KEY` alone.
 * Neutral throughout: never `destructive` and never the accent.
 */
export function useOverrideReview({
  snapshot,
  busy,
  savedTimes,
}: {
  /** The builder's snapshot, or `null` while there is none to draw. */
  readonly snapshot: RotationSnapshot | null;
  /** The builder's own save or cancel is in flight: nothing here starts meanwhile. */
  readonly busy: boolean;
  /** How many saves the builder has started: a new one clears what the review said last. */
  readonly savedTimes: number;
}) {
  const queryClient = useQueryClient();
  const writing = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const doneNotice = useRef<HTMLParagraphElement>(null);
  const refusalNotice = useRef<HTMLParagraphElement>(null);
  const typeField = useRef<HTMLSelectElement>(null);
  const reasonField = useRef<HTMLInputElement>(null);
  const discardCancel = useRef<HTMLButtonElement>(null);
  /** The refusal's retry, which takes focus when the check cannot be derived. */
  const retryButton = useRef<HTMLButtonElement>(null);
  /** Each row's confirm, by override id: where a confirm's erasure confirmation returns focus. */
  const confirmButtons = useRef<Record<string, HTMLButtonElement | undefined>>({});
  /** Bumped whenever the erasure dialog closes from outside its own write: a handler past an await that finds it changed settles nothing. */
  const generation = useRef(0);
  const [pending, setPending] = useState(false);
  const [armed, setArmed] = useState<Armed | null>(null);
  /** A refusal said inside the open dialog. */
  const [failure, setFailure] = useState<DispositionFailure | null>(null);
  /** A refusal said in the review itself: a confirm's, or `gone` once the dialog has closed. */
  const [refusal, setRefusal] = useState<DispositionFailure | null>(null);
  const [done, setDone] = useState<DispositionDone | null>(null);
  /** How many conflicts the last landed disposition removed, confirmed in its dialog; 0 for none. */
  const [erased, setErased] = useState(0);
  /** Which write could not check what it would erase, so it wrote nothing; `null` for neither. */
  const [unchecked, setUnchecked] = useState<ReviewUnchecked | null>(null);
  /** Where focus returns when a confirm's erasure confirmation closes: that row's confirm. */
  const openedFrom = useRef<() => HTMLElement | null>(() => null);
  const readErasures = useErasureReads();
  const confirmation = useErasureConfirmation<CheckedDisposition>(pending, () =>
    firstEnabledOf<HTMLElement>(openedFrom.current, () => heading.current),
  );
  const review = snapshot === null ? null : overrideReviewOf(snapshot);
  const rows = review?.ok === true ? review.rows : [];
  const disabled = pending || busy;
  /** The rows as last drawn, read after an await: a row is looked up again by id before it is armed. */
  const rowsNow = useRef(rows);
  const seenSaves = useRef(savedTimes);

  useEffect(() => {
    rowsNow.current = rows;
  });

  // THE BUILDER SAVED: what the review said and what it had open belong to
  // before it. A write in flight finds the generation changed and settles nothing.
  useEffect(() => {
    if (seenSaves.current === savedTimes) return;

    seenSaves.current = savedTimes;
    generation.current += 1;
    setDone(null);
    setRefusal(null);
    setFailure(null);
    setErased(0);
    setUnchecked(null);
    confirmation.drop();
    if (!writing.current) setArmed(null);
    // Only a save matters here: `confirmation.drop` is a new function each render.
  }, [savedTimes]);

  /** Whether the review moved on since `started`: a builder save, or the dialog closed from outside. */
  function superseded(started: number): boolean {
    return generation.current !== started;
  }

  /** Closes the erasure dialog from outside its own write: anything still awaiting for it settles nothing. */
  function dropErasures(): void {
    generation.current += 1;
    confirmation.drop();
  }

  /** The current row of `id`, or `undefined` once it has left the review. */
  function rowNow(id: string): PendingOverrideRow | undefined {
    return rowsNow.current.find((row) => row.id === id);
  }

  /** Registers a row's confirm, so its erasure confirmation can return focus to it. */
  function confirmButtonOf(id: string): (element: HTMLButtonElement | null) => void {
    return (element) => {
      confirmButtons.current[id] = element ?? undefined;
    };
  }

  /**
   * Focus once the next render has drawn it and `pending` no longer disables
   * it: the first target ready, else the heading. A target inside a dialog is
   * ready only once that dialog is open — a reopened amend's `showModal()`
   * runs in an effect and moves focus itself, so focus waits for it.
   */
  function focusAfterWrite(...targets: readonly { readonly current: HTMLElement | null }[]): void {
    focusLater(
      targets.map((target) => () => {
        const element = target.current;
        const dialog = element?.closest('dialog');

        return element === null || dialog === null || dialog === undefined || dialog.open ? element : null;
      }),
      () => heading.current ?? refusalNotice.current,
    );
  }

  /** The refused field takes focus: the reason for its own refusal, the type (the first field) for any other. */
  function focusRefused(code: DispositionFailure): void {
    focusAfterWrite(code === DISPOSITION_REASON ? reasonField : typeField, typeField, discardCancel);
  }

  async function reread(): Promise<void> {
    try {
      await queryClient.invalidateQueries({ queryKey: ROTATION_KEY });
    } catch (cause) {
      console.error(DISPOSITION_FAILED, cause);
    }
  }

  /**
   * A confirm or an amend that landed (story 5.5h): the rotation, and the
   * calendar, leave and resolutions beside it. A client that throws is
   * logged, never a refusal, since the write did land.
   */
  async function refreshLanded(): Promise<void> {
    try {
      await refreshAfterWrite(queryClient, ROTATION_KEY, ROTATION_SAVE_DEPENDENTS);
    } catch (cause) {
      console.error(DISPOSITION_FAILED, cause);
    }
  }

  /** The erasure check of `change`, over fresh reads (story 5.5h). */
  function checkErasures(change: OverrideChange) {
    return overrideErasureCheckOf(readErasures.readAndShare, change, onlineManager.isOnline());
  }

  /** The stale path, said in the review: whatever is open closes, and focus goes to the refusal. */
  function sayStale(code: DispositionFailure): void {
    setArmed(null);
    setFailure(null);
    setUnchecked(null);
    setRefusal(code);
    focusAfterWrite(refusalNotice, heading);
  }

  /**
   * Opens the amend again over `row` with what was entered — never over a
   * row that left the review: looked up again by id, one gone is said as
   * `gone` in the review instead. A type entered that is no longer offered
   * falls back to the amend's defaults, the reason kept, and says `archived`
   * in the dialog. Answers whether the amend is open.
   */
  function reopenAmend(row: PendingOverrideRow, entered: AmendEntered): boolean {
    const current = rowNow(row.id);

    if (current === undefined) {
      sayStale(DISPOSITION_GONE);

      return false;
    }

    if (!current.options.some((option) => option.id === entered.shiftTypeId)) {
      const defaults = amendDefaultsOf(current);

      setArmed({
        kind: DISPOSITION_AMENDED,
        row: current,
        entered: { shiftTypeId: defaults.shiftTypeId ?? '', reason: entered.reason },
      });
      setFailure(DISPOSITION_ARCHIVED);
      focusAfterWrite(typeField);

      return false;
    }

    setArmed({ kind: DISPOSITION_AMENDED, row: current, entered });

    return true;
  }

  /**
   * A refusal, said where it belongs. Stale (`gone`, `archived`): re-read,
   * close the dialog, and say it in the review. Otherwise in the amend's
   * dialog when `reopen` names it (opened again with what was entered), or in
   * the review for a confirm. `settle` closes the erasure dialog, once the
   * re-read is over, when the refusal followed it.
   */
  async function refuse(
    code: DispositionFailure,
    reopen: CheckedAmend | null,
    started: number,
    settle: () => void = () => undefined,
  ): Promise<void> {
    if (staleRefusalOf(code)) {
      await reread();
      if (superseded(started)) return;
      settle();
      sayStale(code);

      return;
    }

    settle();

    if (reopen !== null) {
      if (!reopenAmend(reopen.row, reopen.entered)) return;
      setFailure(code);
      focusRefused(code);

      return;
    }

    setArmed(null);
    setRefusal(code);
    focusAfterWrite(refusalNotice, heading);
  }

  /**
   * THE DISPOSITION ITSELF, under the latch its caller already holds. A
   * landed one re-reads, so the row leaves the review, and is said with how
   * many conflicts the admin confirmed it removes (`count`). A refusal is
   * said in the open dialog (`inDialog`; `reopen` opens the amend again
   * first), or in the review; `gone` and `archived` close and re-read.
   * `settle` closes the erasure dialog the write was sent from, once it has
   * settled, never before.
   */
  async function writeDisposition(
    kind: DispositionDone,
    call: (client: DispositionRpc) => Promise<DispositionOutcome>,
    count: number,
    inDialog: boolean,
    reopen: CheckedAmend | null,
    started: number,
    settle: () => void = () => undefined,
  ): Promise<void> {
    const outcome = await call(supabaseClient() as unknown as DispositionRpc);

    if (outcome.ok) {
      // DISCARD IS UNGUARDED AND UNCHANGED: it re-reads the rotation alone.
      if (kind === DISPOSITION_DISCARDED) await reread();
      else await refreshLanded();
      if (superseded(started)) return;
      settle();
      setArmed(null);
      setDone(kind);
      setErased(count);
      // The row has left the review, and the review may have gone with it.
      focusAfterWrite(doneNotice, heading);

      return;
    }

    if (superseded(started)) return;

    if (staleRefusalOf(outcome.code) || !inDialog) {
      await refuse(outcome.code, null, started, settle);

      return;
    }

    settle();
    if (reopen !== null && !reopenAmend(reopen.row, reopen.entered)) return;
    setFailure(outcome.code);
    focusAfterWrite(
      outcome.code === DISPOSITION_REASON ? reasonField : kind === DISPOSITION_AMENDED ? typeField : discardCancel,
      typeField,
      discardCancel,
    );
  }

  /** Takes the latch and clears what the review said last; `null` when a write is already in flight, else the generation it started in. */
  function begin(): number | null {
    if (writing.current || busy) return null;

    writing.current = true;
    setFailure(null);
    setRefusal(null);
    setDone(null);
    setErased(0);
    setUnchecked(null);
    setPending(true);

    return generation.current;
  }

  /** The discard, unguarded (human, 2026-10-05): one call, settled as before. */
  async function discard(row: PendingOverrideRow): Promise<void> {
    const started = begin();

    if (started === null) return;

    try {
      await writeDisposition(DISPOSITION_DISCARDED, (client) => discardShiftTypeOverride(client, row), 0, true, null, started);
    } catch (cause) {
      console.error(DISPOSITION_FAILED, cause);
      if (superseded(started)) return;
      setFailure(DISPOSITION_FAILED);
      focusAfterWrite(discardCancel);
    } finally {
      writing.current = false;
      setPending(false);
    }
  }

  /**
   * A row's confirm and the review's "Pokušaj ponovno" for it (story 5.5h):
   * the row's offers, the erasure check, then the write, under ONE latch. None
   * erased confirms at once, in one click as before; some open the erasure
   * confirmation; a refusal judged on the fresh read is said without a
   * request; a check that cannot be derived refuses in the review, with a
   * retry.
   */
  async function confirm(row: PendingOverrideRow): Promise<void> {
    const started = begin();

    if (started === null) return;

    try {
      // THE GOVERNED REFUSAL FIRST: the write refuses it without a request, as it always did.
      if (!rowOffersOf(row).confirm) {
        await writeDisposition(DISPOSITION_CONFIRMED, (client) => confirmShiftTypeOverride(client, row), 0, false, null, started);

        return;
      }

      const change = reviewConfirmChangeOf(row);
      const check = await checkErasures(change);

      if (superseded(started)) return;

      if (check.kind === CHECK_UNAVAILABLE) {
        setUnchecked({ kind: DISPOSITION_CONFIRMED, row });
        focusAfterWrite(retryButton);

        return;
      }

      if (check.kind === CHECK_REFUSED) {
        await refuse(reviewRefusalOf(check.code), null, started);

        return;
      }

      if (check.rows.length > 0) {
        openedFrom.current = () => confirmButtons.current[row.id] ?? null;
        confirmation.show(check.rows, { kind: DISPOSITION_CONFIRMED, row, change });

        return;
      }

      await writeDisposition(DISPOSITION_CONFIRMED, (client) => confirmShiftTypeOverride(client, row), 0, false, null, started);
    } catch (cause) {
      console.error(DISPOSITION_FAILED, cause);
      if (superseded(started)) return;
      setRefusal(DISPOSITION_FAILED);
      focusAfterWrite(refusalNotice, heading);
    } finally {
      writing.current = false;
      setPending(false);
    }
  }

  /**
   * The amend dialog's save and its "Pokušaj ponovno" (story 5.5h): the row's
   * offers, the preflight (refused in the dialog, no check), the erasure
   * check, then the write, under ONE latch. Some erased: the amend's dialog
   * closes with what was entered kept, and the erasure confirmation opens.
   */
  async function amend(row: PendingOverrideRow, entered: AmendEntered): Promise<void> {
    const started = begin();

    if (started === null) return;

    const reopen: CheckedAmend = { row, entered };
    const write = (client: DispositionRpc) => amendShiftTypeOverride(client, row, entered.shiftTypeId, entered.reason);

    try {
      // THE GOVERNED REFUSAL FIRST, then the preflight: the write refuses either without a request.
      if (!rowOffersOf(row).amend) {
        await writeDisposition(DISPOSITION_AMENDED, write, 0, true, reopen, started);

        return;
      }

      const entry = amendEntryOf(row, entered.shiftTypeId, entered.reason);

      if (!entry.ok) {
        setFailure(entry.code);
        focusRefused(entry.code);

        return;
      }

      const change = reviewAmendChangeOf(row, entry.shiftTypeId);
      const check = await checkErasures(change);

      if (superseded(started)) return;

      if (check.kind === CHECK_UNAVAILABLE) {
        setUnchecked({ kind: DISPOSITION_AMENDED });
        focusAfterWrite(retryButton, typeField);

        return;
      }

      if (check.kind === CHECK_REFUSED) {
        await refuse(reviewRefusalOf(check.code), reopen, started);

        return;
      }

      if (check.rows.length > 0) {
        setArmed(null);
        // An amend's way back is its own dialog, reopened, never a row's control.
        openedFrom.current = () => null;
        confirmation.show(check.rows, { kind: DISPOSITION_AMENDED, row, change, entered });

        return;
      }

      await writeDisposition(DISPOSITION_AMENDED, write, 0, true, reopen, started);
    } catch (cause) {
      console.error(DISPOSITION_FAILED, cause);
      if (superseded(started)) return;
      setFailure(DISPOSITION_FAILED);
      focusRefused(DISPOSITION_FAILED);
    } finally {
      writing.current = false;
      setPending(false);
    }
  }

  /**
   * The erasure confirmation's own save, once every row is confirmed, under
   * the same one latch: the check is derived again from fresh reads for the
   * very write it was shown for. The same conflicts, as shown: the write runs
   * with the dialog still shown, busy, and it closes once the write has
   * settled. A changed list: shown again, undecided. A refusal judged on the
   * fresh read: said where it belongs. A check that cannot be derived closes
   * the dialog and refuses where the write was asked — the review, or the
   * amend's dialog, opened again.
   */
  async function confirmReviewErasures(shown: NonNullable<typeof confirmation.shown>): Promise<void> {
    if (writing.current || busy || !confirmation.confirmed) return;

    const checked = shown.subject;
    const reopen: CheckedAmend | null =
      checked.kind === DISPOSITION_AMENDED ? { row: checked.row, entered: checked.entered } : null;
    const started = generation.current;
    const settle = () => {
      confirmation.drop();
    };

    writing.current = true;
    setPending(true);

    try {
      const check = await checkErasures(checked.change);

      if (superseded(started)) return;

      if (check.kind === CHECK_UNAVAILABLE) {
        settle();
        if (reopen === null) {
          setUnchecked({ kind: DISPOSITION_CONFIRMED, row: checked.row });
          focusAfterWrite(retryButton);
        } else if (reopenAmend(reopen.row, reopen.entered)) {
          setUnchecked({ kind: DISPOSITION_AMENDED });
          focusAfterWrite(retryButton, typeField);
        }

        return;
      }

      if (check.kind === CHECK_REFUSED) {
        await refuse(reviewRefusalOf(check.code), reopen, started, settle);

        return;
      }

      if (confirmation.recheck(shown, check.rows, checked) === RECHECK_CHANGED) return;

      if (checked.kind === DISPOSITION_AMENDED) {
        const { row, entered } = checked;

        await writeDisposition(
          DISPOSITION_AMENDED,
          (client) => amendShiftTypeOverride(client, row, entered.shiftTypeId, entered.reason),
          check.rows.length,
          true,
          reopen,
          started,
          settle,
        );
      } else {
        const { row } = checked;

        await writeDisposition(
          DISPOSITION_CONFIRMED,
          (client) => confirmShiftTypeOverride(client, row),
          check.rows.length,
          false,
          null,
          started,
          settle,
        );
      }
    } catch (cause) {
      console.error(DISPOSITION_FAILED, cause);
      if (superseded(started)) return;
      await refuse(DISPOSITION_FAILED, reopen, started, settle);
    } finally {
      writing.current = false;
      setPending(false);
    }
  }

  /**
   * "Natrag na uređivanje", Escape and the backdrop on the erasure
   * confirmation: a confirm's returns focus to the row's confirm (or the
   * heading); an amend's reopens the amend with what was entered — or, its
   * row gone from the review, says `gone` there.
   */
  function backFromErasures(): void {
    if (writing.current) return;

    const subject = confirmation.shown?.subject;

    if (subject?.kind === DISPOSITION_AMENDED) {
      dropErasures();
      if (reopenAmend(subject.row, subject.entered)) focusAfterWrite(typeField);

      return;
    }

    generation.current += 1;
    confirmation.close();
  }

  function arm(next: Armed): void {
    if (writing.current) return;

    setFailure(null);
    setRefusal(null);
    setDone(null);
    setErased(0);
    setUnchecked(null);
    setArmed(next);
  }

  function disarm(): void {
    if (writing.current) return;

    setArmed(null);
    setFailure(null);
    setUnchecked(null);
    focusAfterWrite(heading);
  }

  /** What the amend's fields hold now, or `null` before they are drawn. */
  function enteredNow(): AmendEntered | null {
    const type = typeField.current;
    const reason = reasonField.current;

    return type === null || reason === null ? null : { shiftTypeId: type.value, reason: reason.value };
  }

  function submitAmend(event: FormEvent<HTMLFormElement>, row: PendingOverrideRow): void {
    event.preventDefault();

    const entered = enteredNow();

    if (entered !== null) void amend(row, entered);
  }

  /** A field of the amend changed: a refusal to check what was entered before no longer stands. */
  function clearUnchecked(): void {
    if (unchecked?.kind === DISPOSITION_AMENDED) setUnchecked(null);
  }

  /**
   * "Pokušaj ponovno": the write the check refused, asked again — for a
   * confirm, of the row as the review now lists it, and a row gone from it
   * takes the stale path.
   */
  function retry(): void {
    if (unchecked === null || writing.current) return;

    if (unchecked.kind === DISPOSITION_CONFIRMED) {
      const current = rowNow(unchecked.row.id);

      if (current === undefined) {
        void (async () => {
          await reread();
          sayStale(DISPOSITION_GONE);
        })();

        return;
      }

      void confirm(current);

      return;
    }

    const entered = enteredNow();

    if (armed?.kind === DISPOSITION_AMENDED && entered !== null) void amend(armed.row, entered);
  }

  return {
    review,
    rows,
    disabled,
    pending,
    armed,
    failure,
    refusal,
    done,
    erased,
    unchecked,
    heading,
    doneNotice,
    refusalNotice,
    typeField,
    reasonField,
    discardCancel,
    retryButton,
    confirmButtonOf,
    erasures: confirmation,
    confirm,
    discard,
    arm,
    disarm,
    submitAmend,
    clearUnchecked,
    retry,
    backFromErasures,
    confirmReviewErasures,
  };
}

export type OverrideReviewState = ReturnType<typeof useOverrideReview>;
