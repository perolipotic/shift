import { useQueryClient } from '@tanstack/react-query';
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
import { CALENDAR_KEY, type CalendarSnapshot } from '@/features/calendar/services/snapshot';
import {
  ROSTER_NOBODY,
  ROSTER_REFUSED_REASON,
  rosterOffersOf,
  rosterOverlapShownOf,
  rosterRemovalTargetOf,
  type DayDetail,
} from '@/features/calendar/utils/day-detail';
import { DAY_DETAIL_HEADING_ID } from '@/features/calendar/utils/element-ids';
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
 * ONLY `CALENDAR_KEY` IS INVALIDATED — on success, and on the two refusals
 * that mean the screen is stale (`taken`, `gone`) — and awaited while still
 * pending: the detail re-derives from the new snapshot, so the `✎`, the
 * change blocks and the candidates follow by themselves. A write that
 * settles after another day was opened drops its result there.
 *
 * A MEMBER WHO WOULD BE DOUBLE-BOOKED IS WARNED OF, NEVER REFUSED (Epic 4
 * retro C2): the "Dolazi" `Select` stays uncontrolled, and `chosenIn` only
 * mirrors its value for `rosterOverlapShownOf`, which decides the hint. The
 * form re-syncs it on every mount and forgets it on unmount (`chooseIn`), and
 * it is forgotten on another day, after a save, and as soon as the member is
 * no longer offered — so it never names someone the `Select` does not show.
 *
 * Every rule is in `@/features/calendar/services/roster-write` and
 * `@/features/calendar/utils/day-detail`, which the node suite executes;
 * this hook holds state and wiring only.
 */
export function useRosterForm(
  snapshot: CalendarSnapshot | null,
  detail: DayDetail | null,
  latch: RefObject<boolean>,
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
  // The "Dolazi" value, mirrored for the overlap hint alone: the save reads the field.
  const [chosenIn, setChosenIn] = useState<string>(ROSTER_NOBODY);
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
  }

  const offers = rosterOffersOf(snapshot, detail);

  // A member no longer offered (a save, or a re-read after `taken`) is no
  // longer chosen: the remounted `Select` shows "— nitko —".
  if (chosenIn !== ROSTER_NOBODY && !offers.in.some((one) => one.id === chosenIn)) {
    setChosenIn(ROSTER_NOBODY);
  }

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
    focusLater(targets, () => document.getElementById(DAY_DETAIL_HEADING_ID));
  }

  const first = () => outField.current;
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

  async function invalidate(): Promise<void> {
    try {
      await queryClient.invalidateQueries({ queryKey: CALENDAR_KEY });
    } catch (cause) {
      console.error(ROSTER_FAILED, cause);
    }
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

  async function saveRoster(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const out = outField.current;
    const put = inField.current;
    const reason = rosterReasonField.current;

    if (detail === null || out === null || put === null || reason === null || writing.current) return;

    const startedFor = day;

    writing.current = true;
    setFailure(null);
    setRemoveFailure(null);
    setDone(null);
    setPending(true);

    try {
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
        detail,
        out.value,
        put.value,
        reason.value,
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

      await invalidate();
      if (!stillOn(startedFor)) return;
      setSaves((count) => count + 1);
      setChosenIn(ROSTER_NOBODY);
      setDone(ROSTER_SAVED);
      focusAfterWrite(first);
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

  function openRemove(id: string): void {
    if (writing.current) return;

    // What the last write said belongs to it, not to the removal now armed.
    setFailure(null);
    setDone(null);
    setRemoveFailure(null);
    setConfirming(id);
  }

  function cancelRemove(): void {
    if (writing.current) return;

    const from = confirming;

    setConfirming(null);
    setRemoveFailure(null);
    focusAfterWrite(actionOf(from), first);
  }

  async function removeChange(): Promise<void> {
    if (target === null || writing.current) return;

    const startedFor = day;
    const id = target.change.id;

    writing.current = true;
    setFailure(null);
    setRemoveFailure(null);
    setDone(null);
    setPending(true);

    try {
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
        focusAfterWrite(cancelShown);

        return;
      }

      await invalidate();
      if (!stillOn(startedFor)) return;
      setConfirming(null);
      setDone(ROSTER_REMOVED_DONE);
      // The default roster is back, and so are its candidates in the form —
      // or, on a day with no form, the dialog's title.
      focusAfterWrite(first);
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
    inOptions: offers.in,
    offersSet: offers.set,
    offersRemove: offers.remove,
    saveRoster,
    openRemove,
    cancelRemove,
    removeChange,
  };
}

export type RosterFormState = ReturnType<typeof useRosterForm>;
