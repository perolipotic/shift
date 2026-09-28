import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';

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
import {
  OVERRIDE_REFUSED_REASON,
  overrideOffersOf,
  overrideRemovalTargetOf,
  type DayDetail,
} from '@/features/calendar/utils/day-detail';
import { DAY_DETAIL_HEADING_ID } from '@/features/calendar/utils/element-ids';
import { claimedOrganizationOf } from '@/features/teams/services/write';
import { supabaseClient } from '@/lib/supabase/client';

/**
 * THE ADMIN'S OVERRIDE FORM (story 3.5b): setting a shift-type override on
 * the open day, and removing it through a neutral confirmation.
 *
 * SHOWN BY THE VIEWER'S ROLE, DECIDED BY THE DATABASE. The form and the
 * removal are offered only while `snapshot.viewer.role` is `admin`; the
 * insert policy and the removal function refuse everyone else anyway.
 *
 * ONE WRITE AT A TIME. `writing` latches a second submit, and `pending` keeps
 * the day detail and the confirmation from being dismissed, and their buttons
 * disabled, until the write has settled.
 *
 * A REFUSAL KEEPS WHAT WAS ENTERED: both fields are uncontrolled and nothing
 * clears them on that path; the refused field (or the first) takes focus.
 *
 * ONLY `CALENDAR_KEY` IS INVALIDATED — on success, and on the two refusals
 * that mean the screen is stale (`taken`, `gone`) — and awaited while still
 * pending: the detail re-derives from the new snapshot, so the `✎`, the
 * override block and the form or the removal follow by themselves. A write
 * that settles after another day was opened drops its result there.
 *
 * A WRITE THAT LANDED IS SAID: `done` holds the save, or the removal and the
 * type it restored, for a `role="status"` Notice, until the next write or
 * another day.
 *
 * Every rule is in `@/features/calendar/services/override-write` and
 * `@/features/calendar/utils/day-detail`, which the node suite executes;
 * this hook holds state and wiring only.
 */
export function useOverrideForm(snapshot: CalendarSnapshot | null, detail: DayDetail | null) {
  const queryClient = useQueryClient();
  const typeField = useRef<HTMLSelectElement>(null);
  const reasonField = useRef<HTMLInputElement>(null);
  const removeAction = useRef<HTMLButtonElement>(null);
  const removeCancel = useRef<HTMLButtonElement>(null);
  const writing = useRef(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<OverrideWriteFailure | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [removeFailure, setRemoveFailure] = useState<OverrideWriteFailure | null>(null);
  const [done, setDone] = useState<OverrideDone | null>(null);
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
  }

  const offers = overrideOffersOf(snapshot, detail);
  // The override in force, or — story 3.5c — the one pending review.
  const override = overrideRemovalTargetOf(detail);

  /** Whether the day a write started for is still the one open. */
  function stillOn(startedFor: string | null): boolean {
    return openDay.current === startedFor;
  }

  /**
   * Focus, once the write has settled and `pending` no longer disables the
   * controls: the first of `targets` still in the document, else the day
   * detail's title, so focus never falls to the page body.
   */
  function focusLater(...targets: readonly { readonly current: HTMLElement | null }[]): void {
    requestAnimationFrame(() => {
      const found = targets.map((target) => target.current).find((element) => element?.isConnected === true);

      (found ?? document.getElementById(DAY_DETAIL_HEADING_ID))?.focus();
    });
  }

  async function invalidate(): Promise<void> {
    try {
      await queryClient.invalidateQueries({ queryKey: CALENDAR_KEY });
    } catch (cause) {
      console.error(OVERRIDE_FAILED, cause);
    }
  }

  /** The refused field takes focus: the reason for its own refusal, the type (the first field) for any other. */
  function focusRefused(code: OverrideWriteFailure): void {
    focusLater(code === OVERRIDE_REFUSED_REASON ? reasonField : typeField, typeField, removeAction);
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const type = typeField.current;
    const reason = reasonField.current;

    if (detail === null || type === null || reason === null || writing.current) return;

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
        setFailure(OVERRIDE_DENIED);
        focusRefused(OVERRIDE_DENIED);

        return;
      }

      const outcome = await setShiftTypeOverride(
        client.from(OVERRIDES_TABLE) as unknown as OverrideTable,
        organization,
        detail,
        type.value,
        reason.value,
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

      await invalidate();
      if (!stillOn(startedFor)) return;
      setDone({ code: OVERRIDE_SAVED });
      // The form gives way to the override block and its removal.
      focusLater(removeAction);
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

    setRemoveFailure(null);
    setConfirming(true);
  }

  function cancelRemove(): void {
    if (writing.current) return;

    setConfirming(false);
    setRemoveFailure(null);
    focusLater(removeAction);
  }

  async function remove(): Promise<void> {
    if (override === null || writing.current) return;

    const startedFor = day;
    const projectedTypeName = override.projectedTypeName;

    writing.current = true;
    setRemoveFailure(null);
    setDone(null);
    setPending(true);

    try {
      const outcome = await removeShiftTypeOverride(supabaseClient() as unknown as OverrideRemoval, override.id);

      if (!outcome.ok) {
        // GONE: the override was removed meanwhile. The re-read brings the
        // day as it is, the confirmation closes, and the day detail says so.
        if (outcome.code === OVERRIDE_GONE) {
          await invalidate();
          if (!stillOn(startedFor)) return;
          setRemoveFailure(outcome.code);
          setConfirming(false);
          focusLater(removeAction, typeField);

          return;
        }
        if (!stillOn(startedFor)) return;
        setRemoveFailure(outcome.code);
        focusLater(removeCancel);

        return;
      }

      await invalidate();
      if (!stillOn(startedFor)) return;
      setConfirming(false);
      setDone({ code: OVERRIDE_REMOVED, projectedTypeName });
      // The projection is back, and so is the form — or, with no type to
      // offer, the dialog's title.
      focusLater(typeField);
    } catch (cause) {
      console.error(OVERRIDE_FAILED, cause);
      if (!stillOn(startedFor)) return;
      setRemoveFailure(OVERRIDE_FAILED);
      focusLater(removeCancel);
    } finally {
      writing.current = false;
      setPending(false);
    }
  }

  return {
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
    offersRemove: offers.remove,
    submit,
    openRemove,
    cancelRemove,
    remove,
  };
}

export type OverrideFormState = ReturnType<typeof useOverrideForm>;
