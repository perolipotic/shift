import { onlineManager, useQueryClient } from '@tanstack/react-query';
import type { CollisionResolution } from '@shift/domain';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';

import {
  OVERRIDE_DENIED,
  OVERRIDE_FAILED,
  OVERRIDE_GONE,
  OVERRIDE_REMOVED,
  OVERRIDE_SAVED,
  OVERRIDE_TAKEN,
  OVERRIDES_TABLE,
  removeShiftTypeOverride,
  setShiftTypeOverride,
  type OverrideDone,
  type OverrideRemoval,
  type OverrideTable,
  type OverrideWriteFailure,
} from '@/features/calendar/services/override-write';
import { CALENDAR_KEY, type CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { overridePreviewOf } from '@/features/calendar/utils/change-preview';
import {
  OVERRIDE_NO_TYPE,
  OVERRIDE_REFUSED_REASON,
  OVERRIDE_REFUSED_SAME,
  dayDetailOf,
  overrideEntryOf,
  overrideOffersOf,
  overrideRemovalTargetOf,
  type DayDetail,
  type OverrideEntryRefusal,
} from '@/features/calendar/utils/day-detail';
import { DAY_DETAIL_HEADING_ID } from '@/features/calendar/utils/element-ids';
import { useErasureConfirmation } from '@/features/conflicts/hooks/use-erasure-confirmation';
import { useErasureReads } from '@/features/conflicts/hooks/use-erasure-reads';
import {
  CHECK_READY,
  CHECK_REFUSED,
  CHECK_UNAVAILABLE,
  type ErasureReads,
} from '@/features/conflicts/services/erasure-check';
import { RECHECK_CHANGED } from '@/features/conflicts/services/erasures';
import {
  OVERRIDE_CHANGE_GONE,
  OVERRIDE_CHANGE_REMOVE,
  OVERRIDE_CHANGE_SAME_AS_PROJECTED,
  OVERRIDE_CHANGE_SET,
  OVERRIDE_CHANGE_TAKEN,
  overrideErasureCheckOf,
  type OverrideChange,
  type OverrideChangeRefusal,
  type OverrideRemoveChange,
  type OverrideSetChange,
} from '@/features/conflicts/services/override-erasures';
import { OVERRIDE_WRITE_DEPENDENTS, refreshAfterWrite } from '@/features/teams/services/dependents';
import { claimedOrganizationOf } from '@/features/teams/services/write';
import { supabaseClient } from '@/lib/supabase/client';
import { firstEnabledOf, focusLater } from '@/utils/focus-later';

/**
 * THE ADMIN'S OVERRIDE FORM (story 3.5b): setting a shift-type override on
 * the open day, and removing it through a neutral confirmation.
 *
 * SHOWN BY THE VIEWER'S ROLE, DECIDED BY THE DATABASE. The form and the
 * removal are offered only while `snapshot.viewer.role` is `admin`; the
 * insert policy and the removal function refuse everyone else anyway.
 *
 * ONE WRITE AT A TIME, in the whole day detail: `writing` latches a second
 * submit, and the roster form (story 3.6b) takes the same latch as `latch`,
 * so neither form starts a write while the other's is in flight. `pending` keeps
 * the day detail and the confirmation from being dismissed, and their buttons
 * disabled, until the write has settled.
 *
 * A REFUSAL KEEPS WHAT WAS ENTERED: both fields are uncontrolled and nothing
 * clears them on that path; the refused field (or the first) takes focus.
 *
 * `CALENDAR_KEY` IS INVALIDATED — on success, and on the two refusals that
 * mean the screen is stale (`taken`, `gone`) — and awaited while still
 * pending: the detail re-derives from the new snapshot, so the `✎`, the
 * override block and the form or the removal follow by themselves. A write
 * that landed also re-reads the organization's leave and resolutions
 * (`OVERRIDE_WRITE_DEPENDENTS`, story 5.5f). A write that settles after
 * another day was opened drops its result there.
 *
 * AN OVERRIDE NEVER QUIETLY ERASES A CONFLICT (story 5.5f), on 5.5b's terms.
 * The preflight runs first; then both writes re-read the calendar, the
 * organization's leave and its resolutions and derive which unresolved
 * conflicts the write would erase
 * (`@/features/conflicts/services/override-erasures`). None: the write goes
 * at once, as it always did. Some: the shared `ErasureDialog` opens beside
 * the day detail (a removal's own confirmation closes first), and the write
 * waits until every row is confirmed; the check is derived again before the
 * write, and a changed list is shown again, undecided. A write the database
 * would refuse anyway (`taken`, `gone`) takes its own refusal path without a
 * request, and a set's preflight is run again against the day as the check
 * read it, so a type that has become the projected one meanwhile is refused
 * as the form refuses it. A check that cannot be derived refuses the write,
 * with a retry. "Natrag na uređivanje" returns to the form with its inputs
 * kept, or to the day detail for a removal. Every removal is checked against
 * the fresh read, never the day as drawn: an override pending review there is
 * not applied, lists nothing, and is removed as it always was.
 *
 * A WRITE THAT LANDED IS SAID: `done` holds the save, or the removal and the
 * type it restored, for a `role="status"` Notice, until the next write or
 * another day.
 *
 * THE FORM IS ITS OWN DIALOG (story 7.9), opened from the day detail's
 * "Promijeni tip smjene" (`openButton`) and closed by its cancel, its close
 * button, Escape — never while a write is in flight — or by a save that
 * landed, whose notice the day detail says; focus then returns to the
 * opener. It closes with the day, and when the day no longer offers the form
 * (another admin's override landed first). `preview` is the dialog's
 * *Što se mijenja* for the type chosen (`chosenType`, which mirrors the
 * uncontrolled `Select` as `chosenIn` does the roster's), from
 * `@/features/calendar/utils/change-preview`.
 *
 * Every rule is in `@/features/calendar/services/override-write` and
 * `@/features/calendar/utils/day-detail`, which the node suite executes;
 * this hook holds state and wiring only.
 */
/**
 * What an override write's erasure check stood on: the write writes exactly
 * this. `startedFor` is the day open when it was asked: a write settled for
 * another drops its result.
 */
type CheckedOverrideChange =
  | {
      readonly kind: typeof OVERRIDE_CHANGE_SET;
      readonly change: OverrideSetChange;
      readonly startedFor: string | null;
      /** The day the set is for. */
      readonly on: DayDetail;
      /** What the set sends, as the fields held it. */
      readonly entered: OverrideEntered;
    }
  | {
      readonly kind: typeof OVERRIDE_CHANGE_REMOVE;
      readonly change: OverrideRemoveChange;
      readonly startedFor: string | null;
      /** The type the removal restores, as its done notice names it. */
      readonly projectedTypeName: string | null;
    };

/** What was entered in the form, as the fields hold it. */
interface OverrideEntered {
  readonly type: string;
  readonly reason: string;
}

/** Which of the two calendar writes could not check what it would erase. */
type OverrideUnchecked = typeof OVERRIDE_CHANGE_SET | typeof OVERRIDE_CHANGE_REMOVE;

/** A refusal the check answered, as the write would have said it. */
function writeFailureOf(code: OverrideChangeRefusal): OverrideWriteFailure {
  if (code === OVERRIDE_CHANGE_TAKEN) return OVERRIDE_TAKEN;
  if (code === OVERRIDE_CHANGE_GONE) return OVERRIDE_GONE;
  if (code === OVERRIDE_CHANGE_SAME_AS_PROJECTED) return OVERRIDE_REFUSED_SAME;

  // `archived` is the rotation review's (confirm, amend); neither calendar
  // write should meet it, so meeting it is logged before it is said as a failure.
  console.error(OVERRIDE_FAILED, code);

  return OVERRIDE_FAILED;
}

/** No leave-hours keys: one frozen array, so a default never changes the preview's memo. */
const NO_LEAVE_KEYS: readonly CollisionResolution[] = Object.freeze([]);

export function useOverrideForm(
  snapshot: CalendarSnapshot | null,
  detail: DayDetail | null,
  /** The leave-hours keys the preview's hours count as leave, as *Sati* does (story 7.9). */
  leaveKeys: readonly CollisionResolution[] = NO_LEAVE_KEYS,
) {
  const queryClient = useQueryClient();
  const typeField = useRef<HTMLSelectElement>(null);
  const reasonField = useRef<HTMLInputElement>(null);
  const removeAction = useRef<HTMLButtonElement>(null);
  const removeCancel = useRef<HTMLButtonElement>(null);
  /** The form's own save, where focus returns when its erasure confirmation closes. */
  const saveButton = useRef<HTMLButtonElement>(null);
  /** The refusal's retry, which takes focus when the check cannot be derived. */
  const retryButton = useRef<HTMLButtonElement>(null);
  /** The day detail's "Promijeni tip smjene", which opens the form's dialog and gets focus back (story 7.9). */
  const openButton = useRef<HTMLButtonElement>(null);
  const writing = useRef(false);
  /** Whether the form's dialog is open (story 7.9). */
  const [changing, setChanging] = useState(false);
  // The type `Select`'s value, mirrored for the preview alone: the save reads the field.
  const [chosenType, setChosenType] = useState<string>(OVERRIDE_NO_TYPE);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<OverrideWriteFailure | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [removeFailure, setRemoveFailure] = useState<OverrideWriteFailure | null>(null);
  const [done, setDone] = useState<OverrideDone | null>(null);
  /** How many conflicts the last landed write removed, confirmed in its dialog; 0 for none. */
  const [erased, setErased] = useState(0);
  /** Which write could not check what it would erase, so it wrote nothing; `null` for neither. */
  const [unchecked, setUnchecked] = useState<OverrideUnchecked | null>(null);
  /** Where focus returns when the erasure confirmation closes: what opened it. */
  const openedFrom = useRef<() => HTMLElement | null>(() => null);
  /** The calendar the last check read afresh, `null` until it answers: what a set's preflight is run again on. */
  const freshCalendar = useRef<CalendarSnapshot | null>(null);
  const readErasures = useErasureReads();
  const confirmation = useErasureConfirmation<CheckedOverrideChange>(pending, () =>
    firstEnabledOf<HTMLElement>(
      openedFrom.current,
      () => typeField.current,
      () => document.getElementById(DAY_DETAIL_HEADING_ID),
    ),
  );
  const day = detail === null ? null : `${detail.teamId}:${detail.isoDate}`;
  const [shownFor, setShownFor] = useState(day);
  // The day open NOW, read after an await: a write settled for another day
  // drops its result (see `stillOn`).
  const openDay = useRef(day);

  useEffect(() => {
    openDay.current = day;
  }, [day]);

  // Another day, or none: what was refused or armed belongs to the last one.
  if (shownFor !== day) {
    setShownFor(day);
    setFailure(null);
    setConfirming(false);
    setRemoveFailure(null);
    setDone(null);
    setUnchecked(null);
    setErased(0);
    setChanging(false);
    setChosenType(OVERRIDE_NO_TYPE);
    // Its erasure confirmation, too: it was about that day's override.
    if (confirmation.shown !== null) confirmation.drop();
  }

  const offers = overrideOffersOf(snapshot, detail);

  // THE DAY NO LONGER OFFERS THE FORM — another admin's override landed first,
  // and a re-read brought it — so its dialog closes (the effect below).
  const formGone = changing && !offers.set && !pending;

  const preview = useMemo(
    () => overridePreviewOf(snapshot, detail, chosenType, leaveKeys),
    [snapshot, detail, chosenType, leaveKeys],
  );
  const chooseType = useCallback((id: string): void => {
    setChosenType(id);
  }, []);
  // The override in force, or — story 3.5c — the one pending review.
  const override = overrideRemovalTargetOf(detail);
  // THE OVERRIDE LEFT THE DAY while its confirmation was armed: the day as
  // drawn is the calendar read again (by a refusal's re-read, a retry's
  // fresh reads, or another write), never a guess — see the effect below.
  const lost = confirming && override === null && !pending;

  /** Whether the day a write started for is still the one open. */
  function stillOn(startedFor: string | null): boolean {
    return openDay.current === startedFor;
  }

  /**
   * Focus, once the write has settled and the next render has drawn it: the
   * first of `targets` in the document and enabled, else the day detail's
   * title, so focus never falls to the page body.
   */
  function focusAfterWrite(...targets: readonly { readonly current: HTMLElement | null }[]): void {
    // The opener last (story 7.9): a target inside the closed dialog is gone.
    focusLater(
      [...targets, openButton].map((target) => () => target.current),
      () => document.getElementById(DAY_DETAIL_HEADING_ID),
    );
  }

  // THE OVERRIDE LEFT THE DAY while its confirmation was armed — the calendar
  // was read again and the day as it now is holds no override: the
  // confirmation closes, the day detail says it is gone, and focus moves on.
  useEffect(() => {
    if (!lost) return;
    setConfirming(false);
    setUnchecked(null);
    setRemoveFailure(OVERRIDE_GONE);
    focusAfterWrite(removeAction, typeField);
  });

  // THE DAY NO LONGER OFFERS THE FORM (story 7.9): its dialog closes, never
  // to reopen by itself; the day detail says why (`OverrideSetRefusal`) — the
  // write's own refusal when one was said, else `taken` — and focus moves to
  // the override that landed, or the day detail's title.
  useEffect(() => {
    if (!formGone) return;
    setChanging(false);
    setFailure((said) => said ?? OVERRIDE_TAKEN);
    focusAfterWrite(removeAction);
  });

  async function invalidate(): Promise<void> {
    try {
      await queryClient.invalidateQueries({ queryKey: CALENDAR_KEY });
    } catch (cause) {
      console.error(OVERRIDE_FAILED, cause);
    }
  }

  /**
   * A write that landed: the snapshot, and the two reads the erasure check
   * stands on beside it. It swallows exactly what {@link invalidate} — the
   * landed path's call before story 5.5f — swallowed: a client that throws is
   * logged, never a refusal, since the write did land; a failed re-read
   * resolves anyway (`refreshAfterWrite`). The same as the roster form's
   * `refreshLanded` (5.5b).
   */
  async function refreshLanded(): Promise<void> {
    try {
      await refreshAfterWrite(queryClient, CALENDAR_KEY, OVERRIDE_WRITE_DEPENDENTS);
    } catch (cause) {
      console.error(OVERRIDE_FAILED, cause);
    }
  }

  /** The three fresh reads, shared with the screens, the calendar kept for the set's second preflight. */
  async function readFresh(): Promise<ErasureReads> {
    const reads = await readErasures.readAndShare();

    freshCalendar.current = reads.calendar;

    return reads;
  }

  /** The erasure check of `change`, over fresh reads (story 5.5f). */
  function checkErasures(change: OverrideChange) {
    freshCalendar.current = null;

    return overrideErasureCheckOf(readFresh, change, onlineManager.isOnline());
  }

  /**
   * A set's preflight run AGAIN, against the day as the check just read it,
   * never the day the form was opened on: a type that has become the projected
   * one meanwhile is refused as the form refuses it. What passes carries that
   * fresh day, which the write is sent for.
   *
   * @throws RangeError when the fresh day cannot be derived.
   */
  function freshEntryOf(
    on: DayDetail,
    entered: OverrideEntered,
  ): { readonly ok: true; readonly on: DayDetail } | { readonly ok: false; readonly code: OverrideEntryRefusal } {
    const calendar = freshCalendar.current;
    const fresh = (calendar === null ? null : dayDetailOf(calendar, on.teamId, on.isoDate)) ?? on;
    const entry = overrideEntryOf(fresh, entered.type, entered.reason);

    return entry.ok ? { ok: true, on: fresh } : entry;
  }

  /** The refused field takes focus: the reason for its own refusal, the type (the first field) for any other. */
  function focusRefused(code: OverrideWriteFailure): void {
    focusAfterWrite(code === OVERRIDE_REFUSED_REASON ? reasonField : typeField, typeField, removeAction);
  }

  /**
   * A set the check found refused anyway (`taken`): the write's own refusal,
   * said as the write would say it, and the screen read again — no request.
   */
  async function refuseSet(startedFor: string | null, code: OverrideWriteFailure): Promise<void> {
    await invalidate();
    if (!stillOn(startedFor)) return;
    setFailure(code);
    focusRefused(code);
  }

  /**
   * A removal the check found refused anyway (`gone`): the re-read brings the
   * day as it is, the confirmation closes, and the day detail says so.
   */
  async function refuseRemoval(startedFor: string | null, code: OverrideWriteFailure): Promise<void> {
    await invalidate();
    if (!stillOn(startedFor)) return;
    setRemoveFailure(code);
    setConfirming(false);
    setUnchecked(null);
    focusAfterWrite(removeAction, typeField);
  }

  /**
   * THE SET ITSELF, under the latch its caller already holds: the insert of
   * what was entered on `on`, the day it was asked for. `erased` is how many
   * conflicts the admin confirmed it removes.
   */
  async function writeSet(on: DayDetail, startedFor: string | null, entered: OverrideEntered, erased: number): Promise<void> {
    const client = supabaseClient();
    const { data } = await client.auth.getSession();
    const organization = claimedOrganizationOf(data.session?.access_token);

    if (organization === null) {
      if (!stillOn(startedFor)) return;
      setFailure(OVERRIDE_DENIED);
      focusRefused(OVERRIDE_DENIED);

      return;
    }

    const outcome = await setShiftTypeOverride(
      client.from(OVERRIDES_TABLE) as unknown as OverrideTable,
      organization,
      on,
      entered.type,
      entered.reason,
    );

    if (!outcome.ok) {
      // TAKEN: another admin's override landed first; the re-read lets the
      // form give way to it, and the Notice stays.
      if (outcome.code === OVERRIDE_TAKEN) await invalidate();
      if (!stillOn(startedFor)) return;
      setFailure(outcome.code);
      focusRefused(outcome.code);

      return;
    }

    await refreshLanded();
    if (!stillOn(startedFor)) return;
    setDone({ code: OVERRIDE_SAVED });
    setErased(erased);
    // The dialog closes, and focus returns to the day detail: its opener, or —
    // the day now overridden offers no form — the override's own removal.
    setChanging(false);
    focusAfterWrite(openButton, removeAction);
  }

  /**
   * The form's save and the refusal's "Pokušaj ponovno" (story 5.5f): the
   * preflight, the erasure check, then the write, under ONE latch held from
   * the press to the write's end. An entry the preflight refuses goes
   * straight to the write, which refuses it without a request, as it always
   * did. Otherwise the check: none erased writes at once, some open their
   * confirmation, a write refused anyway says so without a request, and a
   * check that cannot be derived refuses the save with a retry.
   */
  async function submit(event?: FormEvent<HTMLFormElement>): Promise<void> {
    // The form's own submission is never the browser's: a POST would discard what was entered.
    event?.preventDefault();

    const type = typeField.current;
    const reason = reasonField.current;

    if (detail === null || type === null || reason === null || writing.current) return;

    const startedFor = day;
    const on = detail;
    const entered: OverrideEntered = { type: type.value, reason: reason.value };

    writing.current = true;
    setFailure(null);
    setRemoveFailure(null);
    setDone(null);
    setErased(0);
    setUnchecked(null);
    setPending(true);

    try {
      const entry = overrideEntryOf(on, entered.type, entered.reason);

      if (entry.ok) {
        const change: OverrideSetChange = {
          kind: OVERRIDE_CHANGE_SET,
          teamId: on.teamId,
          date: on.isoDate,
          shiftTypeId: entry.shiftTypeId,
        };
        const check = await checkErasures(change);

        if (!stillOn(startedFor)) return;

        if (check.kind === CHECK_UNAVAILABLE) {
          setUnchecked(OVERRIDE_CHANGE_SET);
          focusAfterWrite(retryButton, typeField);

          return;
        }

        if (check.kind === CHECK_REFUSED) {
          await refuseSet(startedFor, writeFailureOf(check.code));

          return;
        }

        // THE PREFLIGHT AGAIN, on the day as the check read it: refused, it writes nothing.
        const fresh = freshEntryOf(on, entered);

        if (!fresh.ok) {
          setFailure(fresh.code);
          focusRefused(fresh.code);

          return;
        }

        if (check.kind === CHECK_READY && check.rows.length > 0) {
          openedFrom.current = () => saveButton.current;
          confirmation.show(check.rows, { kind: OVERRIDE_CHANGE_SET, change, startedFor, on: fresh.on, entered });

          return;
        }

        await writeSet(fresh.on, startedFor, entered, 0);

        return;
      }

      // Refused by the preflight: the write says so without a request, as it always did.
      await writeSet(on, startedFor, entered, 0);
    } catch (cause) {
      console.error(OVERRIDE_FAILED, cause);
      if (!stillOn(startedFor)) return;
      setFailure(OVERRIDE_FAILED);
      focusRefused(OVERRIDE_FAILED);
    } finally {
      writing.current = false;
      setPending(false);
    }
  }

  function openRemove(): void {
    if (writing.current) return;

    // What the last write said belongs to it, not to the removal now armed.
    setFailure(null);
    setDone(null);
    setErased(0);
    setRemoveFailure(null);
    setUnchecked(null);
    setConfirming(true);
  }

  function cancelRemove(): void {
    if (writing.current) return;

    setConfirming(false);
    setRemoveFailure(null);
    setUnchecked(null);
    confirmation.drop();
    focusAfterWrite(removeAction);
  }

  /**
   * THE REMOVAL ITSELF, under the latch its caller already holds.
   * `confirmOpen` says whether its own confirmation is still open (no erasure
   * was listed); after the erasure confirmation it is closed, and a refusal
   * is said in the day detail instead.
   */
  async function writeRemoval(
    startedFor: string | null,
    id: string,
    projectedTypeName: string | null,
    confirmOpen: boolean,
    erased: number,
  ): Promise<void> {
    const outcome = await removeShiftTypeOverride(supabaseClient() as unknown as OverrideRemoval, id);

    if (!outcome.ok) {
      // GONE: the override was removed meanwhile. The re-read brings the
      // day as it is, the confirmation closes, and the day detail says so.
      if (outcome.code === OVERRIDE_GONE) {
        await invalidate();
        if (!stillOn(startedFor)) return;
        setRemoveFailure(outcome.code);
        setConfirming(false);
        focusAfterWrite(removeAction, typeField);

        return;
      }
      if (!stillOn(startedFor)) return;
      // With its confirmation closed (the erasure dialog's save), the refusal
      // is said in the day detail (`OverrideRemoveRefusal`), by the removal.
      setRemoveFailure(outcome.code);
      if (!confirmOpen) setConfirming(false);
      focusAfterWrite(confirmOpen ? removeCancel : removeAction, typeField);

      return;
    }

    await refreshLanded();
    if (!stillOn(startedFor)) return;
    setConfirming(false);
    setDone({ code: OVERRIDE_REMOVED, projectedTypeName });
    setErased(erased);
    // The projection is back, and so is the form's opener — or, with no type
    // to offer, the dialog's title.
    focusAfterWrite(openButton);
  }

  /**
   * The removal confirmation's own confirm and its "Pokušaj ponovno" (story
   * 5.5f): the erasure check, then the removal, under one latch. None erased
   * removes at once; some close this confirmation and open the erasure
   * confirmation; a check that cannot be derived refuses here, with a retry.
   * Every removal is checked, and the FRESH read decides: an override pending
   * review there is not applied, lists nothing, and is removed at once, as
   * it always was — never judged from the day as drawn.
   */
  async function remove(): Promise<void> {
    if (override === null || writing.current) return;

    const startedFor = day;
    const id = override.id;
    const projectedTypeName = override.projectedTypeName;

    writing.current = true;
    setFailure(null);
    setRemoveFailure(null);
    setDone(null);
    setErased(0);
    setUnchecked(null);
    setPending(true);

    try {
      const change: OverrideRemoveChange = { kind: OVERRIDE_CHANGE_REMOVE, overrideId: id };
      const check = await checkErasures(change);

      if (!stillOn(startedFor)) return;

      if (check.kind === CHECK_UNAVAILABLE) {
        setUnchecked(OVERRIDE_CHANGE_REMOVE);
        focusAfterWrite(retryButton, removeCancel);

        return;
      }

      if (check.kind === CHECK_REFUSED) {
        await refuseRemoval(startedFor, writeFailureOf(check.code));

        return;
      }

      if (check.kind === CHECK_READY && check.rows.length > 0) {
        setConfirming(false);
        openedFrom.current = () => removeAction.current;
        confirmation.show(check.rows, { kind: OVERRIDE_CHANGE_REMOVE, change, startedFor, projectedTypeName });

        return;
      }

      await writeRemoval(startedFor, id, projectedTypeName, true, 0);
    } catch (cause) {
      console.error(OVERRIDE_FAILED, cause);
      if (!stillOn(startedFor)) return;
      setRemoveFailure(OVERRIDE_FAILED);
      focusAfterWrite(removeCancel);
    } finally {
      writing.current = false;
      setPending(false);
    }
  }

  /**
   * The erasure confirmation's own save, once every row is confirmed, under
   * the same one latch: the check is derived again from fresh reads for the
   * very write it was shown for. The same conflicts, as shown: the dialog
   * closes and the write runs. A changed list: shown again, undecided, with
   * a line saying so. A write refused anyway: its own refusal. A check that
   * cannot be derived closes the dialog and refuses the write where it was
   * asked — the form, or the removal's own confirmation, armed again.
   */
  async function confirmOverrideErasures(shown: NonNullable<typeof confirmation.shown>): Promise<void> {
    if (writing.current || !confirmation.confirmed) return;

    const checked = shown.subject;
    const { change, startedFor } = checked;

    writing.current = true;
    setPending(true);

    try {
      const check = await checkErasures(change);

      if (!stillOn(startedFor)) {
        confirmation.drop();

        return;
      }

      if (check.kind === CHECK_UNAVAILABLE) {
        confirmation.drop();
        if (checked.kind === OVERRIDE_CHANGE_SET) {
          setUnchecked(OVERRIDE_CHANGE_SET);
          focusAfterWrite(retryButton, typeField);

          return;
        }
        // The reads failed, so nothing says the override left the day: its own
        // confirmation, armed again, refuses with the retry. Only a re-read
        // that no longer holds it says `gone` (the `lost` effect, or the retry's
        // own refused check).
        setUnchecked(OVERRIDE_CHANGE_REMOVE);
        setConfirming(true);
        focusAfterWrite(retryButton, removeCancel);

        return;
      }

      // REFUSED ANYWAY: the write's own refusal, said as the write would say
      // it, and the screen read again — nothing stale is written.
      if (check.kind === CHECK_REFUSED) {
        confirmation.drop();
        if (checked.kind === OVERRIDE_CHANGE_REMOVE) await refuseRemoval(startedFor, writeFailureOf(check.code));
        else await refuseSet(startedFor, writeFailureOf(check.code));

        return;
      }

      // THE PREFLIGHT AGAIN for a set, on the day as this check read it.
      const fresh = checked.kind === OVERRIDE_CHANGE_SET ? freshEntryOf(checked.on, checked.entered) : null;

      if (fresh !== null && !fresh.ok) {
        confirmation.drop();
        setFailure(fresh.code);
        focusRefused(fresh.code);

        return;
      }

      if (confirmation.recheck(shown, check.rows, checked) === RECHECK_CHANGED) return;

      confirmation.drop();

      if (checked.kind === OVERRIDE_CHANGE_REMOVE) {
        await writeRemoval(startedFor, checked.change.overrideId, checked.projectedTypeName, false, check.rows.length);
      } else {
        await writeSet(fresh?.ok === true ? fresh.on : checked.on, startedFor, checked.entered, check.rows.length);
      }
    } catch (cause) {
      console.error(OVERRIDE_FAILED, cause);
      confirmation.drop();
      if (!stillOn(startedFor)) return;
      // The erasure dialog is closed: a removal's failure is said in the day
      // detail, by the removal; a set's in the form.
      if (checked.kind === OVERRIDE_CHANGE_REMOVE) {
        setRemoveFailure(OVERRIDE_FAILED);
        setConfirming(false);
        focusAfterWrite(removeAction, typeField);
      } else {
        setFailure(OVERRIDE_FAILED);
        focusRefused(OVERRIDE_FAILED);
      }
    } finally {
      writing.current = false;
      setPending(false);
    }
  }

  /** Any field of the form changed: a refusal to check what was entered before no longer stands. */
  function clearUnchecked(): void {
    if (unchecked === OVERRIDE_CHANGE_SET) setUnchecked(null);
  }

  /** "Pokušaj ponovno": the write the check refused, asked again. */
  function retry(): void {
    if (unchecked === OVERRIDE_CHANGE_REMOVE) void remove();
    else void submit();
  }

  /** "Promijeni tip smjene": the form's dialog opens; what the last write said belongs to it. */
  function openChange(): void {
    if (writing.current) return;

    setDone(null);
    setErased(0);
    setRemoveFailure(null);
    setChanging(true);
  }

  /** The dialog's cancel, close button and Escape: never while a write is in flight. Focus returns to the opener. */
  function closeChange(): void {
    if (writing.current) return;

    setChanging(false);
    setFailure(null);
    setUnchecked(null);
    focusAfterWrite(openButton);
  }

  return {
    latch: writing,
    typeField,
    reasonField,
    removeAction,
    removeCancel,
    pending,
    failure,
    confirming,
    removeFailure,
    done,
    options: offers.options,
    offersSet: offers.set,
    openButton,
    changing: changing && offers.set,
    openChange,
    closeChange,
    chooseType,
    preview,
    offersRemove: offers.remove,
    submit,
    openRemove,
    cancelRemove,
    remove,
    saveButton,
    retryButton,
    unchecked,
    retry,
    clearUnchecked,
    erased,
    erasures: confirmation,
    confirmOverrideErasures,
  };
}

export type OverrideFormState = ReturnType<typeof useOverrideForm>;
