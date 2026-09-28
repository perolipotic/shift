import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import {
  HOUR_BANDS_LIST_KEY,
  HOUR_BANDS_TABLE,
  hourBandDisplayRowsOf,
  hourBandPreviewOf,
  hourBandsQueryOptions,
  hourBandsNoticeOf,
  hourBandsSurfaceStateOf,
  partitionBarOf,
} from '@/features/hour-bands/services/list';
import {
  HOUR_BAND_START_FIELD,
  HOUR_BAND_WRITE_REFUSED,
  HOUR_BAND_WRITE_UNAVAILABLE,
  claimedOrganizationOf,
  createHourBand,
  refusedFieldOf,
  type HourBandWriteFailure,
  type HourBandWriteTable,
} from '@/features/hour-bands/services/write';
import { NO_TEXT } from '@/features/members/services/list';
import { supabaseClient } from '@/lib/supabase/client';

/**
 * The hour band list's state, its one read and its add (story 2.1b): the add
 * dialog's two uncontrolled fields, its in-flight ref and outcome, the start
 * as typed for the end shown beside it, and the rows and the bar the list
 * draws.
 *
 * ONE READ (AD-13): the rows, the count and the bar all come from the single
 * `useQuery` under `HOUR_BANDS_LIST_KEY`. The add needs the caller's
 * organization, read from the session's own claim at submit time.
 *
 * Every rule is in `@/features/hour-bands/services/list` and
 * `@/features/hour-bands/services/write`, which the node suite executes; this
 * hook holds state and wiring only.
 */
export function useHourBandList() {
  const queryClient = useQueryClient();
  const nameField = useRef<HTMLInputElement>(null);
  const startField = useRef<HTMLInputElement>(null);
  const creating = useRef(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<HourBandWriteFailure | null>(null);
  const [created, setCreated] = useState(false);
  const [adding, setAdding] = useState(false);
  /** The start as typed, for the end shown beside it; the field stays uncontrolled. */
  const [typedStart, setTypedStart] = useState(NO_TEXT);

  // The first field, once the dialog is open. The dialog's own effect runs
  // first, so `showModal()` has already moved focus into it.
  useEffect(() => {
    if (adding) nameField.current?.focus();
  }, [adding]);

  const answer = useQuery(hourBandsQueryOptions(() => supabaseClient().from(HOUR_BANDS_TABLE)));

  const state = hourBandsSurfaceStateOf(answer);
  const { bands, loading } = state;
  // THE LIST'S NOTICE: the refusal, or the unavailable message beside rows a
  // refetch paused offline over, which is never a refusal (an edit form keeps them).
  const refusal = hourBandsNoticeOf(state);
  const rows = bands === null ? null : hourBandDisplayRowsOf(bands);
  const bar = bands === null ? null : partitionBarOf(bands);
  const preview = bands === null ? null : hourBandPreviewOf(bands, typedStart, null);

  function openAdding(): void {
    setFailure(null);
    setCreated(false);
    setAdding(true);
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const name = nameField.current;
    const start = startField.current;

    if (name === null || start === null || creating.current) return;

    creating.current = true;
    setFailure(null);
    setCreated(false);
    setPending(true);

    try {
      const client = supabaseClient();
      const { data } = await client.auth.getSession();
      const organization = claimedOrganizationOf(data.session?.access_token);

      if (organization === null) {
        setFailure(HOUR_BAND_WRITE_REFUSED);

        return;
      }

      const outcome = await createHourBand(
        client.from(HOUR_BANDS_TABLE) as unknown as HourBandWriteTable,
        organization,
        name.value,
        start.value,
      );

      // A REFUSED SAVE KEEPS THE ENTERED VALUES: both fields are uncontrolled
      // and nothing here clears them on this path (UX-DR34). Focus goes to the
      // field the refusal is about.
      if (!outcome.ok) {
        setFailure(outcome.code);
        (refusedFieldOf(outcome.code) === HOUR_BAND_START_FIELD ? start : name).focus();

        return;
      }

      name.value = NO_TEXT;
      start.value = NO_TEXT;
      setTypedStart(NO_TEXT);
      setCreated(true);
      // Closed, and the confirmation is on the page; focus returns to the
      // button that opened the dialog.
      setAdding(false);

      try {
        await queryClient.invalidateQueries({ queryKey: HOUR_BANDS_LIST_KEY });
      } catch (cause) {
        console.error(HOUR_BAND_WRITE_UNAVAILABLE, cause);
      }
    } catch (cause) {
      console.error(HOUR_BAND_WRITE_UNAVAILABLE, cause);
      setFailure(HOUR_BAND_WRITE_UNAVAILABLE);
    } finally {
      creating.current = false;
      setPending(false);
    }
  }

  return {
    nameField,
    startField,
    pending,
    failure,
    created,
    setCreated,
    adding,
    setAdding,
    setTypedStart,
    openAdding,
    submit,
    refusal,
    loading,
    rows,
    bar,
    preview,
  };
}

/** What the list screen's parts are drawn from. */
export type HourBandListScreen = ReturnType<typeof useHourBandList>;
