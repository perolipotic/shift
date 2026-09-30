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
} from '@/features/teams/services/dependents';
import { formatMinuteOfDay } from '@/lib/i18n/format';
import { supabaseClient } from '@/lib/supabase/client';

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

  const answer = useQuery(hourBandsQueryOptions(() => supabaseClient().from(HOUR_BANDS_TABLE)));

  const readState = hourBandsSurfaceStateOf(answer);
  const { bands, refusal: readRefusal, loading } = readState;
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
      setRemoveFailure(HOUR_BAND_WRITE_UNAVAILABLE);
    } finally {
      writing.current = false;
      setPending(false);
      setArmed(false);
    }
  }

  return {
    nameField,
    startField,
    closeButton,
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
