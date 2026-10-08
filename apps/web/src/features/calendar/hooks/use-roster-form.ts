import type { CollisionResolution } from '@shift/domain';
import { onlineManager, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type RefObject } from 'react';

import {
  ROSTER_DENIED,
  ROSTER_FAILED,
  ROSTER_GONE,
  ROSTER_OVERRIDES_TABLE,
  ROSTER_REMOVED_DONE,
  ROSTER_SAVED,
  ROSTER_TAKEN,
  removeRosterOverride,
  setRosterOverride,
  type RosterDone,
  type RosterRemoval,
  type RosterTable,
  type RosterWriteFailure,
} from '@/features/calendar/services/roster-write';
import {
  ROSTER_CHANGE_REMOVAL,
  ROSTER_CHANGE_SAVE,
  rosterErasureCheckOf,
  type RosterChange,
  type RosterChangeKind,
  type RosterRemovalChange,
  type RosterSaveChange,
} from '@/features/calendar/services/roster-erasures';
import { CALENDAR_KEY, type CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { rosterPreviewOf } from '@/features/calendar/utils/change-preview';
import {
  ROSTER_NOBODY,
  ROSTER_REFUSED_REASON,
  rosterEntryOf,
  rosterOffersOf,
  rosterOverlapShownOf,
  rosterRemovalTargetOf,
  type DayDetail,
} from '@/features/calendar/utils/day-detail';
import { DAY_DETAIL_HEADING_ID } from '@/features/calendar/utils/element-ids';
import type { CandidateLeave } from '@/features/calendar/utils/replacement-candidates';
import { useErasureConfirmation } from '@/features/conflicts/hooks/use-erasure-confirmation';
import { useErasureReads } from '@/features/conflicts/hooks/use-erasure-reads';
import { CHECK_READY, CHECK_REFUSED, CHECK_UNAVAILABLE } from '@/features/conflicts/services/erasure-check';
import { RECHECK_CHANGED } from '@/features/conflicts/services/erasures';
import { ROSTER_WRITE_DEPENDENTS, refreshAfterWrite } from '@/features/teams/services/dependents';
import { claimedOrganizationOf } from '@/features/teams/services/write';
import { supabaseClient } from '@/lib/supabase/client';
import { focusLater } from '@/utils/focus-later';

/**
 * THE ADMIN'S ROSTER FORM (story 3.6b): taking a member off the open day's
 * shift, putting one on, or both at once — one row — and removing any listed
 * change through a neutral confirmation. `useOverrideForm`'s twin (3.5b),
 * with its latch, its keep-and-focus and its stale-day rule.
 *
 * SHOWN BY THE VIEWER'S ROLE, DECIDED BY THE DATABASE. The form and the
 * removals are offered only while `snapshot.viewer.role` is `admin`; the
 * insert policy and the removal function refuse everyone else anyway.
 *
 * ONE WRITE AT A TIME, in the whole day detail: `writing` is `latch`, the
 * override form's own latch (`useOverrideForm`'s), so neither form starts a
 * write while the other's is in flight; `busy` on the components disables
 * the other form's controls meanwhile. `pending` keeps
 * the day detail and the confirmation from being dismissed, and their buttons
 * disabled, until the write has settled.
 *
 * A REFUSAL KEEPS WHAT WAS ENTERED: every field is uncontrolled and nothing
 * clears it on that path; the refused field (or the first) takes focus. A
 * save that landed starts the form afresh (`formKey`), since the members it
 * named are no longer offered.
 *
 * `CALENDAR_KEY` IS INVALIDATED — on success, and on the two refusals that
 * mean the screen is stale (`taken`, `gone`) — and awaited while still
 * pending: the detail re-derives from the new snapshot, so the `✎`, the
 * change blocks and the candidates follow by themselves. A write that
 * landed also re-reads the organization's leave and resolutions
 * (`ROSTER_WRITE_DEPENDENTS`, story 5.5b). A write that settles after another
 * day was opened drops its result there.
 *
 * A CHANGE NEVER QUIETLY ERASES A CONFLICT (story 5.5b). Both writes first
 * re-read the calendar, the organization's leave and its resolutions and
 * derive which unresolved conflicts the change would erase
 * (`@/features/calendar/services/roster-erasures`). None: the write goes at
 * once, as it always did. Some: the shared `ErasureDialog` opens beside the
 * day detail (a removal's own confirmation closes first), and the write waits
 * until every row is confirmed; the check is derived again before the write,
 * and a changed list is shown again, undecided. A check that cannot be
 * derived refuses the write, with a retry. "Natrag na uređivanje" returns to
 * the form with its inputs kept, or to the day detail for a removal.
 *
 * A MEMBER WHO WOULD BE DOUBLE-BOOKED IS WARNED OF, NEVER REFUSED (Epic 4
 * retro C2): the "Dolazi" `Select` stays uncontrolled, and `chosenIn` only
 * mirrors its value for `rosterOverlapShownOf`, which decides the hint. The
 * form re-syncs it on every mount and forgets it on unmount (`chooseIn`), and
 * it is forgotten on another day, after a save, and as soon as the member is
 * no longer offered — so it never names someone the `Select` does not show.
 *
 * THE FORM IS ITS OWN DIALOG (story 7.9), opened from the day detail's
 * "Promijeni sastav" (`openButton`), on `useOverrideForm`'s terms: closed by
 * its cancel, its close button or Escape — never while a write is in flight
 * — or by a save that landed, and with the day; focus returns to the opener.
 * "Dolazi" offers its members in 5.4c's groups, over `leave`, the live leave
 * the admin reads; they inform and never block. `preview` is the dialog's
 * *Što se mijenja* for the members chosen (`chosenOut` and `chosenIn`), from
 * `@/features/calendar/utils/change-preview`.
 *
 * Every rule is in `@/features/calendar/services/roster-write` and
 * `@/features/calendar/utils/day-detail`, which the node suite executes;
 * this hook holds state and wiring only.
 */
/** What was entered in the form, as the fields hold it: the write sends exactly this. */
interface RosterEntered {
  readonly out: string;
  readonly in: string;
  readonly reason: string;
}

/**
 * What a roster change's erasure check stood on: the write writes exactly
 * this. A save carries its day and what was entered; a removal, its id alone.
 * `startedFor` is the day open when it was asked: a write settled for another
 * drops its result.
 */
type CheckedRosterChange =
  | {
      readonly kind: typeof ROSTER_CHANGE_SAVE;
      readonly change: RosterSaveChange;
      readonly startedFor: string | null;
      /** The day the save is for. */
      readonly on: DayDetail;
      /** What the save sends. */
      readonly entered: RosterEntered;
    }
  | { readonly kind: typeof ROSTER_CHANGE_REMOVAL; readonly change: RosterRemovalChange; readonly startedFor: string | null };

/**
 * The first of `targets` in the document and enabled, else the last: where
 * focus returns when the erasure confirmation closes — never the page body.
 */
function readyOf(...targets: readonly (() => HTMLElement | null)[]): HTMLElement | null {
  const ready = targets
    .map((target) => target())
    .find((element) => element !== null && element.isConnected && !(element as HTMLButtonElement).disabled);

  return ready ?? null;
}

/** No leave-hours keys: one frozen array, so a default never changes the preview's memo. */
const NO_LEAVE_KEYS: readonly CollisionResolution[] = Object.freeze([]);

export function useRosterForm(
  snapshot: CalendarSnapshot | null,
  detail: DayDetail | null,
  latch: RefObject<boolean>,
  /**
   * The organization's live leave, which groups those to put on (story 7.9);
   * `null` while it is not read (or failed), when nobody is grouped.
   */
  leave: readonly CandidateLeave[] | null = null,
  /** The leave-hours keys the preview's hours count as leave, as *Sati* does (story 7.9). */
  leaveKeys: readonly CollisionResolution[] = NO_LEAVE_KEYS,
) {
  const queryClient = useQueryClient();
  const outField = useRef<HTMLSelectElement>(null);
  const inField = useRef<HTMLSelectElement>(null);
  const rosterReasonField = useRef<HTMLInputElement>(null);
  const removeCancel = useRef<HTMLButtonElement>(null);
  // Each listed change's removal button, by the change's id: focus returns to
  // the one that opened the confirmation.
  const removeActions = useRef(new Map<string, HTMLButtonElement>());
  const writing = latch;
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<RosterWriteFailure | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [removeFailure, setRemoveFailure] = useState<RosterWriteFailure | null>(null);
  const [done, setDone] = useState<RosterDone | null>(null);
  const [saves, setSaves] = useState(0);
  /** How many conflicts the last landed write removed, confirmed in its dialog; 0 for none. */
  const [erased, setErased] = useState(0);
  // The "Dolazi" value, mirrored for the overlap hint alone: the save reads the field.
  const [chosenIn, setChosenIn] = useState<string>(ROSTER_NOBODY);
  // The "Skida se" value, mirrored for the preview alone (story 7.9).
  const [chosenOut, setChosenOut] = useState<string>(ROSTER_NOBODY);
  /** Whether the form's dialog is open (story 7.9). */
  const [changing, setChanging] = useState(false);
  /** The day stopped offering the form while its dialog was open (story 7.9): said in the day detail. */
  const [formLost, setFormLost] = useState(false);
  /** The day detail's "Promijeni sastav", which opens the form's dialog and gets focus back (story 7.9). */
  const openButton = useRef<HTMLButtonElement>(null);
  /** The form's own save, where focus returns when its erasure confirmation closes. */
  const saveButton = useRef<HTMLButtonElement>(null);
  /** The refusal's retry, which takes focus when the check cannot be derived. */
  const retryButton = useRef<HTMLButtonElement>(null);
  /** Which write could not check what it would erase, so it wrote nothing; `null` for neither. */
  const [unchecked, setUnchecked] = useState<RosterChangeKind | null>(null);
  /** Where focus returns when the erasure confirmation closes: what opened it. */
  const openedFrom = useRef<() => HTMLElement | null>(() => null);
  const readErasures = useErasureReads();
  const confirmation = useErasureConfirmation<CheckedRosterChange>(pending, () =>
    readyOf(openedFrom.current, () => outField.current, () => document.getElementById(DAY_DETAIL_HEADING_ID)),
  );
  // The day detail as last drawn, read after an await: whether a change is still listed.
  const shownDetail = useRef(detail);

  useEffect(() => {
    shownDetail.current = detail;
  });
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
    setConfirming(null);
    setRemoveFailure(null);
    setDone(null);
    setChosenIn(ROSTER_NOBODY);
    setChosenOut(ROSTER_NOBODY);
    setChanging(false);
    setFormLost(false);
    setUnchecked(null);
    setErased(0);
    // Its erasure confirmation, too: it was about that day's change.
    if (confirmation.shown !== null) confirmation.drop();
  }

  // What cannot be grouped is offered ungrouped, logged, inside
  // `rosterOffersOf` (story 7.9): the day detail never goes down for its
  // candidates' groups.
  const offers = useMemo(() => rosterOffersOf(snapshot, detail, leave), [snapshot, detail, leave]);

  // A member no longer offered (a save, or a re-read after `taken`) is no
  // longer chosen: the remounted `Select` shows "— nitko —".
  if (chosenIn !== ROSTER_NOBODY && !offers.in.some((one) => one.id === chosenIn)) {
    setChosenIn(ROSTER_NOBODY);
  }
  if (chosenOut !== ROSTER_NOBODY && !offers.out.some((one) => one.id === chosenOut)) {
    setChosenOut(ROSTER_NOBODY);
  }
  // A day that no longer offers the form closes its dialog (the effect below).
  const formGone = changing && !offers.set && !pending;

  const preview = useMemo(
    () => rosterPreviewOf(snapshot, detail, chosenOut, chosenIn, leaveKeys),
    [snapshot, detail, chosenOut, chosenIn, leaveKeys],
  );
  const chooseOut = useCallback((id: string): void => {
    setChosenOut(id);
  }, []);

  const target = rosterRemovalTargetOf(detail, confirming);
  const lost = confirming !== null && target === null && !pending;
  const overlap = useMemo(() => rosterOverlapShownOf(snapshot, detail, chosenIn), [snapshot, detail, chosenIn]);
  const chooseIn = useCallback((id: string): void => {
    setChosenIn(id);
  }, []);

  /** Whether the day a write started for is still the one open. */
  function stillOn(startedFor: string | null): boolean {
    return openDay.current === startedFor;
  }

  /**
   * Focus, once the write has settled and the next render has drawn it: the
   * first of `targets` in the document and enabled, else the day detail's
   * title, so focus never falls to the page body.
   */
  function focusAfterWrite(...targets: readonly (() => HTMLElement | null)[]): void {
    // The opener last (story 7.9): a target inside the closed dialog is gone.
    focusLater([...targets, opener], () => document.getElementById(DAY_DETAIL_HEADING_ID));
  }

  const first = () => outField.current;
  const opener = () => openButton.current;
  const reasonShown = () => rosterReasonField.current;
  const cancelShown = () => removeCancel.current;
  const actionOf = (id: string | null) => () => (id === null ? null : (removeActions.current.get(id) ?? null));

  // THE CHANGE LEFT THE DAY while its confirmation was open — another admin
  // removed it, and a re-read brought the day as it is: the confirmation
  // closes, the day detail says it is gone, and focus moves on.
  useEffect(() => {
    if (!lost) return;
    setConfirming(null);
    setRemoveFailure(ROSTER_GONE);
    focusAfterWrite(first);
  });

  // THE DAY NO LONGER OFFERS THE FORM (story 7.9) — another admin made it a
  // day off, or the team was archived: the dialog closes, never to reopen by
  // itself, the day detail says why, and focus moves to its title.
  useEffect(() => {
    if (!formGone) return;
    setChanging(false);
    setFormLost(true);
    focusAfterWrite();
  });

  async function invalidate(): Promise<void> {
    try {
      await queryClient.invalidateQueries({ queryKey: CALENDAR_KEY });
    } catch (cause) {
      console.error(ROSTER_FAILED, cause);
    }
  }

  /** A write that landed: the snapshot, and the two reads the erasure check stands on beside it. */
  async function refreshLanded(): Promise<void> {
    try {
      await refreshAfterWrite(queryClient, CALENDAR_KEY, ROSTER_WRITE_DEPENDENTS);
    } catch (cause) {
      console.error(ROSTER_FAILED, cause);
    }
  }

  /** The erasure check of `change`, over fresh reads (story 5.5b). */
  function checkErasures(change: RosterChange) {
    return rosterErasureCheckOf(readErasures.readAndShare, change, onlineManager.isOnline());
  }

  /** The refused field takes focus: the reason for its own refusal, the first field for any other. */
  function focusRefused(code: RosterWriteFailure): void {
    focusAfterWrite(code === ROSTER_REFUSED_REASON ? reasonShown : first, first);
  }

  /** The callback ref of one listed change's removal button. */
  function removeActionRef(id: string): (element: HTMLButtonElement | null) => void {
    return (element) => {
      // A detached button is skipped by `focusAfterWrite`, so none is ever dropped.
      if (element !== null) removeActions.current.set(id, element);
    };
  }

  /**
   * THE SAVE ITSELF, under the latch its caller already holds: the insert of
   * what was entered — the values the check (if any) stood on — on `on`, the
   * day it was asked for. `erased` is how many conflicts the admin confirmed
   * it removes.
   */
  async function writeSave(on: DayDetail, startedFor: string | null, entered: RosterEntered, erased: number): Promise<void> {
    const client = supabaseClient();
    const { data } = await client.auth.getSession();
    const organization = claimedOrganizationOf(data.session?.access_token);

    if (organization === null) {
      if (!stillOn(startedFor)) return;
      setFailure(ROSTER_DENIED);
      focusRefused(ROSTER_DENIED);

      return;
    }

    const outcome = await setRosterOverride(
      client.from(ROSTER_OVERRIDES_TABLE) as unknown as RosterTable,
      organization,
      on,
      entered.out,
      entered.in,
      entered.reason,
    );

    if (!outcome.ok) {
      // TAKEN: another admin's change naming one of these members landed
      // first; the re-read brings the day as it is, and the Notice stays.
      if (outcome.code === ROSTER_TAKEN) await invalidate();
      if (!stillOn(startedFor)) return;
      setFailure(outcome.code);
      focusRefused(outcome.code);

      return;
    }

    await refreshLanded();
    if (!stillOn(startedFor)) return;
    setSaves((count) => count + 1);
    setChosenIn(ROSTER_NOBODY);
    setChosenOut(ROSTER_NOBODY);
    setDone(ROSTER_SAVED);
    setErased(erased);
    // The dialog closes, and focus returns to its opener in the day detail.
    setChanging(false);
    focusAfterWrite(opener);
  }

  /**
   * The form's save and the refusal's "Pokušaj ponovno" (story 5.5b): the
   * erasure check, then the write, under ONE latch held from the press to the
   * write's end. An entry the preflight refuses goes straight to the write,
   * which refuses it without a request, as it always did; so does a change
   * the database would refuse anyway. Otherwise the check: none erased
   * writes at once, some open their confirmation, and a check that cannot be
   * derived refuses the save with a retry. Nothing is written unchecked.
   */
  async function submitRoster(): Promise<void> {
    const out = outField.current;
    const put = inField.current;
    const reason = rosterReasonField.current;

    if (detail === null || out === null || put === null || reason === null || writing.current) return;

    const startedFor = day;
    const on = detail;
    const entered: RosterEntered = { out: out.value, in: put.value, reason: reason.value };

    writing.current = true;
    setFailure(null);
    setRemoveFailure(null);
    setDone(null);
    setErased(0);
    setUnchecked(null);
    setFormLost(false);
    setPending(true);

    try {
      const entry = rosterEntryOf(entered.out, entered.in, entered.reason);

      if (entry.ok) {
        const change: RosterSaveChange = {
          kind: ROSTER_CHANGE_SAVE,
          teamId: on.teamId,
          date: on.isoDate,
          memberOutId: entry.memberOutId,
          memberInId: entry.memberInId,
        };
        const check = await checkErasures(change);

        if (!stillOn(startedFor)) return;

        if (check.kind === CHECK_UNAVAILABLE) {
          setUnchecked(ROSTER_CHANGE_SAVE);
          focusAfterWrite(() => retryButton.current, first);

          return;
        }

        if (check.kind === CHECK_READY && check.rows.length > 0) {
          openedFrom.current = () => saveButton.current;
          confirmation.show(check.rows, { kind: ROSTER_CHANGE_SAVE, change, startedFor, on, entered });

          return;
        }
      }

      await writeSave(on, startedFor, entered, 0);
    } catch (cause) {
      console.error(ROSTER_FAILED, cause);
      if (!stillOn(startedFor)) return;
      setFailure(ROSTER_FAILED);
      focusRefused(ROSTER_FAILED);
    } finally {
      writing.current = false;
      setPending(false);
    }
  }

  function saveRoster(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    return submitRoster();
  }

  function openRemove(id: string): void {
    if (writing.current) return;

    // What the last write said belongs to it, not to the removal now armed.
    setFailure(null);
    setDone(null);
    setErased(0);
    setRemoveFailure(null);
    setUnchecked(null);
    setFormLost(false);
    setConfirming(id);
  }

  function cancelRemove(): void {
    if (writing.current) return;

    const from = confirming;

    setConfirming(null);
    setRemoveFailure(null);
    setUnchecked(null);
    confirmation.drop();
    focusAfterWrite(actionOf(from), first);
  }

  /**
   * THE REMOVAL ITSELF, under the latch its caller already holds. `confirmOpen`
   * says whether its own confirmation is still open (no erasure was listed);
   * after the erasure confirmation it is closed, and a refusal is said in the
   * day detail instead.
   */
  async function writeRemoval(startedFor: string | null, id: string, confirmOpen: boolean, erased: number): Promise<void> {
    const outcome = await removeRosterOverride(supabaseClient() as unknown as RosterRemoval, id);

    if (!outcome.ok) {
      // GONE: the change was removed meanwhile. The re-read brings the day
      // as it is, the confirmation closes, and the day detail says so.
      if (outcome.code === ROSTER_GONE) {
        await invalidate();
        if (!stillOn(startedFor)) return;
        setRemoveFailure(outcome.code);
        setConfirming(null);
        focusAfterWrite(actionOf(id), first);

        return;
      }
      if (!stillOn(startedFor)) return;
      setRemoveFailure(outcome.code);
      focusAfterWrite(confirmOpen ? cancelShown : actionOf(id), first);

      return;
    }

    await refreshLanded();
    if (!stillOn(startedFor)) return;
    setConfirming(null);
    setDone(ROSTER_REMOVED_DONE);
    setErased(erased);
    // The default roster is back, and so is the form's opener — or, on a day
    // with no form, the dialog's title.
    focusAfterWrite(opener);
  }

  /**
   * The removal confirmation's own confirm and its "Pokušaj ponovno" (story
   * 5.5b): the erasure check, then the removal, under one latch. None erased
   * removes at once; some close this confirmation and open the erasure
   * confirmation; a check that cannot be derived refuses here, with a retry.
   */
  async function removeChange(): Promise<void> {
    if (target === null || writing.current) return;

    const startedFor = day;
    const id = target.change.id;

    writing.current = true;
    setFailure(null);
    setRemoveFailure(null);
    setDone(null);
    setErased(0);
    setUnchecked(null);
    setFormLost(false);
    setPending(true);

    try {
      const change: RosterRemovalChange = { kind: ROSTER_CHANGE_REMOVAL, overrideId: id };
      const check = await checkErasures(change);

      if (!stillOn(startedFor)) return;

      if (check.kind === CHECK_UNAVAILABLE) {
        setUnchecked(ROSTER_CHANGE_REMOVAL);
        focusAfterWrite(() => retryButton.current, cancelShown);

        return;
      }

      if (check.kind === CHECK_READY && check.rows.length > 0) {
        setConfirming(null);
        openedFrom.current = actionOf(id);
        confirmation.show(check.rows, { kind: ROSTER_CHANGE_REMOVAL, change, startedFor });

        return;
      }

      await writeRemoval(startedFor, id, true, 0);
    } catch (cause) {
      console.error(ROSTER_FAILED, cause);
      if (!stillOn(startedFor)) return;
      setRemoveFailure(ROSTER_FAILED);
      focusAfterWrite(cancelShown);
    } finally {
      writing.current = false;
      setPending(false);
    }
  }

  /**
   * The erasure confirmation's own save, once every row is confirmed, under
   * the same one latch: the check is derived again from fresh reads for the
   * very change it was shown for. The same conflicts, as shown: the dialog
   * closes and the write runs. A changed list: shown again, undecided, with
   * a line saying so. A check that cannot be derived closes the dialog and
   * refuses the write where it was asked — the form, or the removal's own
   * confirmation, armed again.
   */
  async function confirmErasures(shown: NonNullable<typeof confirmation.shown>): Promise<void> {
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
        if (change.kind === ROSTER_CHANGE_SAVE) {
          setUnchecked(ROSTER_CHANGE_SAVE);
          focusAfterWrite(() => retryButton.current, first);

          return;
        }
        // THE CHANGE LEFT THE DAY meanwhile: there is nothing to retry.
        if (rosterRemovalTargetOf(shownDetail.current, change.overrideId) === null) {
          setRemoveFailure(ROSTER_GONE);
          focusAfterWrite(first);

          return;
        }
        // Its own confirmation, armed again, refuses with the retry.
        setUnchecked(ROSTER_CHANGE_REMOVAL);
        setConfirming(change.overrideId);
        focusAfterWrite(() => retryButton.current, cancelShown);

        return;
      }

      // REFUSED ANYWAY: the write's own refusal, said as the write would say
      // it, and the screen read again — nothing stale is written.
      if (check.kind === CHECK_REFUSED) {
        confirmation.drop();
        await invalidate();
        if (!stillOn(startedFor)) return;
        if (change.kind === ROSTER_CHANGE_REMOVAL) {
          setRemoveFailure(check.code);
          focusAfterWrite(actionOf(change.overrideId), first);
        } else {
          setFailure(check.code);
          focusRefused(check.code);
        }

        return;
      }

      if (confirmation.recheck(shown, check.rows, checked) === RECHECK_CHANGED) return;

      confirmation.drop();

      if (checked.kind === ROSTER_CHANGE_REMOVAL) {
        await writeRemoval(startedFor, checked.change.overrideId, false, check.rows.length);
      } else {
        await writeSave(checked.on, startedFor, checked.entered, check.rows.length);
      }
    } catch (cause) {
      console.error(ROSTER_FAILED, cause);
      confirmation.drop();
      if (!stillOn(startedFor)) return;
      if (change.kind === ROSTER_CHANGE_REMOVAL) setRemoveFailure(ROSTER_FAILED);
      else setFailure(ROSTER_FAILED);
      focusAfterWrite(first);
    } finally {
      writing.current = false;
      setPending(false);
    }
  }

  /** Any field of the form changed: a refusal to check what was entered before no longer stands. */
  function clearUnchecked(): void {
    if (unchecked === ROSTER_CHANGE_SAVE) setUnchecked(null);
  }

  /** "Pokušaj ponovno": the write the check refused, asked again. */
  function retry(): void {
    if (unchecked === ROSTER_CHANGE_REMOVAL) void removeChange();
    else void submitRoster();
  }

  /** "Promijeni sastav": the form's dialog opens; what the last write said belongs to it. */
  function openChange(): void {
    if (writing.current) return;

    setDone(null);
    setErased(0);
    setFailure(null);
    setUnchecked(null);
    setRemoveFailure(null);
    setFormLost(false);
    setChanging(true);
  }

  /** The dialog's cancel, close button and Escape: never while a write is in flight. Focus returns to the opener. */
  function closeChange(): void {
    if (writing.current) return;

    setChanging(false);
    setFailure(null);
    setUnchecked(null);
    focusAfterWrite(opener);
  }

  return {
    outField,
    inField,
    rosterReasonField,
    removeCancel,
    removeActionRef,
    pending,
    failure,
    confirming: target !== null,
    target,
    removeFailure,
    done,
    formKey: saves,
    overlap,
    chooseIn,
    outOptions: offers.out,
    inGroups: offers.inGroups,
    inUngrouped: offers.inUngrouped,
    formLost,
    offersSet: offers.set,
    openButton,
    changing: changing && offers.set,
    openChange,
    closeChange,
    chooseOut,
    preview,
    offersRemove: offers.remove,
    saveRoster,
    openRemove,
    cancelRemove,
    removeChange,
    saveButton,
    retryButton,
    unchecked,
    retry,
    clearUnchecked,
    erased,
    erasures: confirmation,
    confirmErasures,
  };
}

export type RosterFormState = ReturnType<typeof useRosterForm>;
