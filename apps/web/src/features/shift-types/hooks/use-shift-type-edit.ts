import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useRef, useState, type FormEvent } from 'react';

import { ROTATION_KEY, type RotationSnapshot } from '@/features/rotation/services/list';
import { ROTATION_SURFACE_KEYS, rotationSurfaceTimeZoneOf } from '@/features/rotation/services/surface-keys';
import {
  SHIFT_TYPES_LIST_KEY,
  SHIFT_TYPES_READ_TABLE,
  SHIFT_TYPES_TABLE,
  SHIFT_TYPE_VERSIONS_TABLE,
  shiftTypeDisplayRowOf,
  shiftTypesQueryOptions,
  shiftTypesSurfaceStateOf,
  shiftTypesSubmitTodayOf,
  shiftTypesTodayOf,
  type ShiftTypeRow,
} from '@/features/shift-types/services/list';
import {
  ARCHIVE_ARMED,
  ARCHIVE_BUSY,
  SHIFT_TYPE_ARCHIVED,
  SHIFT_TYPE_DATE_FIELD,
  SHIFT_TYPE_RENAMED,
  SHIFT_TYPE_START_FIELD,
  SHIFT_TYPE_TIMES_CANCELLED,
  SHIFT_TYPE_TIMES_SAVED,
  SHIFT_TYPE_WRITE_UNAVAILABLE,
  archiveShiftType,
  archiveStageOf,
  cancelScheduledTimes,
  correctShiftTypeTimes,
  focusesConfirmation,
  refusedFieldOf,
  renameShiftType,
  savesAfter,
  shiftTypeFormStateOf,
  type ShiftTypeSaved,
  type ShiftTypeVersionWriteTable,
  type ShiftTypeWriteFailure,
  type ShiftTypeWriteTable,
} from '@/features/shift-types/services/write';
import { retryRead } from '@/features/teams/services/dependents';
import { zoneFromReads } from '@/lib/offline/freshness';
import { useSnapshotFreshness } from '@/lib/offline/use-snapshot-freshness';
import { droppedOffline, writesOnline } from '@/lib/offline/use-write-gate';
import { supabaseClient } from '@/lib/supabase/client';
import { focusLater } from '@/utils/focus-later';

/**
 * One shift type's state, its one read and its four writes (story 2.2b):
 * rename it, correct its times from a chosen date, cancel a scheduled
 * correction, or archive it.
 *
 * THE SAME ONE READ the list screen makes, under the same key, so the two
 * screens can never show two versions of a type. The page keys this by the
 * route's id, so nothing armed or announced for one type is carried to
 * another.
 *
 * THREE REFUSAL STATES, each where its write happened: the rename's above the
 * form, the times' in the times block, the archive's in the archive block.
 *
 * Every rule is in `@/features/shift-types/services/list` and
 * `@/features/shift-types/services/write`, which the node suite executes; this
 * hook holds state and wiring only.
 */
export function useShiftTypeEdit(id: string) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const nameField = useRef<HTMLInputElement>(null);
  const dateField = useRef<HTMLInputElement>(null);
  const startField = useRef<HTMLInputElement>(null);
  const endField = useRef<HTMLInputElement>(null);
  /** The confirmation, where focus goes when the pressed control unmounts. */
  const confirmation = useRef<HTMLParagraphElement>(null);
  /** The cancel of scheduled times and the archive's confirm (story 8.3b): focus returns to them when the connection drops under their write. */
  const cancelTimesButton = useRef<HTMLButtonElement>(null);
  const archiveConfirm = useRef<HTMLButtonElement>(null);
  const writing = useRef(false);
  const [pending, setPending] = useState(false);
  const [armed, setArmed] = useState(false);
  /** The RENAME's refusal: the one the name field is described by. */
  const [failure, setFailure] = useState<ShiftTypeWriteFailure | null>(null);
  /** The TIMES block's refusal. */
  const [timesFailure, setTimesFailure] = useState<ShiftTypeWriteFailure | null>(null);
  /** The ARCHIVE's refusal, announced inside the archive block. */
  const [archiveFailure, setArchiveFailure] = useState<ShiftTypeWriteFailure | null>(null);
  const [saved, setSaved] = useState<ShiftTypeSaved | null>(null);
  /** Landed renames; the form key counts them, never the name. */
  const [saves, setSaves] = useState(0);

  const answerRead = useQuery(
    shiftTypesQueryOptions(() => supabaseClient().from(SHIFT_TYPES_READ_TABLE)),
  );
  // STORY 8.2d: the shift types are one snapshot with the rotation builder's
  // (`ROTATION_SURFACE_KEYS`), decided here from this observer and, for the
  // builder's read, from the cache — so the page is drawn whole under one
  // note or is unavailable as one. THE ZONE is the one either snapshot
  // embeds. The page's as-of note is the builder's, under the page
  // heading behind the dialog; the dialog adds none.
  const timeZone = rotationSurfaceTimeZoneOf(
    answerRead.data,
    queryClient.getQueryData<RotationSnapshot>(ROTATION_KEY),
  );
  const { clock, answerOf } = useSnapshotFreshness(
    ROTATION_SURFACE_KEYS,
    [[SHIFT_TYPES_LIST_KEY, answerRead]],
    zoneFromReads(timeZone),
  );
  const answer = answerOf(answerRead);

  const readState = shiftTypesSurfaceStateOf(answer);
  const { snapshot, refusal: readRefusal, loading } = readState;
  // NO READ RETRY OFFLINE (story 8.2d, decision 2a): `retryable` means "show
  // the read retry now" (story 8.2e) — the read's message is up, and the
  // connection is: offline the message stays without its retry, and the
  // retry comes back with the connection.
  const retryable = clock.online && readRefusal !== null;
  // A read failure hides the form, decided in `shiftTypeFormStateOf`.
  const form = shiftTypeFormStateOf(readState, id);
  const refusal = failure ?? form.refusal;
  const today = snapshot === null ? null : shiftTypesTodayOf(snapshot, new Date());
  const row = snapshot === null || today === null ? null : shiftTypeDisplayRowOf(snapshot, id, today);
  const stage = archiveStageOf(armed, pending);
  /** The archive is being asked about, or is in flight. */
  const confirming = stage === ARCHIVE_ARMED || stage === ARCHIVE_BUSY;

  function close(): void {
    void navigate({ to: '/postavke-rotacije' });
  }

  /** Re-read the one list, so both screens show what the database holds now. */
  async function refresh(): Promise<void> {
    try {
      // The rotation builder draws the types too (its own snapshot, story
      // 2.3b). Both re-reads start together, so one failing cannot skip the
      // other.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: SHIFT_TYPES_LIST_KEY }),
        queryClient.invalidateQueries({ queryKey: ROTATION_KEY }),
      ]);
    } catch (cause) {
      console.error(SHIFT_TYPE_WRITE_UNAVAILABLE, cause);
    }
  }

  function clearOutcomes(): void {
    setFailure(null);
    setTimesFailure(null);
    setArchiveFailure(null);
    setSaved(null);
  }

  /** Rename. Uncontrolled, and keyed by landed renames only. */
  async function submit(event: FormEvent<HTMLFormElement>, type: ShiftTypeRow): Promise<void> {
    event.preventDefault();

    const name = nameField.current;

    if (name === null || writing.current) return;
    // STORY 8.3b: offline, nothing is sent — the component's gate is not the only guard.
    if (!writesOnline()) return;

    writing.current = true;
    // A rename is a different decision from the archive it may interrupt.
    setArmed(false);
    clearOutcomes();
    setPending(true);

    try {
      const outcome = await renameShiftType(
        supabaseClient().from(SHIFT_TYPES_TABLE) as unknown as ShiftTypeWriteTable,
        type,
        name.value,
      );

      // STORY 8.3b: the connection dropped under the write — the gate's note says why, not the write refusal.
      if (!outcome.ok && droppedOffline(outcome.code, SHIFT_TYPE_WRITE_UNAVAILABLE)) {
        name.focus();

        return;
      }

      if (!outcome.ok) {
        setFailure(outcome.code);
        name.focus();
      } else {
        setSaved(SHIFT_TYPE_RENAMED);
      }

      await refresh();
      // AFTER the re-read, so a remount shows what the database now holds.
      setSaves((current) => savesAfter(current, outcome));
    } catch (cause) {
      console.error(SHIFT_TYPE_WRITE_UNAVAILABLE, cause);
      // STORY 8.3b: offline now, the gate's note says why, not the write refusal.
      if (!writesOnline()) {
        name.focus();

        return;
      }
      setFailure(SHIFT_TYPE_WRITE_UNAVAILABLE);
    } finally {
      writing.current = false;
      setPending(false);
    }
  }

  /**
   * Correct (or first set) the times from the chosen date. The block is keyed
   * by the type's version history, so a landed version returns the date to
   * the new minimum and a refusal keeps every entered value.
   */
  async function saveTimes(event: FormEvent<HTMLFormElement>, type: ShiftTypeRow): Promise<void> {
    event.preventDefault();

    const date = dateField.current;
    const start = startField.current;
    const end = endField.current;
    // THE ORGANIZATION'S TODAY AS AT SUBMIT, never the one this screen drew.
    const on = shiftTypesSubmitTodayOf(snapshot);

    if (date === null || start === null || end === null || on === null || writing.current) {
      return;
    }
    // STORY 8.3b: offline, nothing is sent — the component's gate is not the only guard.
    if (!writesOnline()) return;

    writing.current = true;
    setArmed(false);
    clearOutcomes();
    setPending(true);

    try {
      const outcome = await correctShiftTypeTimes(
        supabaseClient().from(SHIFT_TYPE_VERSIONS_TABLE) as unknown as ShiftTypeVersionWriteTable,
        type,
        { date: date.value, start: start.value, end: end.value },
        on,
      );

      // STORY 8.3b: the connection dropped under the write — the gate's note says why, not the write refusal.
      if (!outcome.ok && droppedOffline(outcome.code, SHIFT_TYPE_WRITE_UNAVAILABLE)) {
        date.focus();

        return;
      }

      if (!outcome.ok) {
        setTimesFailure(outcome.code);

        const field = refusedFieldOf(outcome.code, SHIFT_TYPE_DATE_FIELD);

        (field === SHIFT_TYPE_START_FIELD ? start : date).focus();
      } else {
        setSaved(SHIFT_TYPE_TIMES_SAVED);
      }

      await refresh();
    } catch (cause) {
      console.error(SHIFT_TYPE_WRITE_UNAVAILABLE, cause);
      // STORY 8.3b: offline now, the gate's note says why, not the write refusal.
      if (!writesOnline()) {
        date.focus();

        return;
      }
      setTimesFailure(SHIFT_TYPE_WRITE_UNAVAILABLE);
    } finally {
      writing.current = false;
      setPending(false);
    }
  }

  /** Cancel the scheduled correction; the correction is offered again after. */
  async function cancelTimes(type: ShiftTypeRow): Promise<void> {
    const on = shiftTypesSubmitTodayOf(snapshot);

    if (on === null || writing.current) return;
    // STORY 8.3b: offline, nothing is sent — the component's gate is not the only guard.
    if (!writesOnline()) return;

    writing.current = true;
    setArmed(false);
    clearOutcomes();
    setPending(true);

    try {
      const outcome = await cancelScheduledTimes(
        supabaseClient().from(SHIFT_TYPE_VERSIONS_TABLE) as unknown as ShiftTypeVersionWriteTable,
        type,
        on,
      );

      // STORY 8.3b: the connection dropped under the write — the gate's note says why, not the write refusal.
      if (!outcome.ok && droppedOffline(outcome.code, SHIFT_TYPE_WRITE_UNAVAILABLE)) {
        focusLater([() => cancelTimesButton.current], () => nameField.current);

        return;
      }

      const landed = outcome.ok ? SHIFT_TYPE_TIMES_CANCELLED : null;

      if (!outcome.ok) setTimesFailure(outcome.code);
      setSaved(landed);

      await refresh();

      // The cancel button unmounts with the scheduled change; focus follows
      // the confirmation rather than falling to the document.
      if (focusesConfirmation(landed)) confirmation.current?.focus();
    } catch (cause) {
      console.error(SHIFT_TYPE_WRITE_UNAVAILABLE, cause);
      // STORY 8.3b: offline now, the gate's note says why, not the write refusal.
      if (!writesOnline()) {
        focusLater([() => cancelTimesButton.current], () => nameField.current);

        return;
      }
      setTimesFailure(SHIFT_TYPE_WRITE_UNAVAILABLE);
    } finally {
      writing.current = false;
      setPending(false);
    }
  }

  /**
   * Archive, once confirmed. The confirmation stays mounted and disabled while
   * the write is outstanding, and is disarmed only in the `finally`.
   */
  async function archive(type: ShiftTypeRow): Promise<void> {
    const on = shiftTypesSubmitTodayOf(snapshot);

    if (on === null || writing.current) return;
    // STORY 8.3b: offline, nothing is sent — the component's gate is not the only guard.
    if (!writesOnline()) return;

    // STORY 8.3b: the connection dropped under the archive — its confirmation stays armed.
    let keepArmed = false;

    writing.current = true;
    clearOutcomes();
    setPending(true);

    try {
      const outcome = await archiveShiftType(
        supabaseClient().from(SHIFT_TYPES_TABLE) as unknown as ShiftTypeWriteTable,
        type,
        on,
      );
      // STORY 8.3b: the connection dropped under the write — the gate's note says why, not the write refusal.
      if (!outcome.ok && droppedOffline(outcome.code, SHIFT_TYPE_WRITE_UNAVAILABLE)) {
        keepArmed = true;
        focusLater([() => archiveConfirm.current], () => nameField.current);

        return;
      }

      const landed = outcome.ok ? SHIFT_TYPE_ARCHIVED : null;

      if (!outcome.ok) setArchiveFailure(outcome.code);
      setSaved(landed);

      await refresh();

      // The confirm button unmounts once the type reads as archived; focus
      // follows the confirmation rather than falling to the document.
      if (focusesConfirmation(landed)) confirmation.current?.focus();
    } catch (cause) {
      console.error(SHIFT_TYPE_WRITE_UNAVAILABLE, cause);
      // STORY 8.3b: offline now, the gate's note says why, not the write refusal.
      if (!writesOnline()) {
        keepArmed = true;
        focusLater([() => archiveConfirm.current], () => nameField.current);

        return;
      }
      setArchiveFailure(SHIFT_TYPE_WRITE_UNAVAILABLE);
    } finally {
      writing.current = false;
      setPending(false);
      if (!keepArmed) setArmed(false);
    }
  }

  /** Read the list again, from the unavailable notice's retry. */
  function retry(): void {
    void retryRead(queryClient, SHIFT_TYPES_LIST_KEY);
  }

  return {
    retry,
    retryable,
    nameField,
    dateField,
    startField,
    endField,
    confirmation,
    cancelTimesButton,
    archiveConfirm,
    pending,
    setArmed,
    failure,
    timesFailure,
    archiveFailure,
    setArchiveFailure,
    saved,
    setSaved,
    saves,
    readRefusal,
    loading,
    form,
    refusal,
    today,
    row,
    stage,
    confirming,
    close,
    submit,
    saveTimes,
    cancelTimes,
    archive,
  };
}

/** What one shift type's parts are drawn from. */
export type ShiftTypeEditScreen = ReturnType<typeof useShiftTypeEdit>;
