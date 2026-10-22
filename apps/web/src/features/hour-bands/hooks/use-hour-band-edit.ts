import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useRef, useState, type FormEvent } from 'react';

import {
  HOUR_BANDS_LIST_KEY,
  HOUR_BANDS_TABLE,
  hourBandPreviewOf,
  hourBandsQueryOptions,
  hourBandsSurfaceStateOf,
  type HourBandRow,
} from '@/features/hour-bands/services/list';
import { HOUR_BANDS_SURFACE_KEYS, hourBandsTimeZoneOf } from '@/features/hour-bands/services/surface-keys';
import {
  HOUR_BAND_REMOVED,
  HOUR_BAND_SAVED,
  HOUR_BAND_START_FIELD,
  HOUR_BAND_WRITE_UNAVAILABLE,
  REMOVE_ARMED,
  REMOVE_BUSY,
  hourBandFormStateOf,
  holdsRemovalOutcome,
  refusedFieldOf,
  removeHourBand,
  removeStageOf,
  savesAfter,
  updateHourBand,
  type HourBandSaved,
  type HourBandWriteFailure,
  type HourBandWriteTable,
} from '@/features/hour-bands/services/write';
import {
  HOUR_BAND_WRITE_DEPENDENTS,
  NO_DEPENDENTS,
  refreshAfterWrite,
  retryRead,
} from '@/features/teams/services/dependents';
import { ORGANIZATION_SNAPSHOT_KEY, type OrganizationOutcome } from '@/features/organization/services/snapshot';
import { formatMinuteOfDay } from '@/lib/i18n/format';
import { zoneFromReads } from '@/lib/offline/freshness';
import { useSnapshotFreshness } from '@/lib/offline/use-snapshot-freshness';
import { droppedOffline, writesOnline } from '@/lib/offline/use-write-gate';
import { supabaseClient } from '@/lib/supabase/client';
import { focusLater } from '@/utils/focus-later';

/**
 * One hour band's state, its one read and its two writes (story 2.1b): save
 * its name and start, or remove it.
 *
 * THE SAME ONE READ the list screen makes, under the same key: the band is
 * found in that answer, so the two screens can never show two versions of it.
 * The page keys this by the route's id, so an armed confirmation, a refusal or
 * a confirmation is never carried from one band to another.
 *
 * TWO REFUSAL STATES, each where it happened: the save's, which the fields are
 * described by, and the removal's, which marks no field invalid.
 *
 * Every rule is in `@/features/hour-bands/services/list` and
 * `@/features/hour-bands/services/write`, which the node suite executes; this
 * hook holds state and wiring only.
 */
export function useHourBandEdit(id: string) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const nameField = useRef<HTMLInputElement>(null);
  const startField = useRef<HTMLInputElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  /** The removal's own confirm (story 8.3b): focus returns to it when the connection drops under the removal. */
  const removeConfirm = useRef<HTMLButtonElement>(null);
  const writing = useRef(false);
  const [pending, setPending] = useState(false);
  const [armed, setArmed] = useState(false);
  /** The SAVE's refusal: the one the fields are described by. */
  const [failure, setFailure] = useState<HourBandWriteFailure | null>(null);
  /**
   * The REMOVAL's refusal, announced OUTSIDE the band's block, so it survives
   * that block unmounting when the re-read finds the band gone.
   */
  const [removeFailure, setRemoveFailure] = useState<HourBandWriteFailure | null>(null);
  const [saved, setSaved] = useState<HourBandSaved | null>(null);
  /** Landed saves; the form key counts them, never the values. */
  const [saves, setSaves] = useState(0);
  /** The start as typed since the form last mounted, or `null` for the stored one. */
  const [typedStart, setTypedStart] = useState<string | null>(null);

  const answerRead = useQuery(hourBandsQueryOptions(() => supabaseClient().from(HOUR_BANDS_TABLE)));
  // STORY 8.2d: the same one snapshot the list behind the dialog decides
  // (`HOUR_BANDS_SURFACE_KEYS`), so the form and the list are drawn from the
  // cached bands together, or are unavailable together. The as-of note is
  // the list's, under its heading; the dialog adds none.
  const timeZone = hourBandsTimeZoneOf(
    queryClient.getQueryData<OrganizationOutcome>(ORGANIZATION_SNAPSHOT_KEY),
  );
  const { clock, answerOf } = useSnapshotFreshness(
    HOUR_BANDS_SURFACE_KEYS,
    [[HOUR_BANDS_LIST_KEY, answerRead]],
    zoneFromReads(timeZone),
  );
  const answer = answerOf(answerRead);

  const readState = hourBandsSurfaceStateOf(answer);
  const { bands, refusal: readRefusal, loading } = readState;
  // NO READ RETRY OFFLINE (story 8.2d, decision 2a): `retryable` means "show
  // the read retry now" (story 8.2e) — the read's message is up, and the
  // connection is: offline the message stays without its retry, and the
  // retry comes back with the connection.
  const retryable = clock.online && readRefusal !== null;
  // A read failure hides the form, decided in `hourBandFormStateOf` from the state.
  const form = hourBandFormStateOf(readState, id, holdsRemovalOutcome(saved, removeFailure));
  const refusal = failure ?? form.refusal;
  const stage = removeStageOf(armed, pending);
  /** The removal is being asked about, or is in flight. */
  const confirming = stage === REMOVE_ARMED || stage === REMOVE_BUSY;
  const preview =
    bands === null || form.band === null
      ? null
      : hourBandPreviewOf(bands, typedStart ?? formatMinuteOfDay(form.band.startMinute), id);

  function close(): void {
    void navigate({ to: '/organizacija/satni-pojasi' });
  }

  /**
   * Re-read the one list, so both screens show what the database holds now,
   * and — after a write that landed — the calendar snapshot, whose bands
   * *Sati* derives hours from (story 4.1b).
   */
  async function refresh(landed: boolean): Promise<void> {
    try {
      await refreshAfterWrite(queryClient, HOUR_BANDS_LIST_KEY, landed ? HOUR_BAND_WRITE_DEPENDENTS : NO_DEPENDENTS);
    } catch (cause) {
      console.error(HOUR_BAND_WRITE_UNAVAILABLE, cause);
    }
  }

  /**
   * Save the name and start. Both fields are uncontrolled and the form is keyed
   * by landed saves only, so a refused save keeps what was typed even when the
   * re-read brings a band changed elsewhere.
   */
  async function submit(event: FormEvent<HTMLFormElement>, band: HourBandRow): Promise<void> {
    event.preventDefault();

    const name = nameField.current;
    const start = startField.current;

    if (name === null || start === null || writing.current) return;
    // STORY 8.3b: offline, nothing is sent — the component's gate is not the only guard.
    if (!writesOnline()) return;

    writing.current = true;
    // A save is a different decision from the removal it may interrupt.
    setArmed(false);
    setFailure(null);
    setRemoveFailure(null);
    setSaved(null);
    setPending(true);

    try {
      const outcome = await updateHourBand(
        supabaseClient().from(HOUR_BANDS_TABLE) as unknown as HourBandWriteTable,
        band,
        name.value,
        start.value,
      );

      // STORY 8.3b: the connection dropped under the write — the gate's note says why, not the write refusal.
      if (!outcome.ok && droppedOffline(outcome.code, HOUR_BAND_WRITE_UNAVAILABLE)) {
        name.focus();

        return;
      }

      if (!outcome.ok) {
        setFailure(outcome.code);
        (refusedFieldOf(outcome.code) === HOUR_BAND_START_FIELD ? start : name).focus();
      } else {
        setSaved(HOUR_BAND_SAVED);
      }

      await refresh(outcome.ok);
      // AFTER the re-read, so a remount shows what the database now holds.
      setSaves((current) => savesAfter(current, outcome));
      if (outcome.ok) setTypedStart(null);
    } catch (cause) {
      console.error(HOUR_BAND_WRITE_UNAVAILABLE, cause);
      // STORY 8.3b: offline now, the gate's note says why, not the write refusal.
      if (!writesOnline()) {
        name.focus();

        return;
      }
      setFailure(HOUR_BAND_WRITE_UNAVAILABLE);
    } finally {
      writing.current = false;
      setPending(false);
    }
  }

  /**
   * Remove, once confirmed. The confirmation stays mounted and disabled while
   * the write is outstanding, and is disarmed only in the `finally`.
   */
  async function remove(band: HourBandRow): Promise<void> {
    if (writing.current) return;
    // STORY 8.3b: offline, nothing is sent — the component's gate is not the only guard.
    if (!writesOnline()) return;

    // STORY 8.3b: the connection dropped under the removal — its confirmation stays armed.
    let keepArmed = false;

    writing.current = true;
    setFailure(null);
    setRemoveFailure(null);
    setSaved(null);
    setPending(true);

    try {
      const outcome = await removeHourBand(
        supabaseClient().from(HOUR_BANDS_TABLE) as unknown as HourBandWriteTable,
        band,
      );

      // STORY 8.3b: the connection dropped under the write — the gate's note says why, not the write refusal.
      if (!outcome.ok && droppedOffline(outcome.code, HOUR_BAND_WRITE_UNAVAILABLE)) {
        keepArmed = true;
        focusLater([() => removeConfirm.current], () => nameField.current);

        return;
      }

      if (!outcome.ok) {
        setRemoveFailure(outcome.code);
      } else {
        setSaved(HOUR_BAND_REMOVED);
      }

      await refresh(outcome.ok);

      // The confirm button this press came from is gone with the band, so
      // focus would fall to the document. The dialog's close is where a
      // person goes next, and it is always rendered.
      if (outcome.ok) closeButton.current?.focus();
    } catch (cause) {
      console.error(HOUR_BAND_WRITE_UNAVAILABLE, cause);
      // STORY 8.3b: offline now, the gate's note says why, not the write refusal.
      if (!writesOnline()) {
        keepArmed = true;
        focusLater([() => removeConfirm.current], () => nameField.current);

        return;
      }
      setRemoveFailure(HOUR_BAND_WRITE_UNAVAILABLE);
    } finally {
      writing.current = false;
      setPending(false);
      if (!keepArmed) setArmed(false);
    }
  }

  /** Read the list again, from the unavailable notice's retry. */
  function retry(): void {
    void retryRead(queryClient, HOUR_BANDS_LIST_KEY);
  }

  return {
    retry,
    retryable,
    nameField,
    startField,
    closeButton,
    removeConfirm,
    pending,
    setArmed,
    failure,
    removeFailure,
    setRemoveFailure,
    saved,
    setSaved,
    saves,
    setTypedStart,
    readRefusal,
    loading,
    form,
    refusal,
    stage,
    confirming,
    preview,
    close,
    submit,
    remove,
  };
}

/** What the edit screen's parts are drawn from. */
export type HourBandEditScreen = ReturnType<typeof useHourBandEdit>;
