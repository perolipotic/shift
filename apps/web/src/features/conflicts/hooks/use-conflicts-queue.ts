import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocation, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';

import {
  CALENDAR_KEY,
  CALENDAR_READ_TABLE,
  calendarQueryOptions,
  calendarSurfaceStateOf,
  type CalendarMembersRpc,
} from '@/features/calendar/services/snapshot';
import { useReplacementLinkRefresh } from '@/features/conflicts/hooks/use-replacement-link-refresh';
import { CONFLICTS_LOADING, conflictsQueueOf } from '@/features/conflicts/services/conflicts-queue';
import {
  resolutionSavedOf,
  resolutionSavedStepOf,
  withoutResolutionSaved,
  type ResolutionSaved,
} from '@/features/conflicts/services/resolution-screen';
import {
  CONFLICT_RESOLUTIONS_TABLE,
  ORGANIZATION_CONFLICT_RESOLUTIONS_KEY,
  organizationConflictResolutionsQueryOptions,
  type OrganizationConflictResolutionsTable,
} from '@/features/conflicts/services/resolutions';
import {
  LEAVE_RECORDS_TABLE,
  ORGANIZATION_LEAVE_RECORDS_KEY,
  organizationLeaveRecordsQueryOptions,
  type OrganizationLeaveRecordsTable,
} from '@/features/leave/services/leave-list';
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
 */
export function useConflictsQueue() {
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();
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
    // The line's own state is read, never followed: only a new location steps.
  }, [state]);

  useEffect(() => {
    if (saved !== null) savedField.current?.focus();
  }, [saved]);

  const calendar = useQuery(
    calendarQueryOptions(
      () => supabaseClient().from(CALENDAR_READ_TABLE),
      // As the calendar's: the client's `rpc` is wider than the calls made.
      () => supabaseClient() as unknown as CalendarMembersRpc,
    ),
  );
  const records = useQuery(
    // Named structurally, as the member card's read is.
    organizationLeaveRecordsQueryOptions(
      () => supabaseClient().from(LEAVE_RECORDS_TABLE) as unknown as OrganizationLeaveRecordsTable,
    ),
  );

  const resolutions = useQuery(
    organizationConflictResolutionsQueryOptions(
      () => supabaseClient().from(CONFLICT_RESOLUTIONS_TABLE) as unknown as OrganizationConflictResolutionsTable,
    ),
  );

  // STORY 5.5d: a replacement naming an override the snapshot does not hold yet re-reads it once.
  useReplacementLinkRefresh(calendarSurfaceStateOf(calendar).snapshot, resolutions.data);

  const queue = conflictsQueueOf({ calendar: calendarSurfaceStateOf(calendar), records, resolutions }, new Date());

  /** Read again every read the queue stands on, from the unavailable alert's retry. */
  function retry(): void {
    for (const queryKey of [CALENDAR_KEY, ORGANIZATION_LEAVE_RECORDS_KEY, ORGANIZATION_CONFLICT_RESOLUTIONS_KEY]) {
      void queryClient.invalidateQueries({ queryKey });
    }
  }

  return { queue, saved, savedField, loading: queue.kind === CONFLICTS_LOADING, retry };
}
