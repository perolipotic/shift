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
import { HOUR_BANDS_SURFACE_KEYS, hourBandsTimeZoneOf } from '@/features/hour-bands/services/surface-keys';
import {
  HOUR_BAND_START_FIELD,
  HOUR_BAND_WRITE_REFUSED,
  HOUR_BAND_WRITE_UNAVAILABLE,
  createHourBand,
  refusedFieldOf,
  type HourBandWriteFailure,
  type HourBandWriteTable,
} from '@/features/hour-bands/services/write';
import { ORGANIZATION_SNAPSHOT_KEY, type OrganizationOutcome } from '@/features/organization/services/snapshot';
import { HOUR_BAND_WRITE_DEPENDENTS, refreshAfterWrite, retryRead } from '@/features/teams/services/dependents';
import { offlineNoteOf, zoneFromReads } from '@/lib/offline/freshness';
import { useSnapshotFreshness } from '@/lib/offline/use-snapshot-freshness';
import { droppedOffline, writesOnline } from '@/lib/offline/use-write-gate';
import { claimedOrganizationOf } from '@/lib/supabase/claims';
import { supabaseClient } from '@/lib/supabase/client';
import { NO_TEXT } from '@/utils/text';

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

  const answerRead = useQuery(hourBandsQueryOptions(() => supabaseClient().from(HOUR_BANDS_TABLE)));
  // STORY 8.2d: the bands are one snapshot with the organization
  // (`HOUR_BANDS_SURFACE_KEYS`): online, bands older than this session's
  // network are never drawn as fresh; offline, the cached bands are drawn
  // under the as-of note (`offline`), or the unavailable state is. THE NOTE'S
  // ZONE is the organization's, read from the cache — the rows carry none,
  // and a second `useQuery` here would be a second read on this screen.
  const timeZone = hourBandsTimeZoneOf(
    queryClient.getQueryData<OrganizationOutcome>(ORGANIZATION_SNAPSHOT_KEY),
  );
  const { freshness, clock, answerOf } = useSnapshotFreshness(
    HOUR_BANDS_SURFACE_KEYS,
    [[HOUR_BANDS_LIST_KEY, answerRead]],
    zoneFromReads(timeZone),
  );
  const answer = answerOf(answerRead);

  const state = hourBandsSurfaceStateOf(answer);
  const { bands, loading } = state;
  // THE LIST'S NOTICE: the refusal, or the unavailable message beside rows a
  // refetch paused offline over, which is never a refusal (an edit form keeps
  // them). Under the freshness (story 8.2d) a paused refetch is never seen.
  const refusal = hourBandsNoticeOf(state);
  // NO READ RETRY OFFLINE (story 8.2d, decision 2a): `retryable` means "show
  // the read retry now" (story 8.2e) — the read's message is up, and the
  // connection is: offline the message stays without its retry, and the
  // retry comes back with the connection.
  const retryable = clock.online && refusal !== null;
  // STORY 8.2d: the as-of note, while the cached bands are drawn offline.
  const offline = offlineNoteOf(freshness, timeZone, refusal !== null);
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
    // STORY 8.3b: offline, nothing is sent — the component's gate is not the only guard.
    if (!writesOnline()) return;

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
      if (!outcome.ok && droppedOffline(outcome.code, HOUR_BAND_WRITE_UNAVAILABLE)) {
        name.focus();

        return;
      }

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
        // The list, and the calendar snapshot *Sati* derives hours from (story 4.1b).
        await refreshAfterWrite(queryClient, HOUR_BANDS_LIST_KEY, HOUR_BAND_WRITE_DEPENDENTS);
      } catch (cause) {
        console.error(HOUR_BAND_WRITE_UNAVAILABLE, cause);
      }
    } catch (cause) {
      console.error(HOUR_BAND_WRITE_UNAVAILABLE, cause);
      // STORY 8.3b: offline now, the gate's note says why, not the write refusal.
      if (!writesOnline()) {
        name.focus();

        return;
      }
      setFailure(HOUR_BAND_WRITE_UNAVAILABLE);
    } finally {
      creating.current = false;
      setPending(false);
    }
  }

  /** Read the list again, from the unavailable notice's retry. */
  function retry(): void {
    void retryRead(queryClient, HOUR_BANDS_LIST_KEY);
  }

  return {
    retry,
    retryable,
    offline,
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
