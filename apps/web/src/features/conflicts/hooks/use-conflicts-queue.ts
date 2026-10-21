import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';

import { useCalendarSnapshot } from '@/features/calendar/hooks/use-calendar-snapshot';
import { useSnapshotSkewRefresh } from '@/features/calendar/hooks/use-snapshot-skew-refresh';
import { CALENDAR_FETCH_FETCHING, CALENDAR_KEY, calendarSurfaceStateOf } from '@/features/calendar/services/snapshot';
import { snapshotSkewOf } from '@/features/calendar/services/snapshot-skew';
import { useReplacementLinkRefresh } from '@/features/conflicts/hooks/use-replacement-link-refresh';
import { CONFLICTS_LOADING, CONFLICTS_UNAVAILABLE, conflictsQueueOf } from '@/features/conflicts/services/conflicts-queue';
import {
  resolutionSavedOf,
  resolutionSavedStepOf,
  withoutResolutionSaved,
  type ResolutionSaved,
} from '@/features/conflicts/services/resolution-screen';
import {
  ACTING_ADMINS_KEY,
  ACTING_ADMINS_TABLE,
  RESOLVED_UNAVAILABLE,
  TAB_RESOLVED,
  TAB_UNRESOLVED,
  actingAdminsQueryOptions,
  resolvedConflictsOf,
  type ActingAdminsTable,
  type ConflictsTab,
} from '@/features/conflicts/services/resolved-conflicts';
import {
  CONFLICT_RESOLUTIONS_TABLE,
  ORGANIZATION_CONFLICT_RESOLUTIONS_KEY,
  organizationConflictResolutionsQueryOptions,
  type OrganizationConflictResolutionsTable,
} from '@/features/conflicts/services/resolutions';
import { rasporedSurfaceKeysOf } from '@/features/conflicts/services/surface-keys';
import {
  LEAVE_RECORDS_TABLE,
  ORGANIZATION_LEAVE_RECORDS_KEY,
  organizationLeaveRecordsQueryOptions,
  type OrganizationLeaveRecordsTable,
} from '@/features/leave/services/leave-list';
import { useOrganizationToday } from '@/hooks/organization-today';
import { ZONE_FROM_CALENDAR, offlineNoteOf } from '@/lib/offline/freshness';
import { useSnapshotFreshness } from '@/lib/offline/use-snapshot-freshness';
import { supabaseClient } from '@/lib/supabase/client';

/**
 * *Raspored*'s three reads and its state (stories 5.3b, 5.4a). Wiring only —
 * every decision is `@/features/conflicts/services/conflicts-queue`'s, which
 * the node suite executes.
 *
 * THE READS, each under its own key (AD-13): the calendar snapshot, shared
 * with the screens that own it, the organization's live leave records, and
 * its live conflict resolutions. A schedule write re-reads the first, and
 * every leave write names the other two among its dependents, so a conflict
 * appears or clears without a reload. Nothing is written, and no conflict set
 * is kept: the queue is derived from the three answers on every render.
 *
 * THE STATUS LINE (story 5.4b). A decision that landed returns here with what
 * it saved in ROUTER STATE — never the URL, never storage. It is derived per
 * location (`resolutionSavedStepOf`): the location that brings it shows it
 * and clears it off the entry through the router, so a reload or Back to the
 * entry later finds none; any other navigation, the Raspored tab's included,
 * drops it. Focus moves to it once drawn, so it is announced.
 *
 * THE TABS (story 7.16): *Neriješeni* is the default. The *Riješeni* tab reads
 * the same three answers and, once opened, the names of whoever decided
 * (`resolvedConflictsOf`); nothing is written.
 */
export function useConflictsQueue() {
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
  const [tab, setTab] = useState<ConflictsTab>(TAB_UNRESOLVED);
  const [saved, setSaved] = useState<ResolutionSaved | null>(() => resolutionSavedOf(location.state));
  /** Whether the next location is our own clearing replace. */
  const clearing = useRef(false);
  /** The location state already stepped over: an effect run twice steps once. */
  const stepped = useRef<unknown>(undefined);
  /** The status line, which takes focus once drawn. */
  const savedField = useRef<HTMLParagraphElement>(null);
  const state = location.state;

  useEffect(() => {
    if (stepped.current === state) return;

    stepped.current = state;

    const step = resolutionSavedStepOf(saved, state, clearing.current);

    clearing.current = step.clearing;
    setSaved(step.shown);
    if (step.clear) {
      void navigate({ to: '/raspored', replace: true, state: (entry) => withoutResolutionSaved(entry) });
    }
    // The line's own state is read, never followed: `stepped` lets only a new
    // location step, so a change of `saved` alone returns at the guard.
  }, [state, saved, navigate]);

  useEffect(() => {
    if (saved !== null) savedField.current?.focus();
  }, [saved]);

  const calendarRead = useCalendarSnapshot();
  const recordsRead = useQuery(
    // Named structurally, as the member card's read is.
    organizationLeaveRecordsQueryOptions(
      () => supabaseClient().from(LEAVE_RECORDS_TABLE) as unknown as OrganizationLeaveRecordsTable,
    ),
  );

  const resolutionsRead = useQuery(
    organizationConflictResolutionsQueryOptions(
      () => supabaseClient().from(CONFLICT_RESOLUTIONS_TABLE) as unknown as OrganizationConflictResolutionsTable,
    ),
  );

  // THE *RIJEŠENI* TAB (story 7.16) reads the same three, plus the names of
  // whoever decided, and only once the tab is open.
  const actorsRead = useQuery(
    actingAdminsQueryOptions(
      () => supabaseClient().from(ACTING_ADMINS_TABLE) as unknown as ActingAdminsTable,
      tab === TAB_RESOLVED,
    ),
  );

  // STORY 8.2c: the queue is one snapshot, decided from these very observer
  // results over the open tab's keys (`rasporedSurfaceKeysOf`): online, a read
  // older than this session's network is never drawn as fresh; offline, the
  // whole cached snapshot is drawn under the as-of note (`offline`), or the
  // unavailable state is. The names join the keys on *Riješeni* alone, so on
  // *Neriješeni* they pass raw (`answerFor`) and never decide the queue.
  const { freshness, answerOf, answerFor } = useSnapshotFreshness(
    rasporedSurfaceKeysOf(tab),
    [
      [CALENDAR_KEY, calendarRead],
      [ORGANIZATION_LEAVE_RECORDS_KEY, recordsRead],
      [ORGANIZATION_CONFLICT_RESOLUTIONS_KEY, resolutionsRead],
      [ACTING_ADMINS_KEY, actorsRead],
    ],
    ZONE_FROM_CALENDAR,
  );
  const calendar = answerOf(calendarRead);
  const records = answerOf(recordsRead);
  const resolutions = answerOf(resolutionsRead);
  const actors = answerFor(ACTING_ADMINS_KEY, actorsRead);

  const calendarState = calendarSurfaceStateOf(calendar);

  // STORY 5.5d: a replacement naming an override the snapshot does not hold yet re-reads it once.
  useReplacementLinkRefresh(calendarState.snapshot, resolutions.data);

  // FROM THE RAW OBSERVER (story 8.2c, the fetch-flag rule in
  // `@/lib/offline/use-snapshot-freshness`): a skew waits as loading while the
  // snapshot is really being read again — a reconnect's refetch included —
  // and offline, where the read is paused, it is the unavailable state.
  const snapshotFetching = calendarRead.fetchStatus === CALENDAR_FETCH_FETCHING;
  const resolved = resolvedConflictsOf({ calendar: calendarState, records, resolutions, actors, snapshotFetching });

  // A leave or resolution row naming a member or team the snapshot does not hold yet re-reads it once.
  useSnapshotSkewRefresh(snapshotSkewOf(calendarState.snapshot, records.data, resolutions.data));

  // The organization's today, moved at its midnight: a queue left open overnight drops yesterday's conflicts.
  const { now } = useOrganizationToday(calendarState.snapshot === null ? null : calendarState.snapshot.timeZone);
  const queue = conflictsQueueOf({ calendar: calendarState, records, resolutions, snapshotFetching }, now);
  // STORY 8.2c: the as-of note's time and zone — the calendar snapshot's —
  // while the whole cached snapshot is drawn offline, under the heading on
  // both tabs; none above the open tab's unavailable state, where nothing is drawn.
  const offline = offlineNoteOf(
    freshness,
    calendarState.snapshot === null ? null : calendarState.snapshot.timeZone,
    tab === TAB_RESOLVED ? resolved.kind === RESOLVED_UNAVAILABLE : queue.kind === CONFLICTS_UNAVAILABLE,
  );

  /** Read again every read the queue stands on, from the unavailable alert's retry. */
  function retry(): void {
    for (const queryKey of [CALENDAR_KEY, ORGANIZATION_LEAVE_RECORDS_KEY, ORGANIZATION_CONFLICT_RESOLUTIONS_KEY, ACTING_ADMINS_KEY]) {
      void queryClient.invalidateQueries({ queryKey });
    }
  }

  return { queue, resolved, tab, setTab, saved, savedField, loading: queue.kind === CONFLICTS_LOADING, retry, offline };
}
