import { useQuery } from '@tanstack/react-query';

import {
  CALENDAR_READ_TABLE,
  calendarQueryOptions,
  type CalendarMembersRpc,
} from '@/features/calendar/services/snapshot';
import { supabaseClient } from '@/lib/supabase/client';

/**
 * THE CALENDAR SNAPSHOT'S ONE BINDING (deferred work from 7.13c): its query
 * options over the app's client, under `CALENDAR_KEY`. Every screen that
 * reads the snapshot — the calendar, *Danas*, *Za odluku*, *Sati*,
 * *Godišnji*, the member page and the erasure guard's fresh reads — takes it
 * from here, so "the same key, no extra request" holds by construction
 * rather than by each hook copying the same two lambdas.
 */
export function calendarSnapshotQueryOptions() {
  return calendarQueryOptions(
    () => supabaseClient().from(CALENDAR_READ_TABLE),
    // The precedent of `smjene.$id.tsx`: the client's `rpc` is wider than the
    // one call the calendar makes.
    () => supabaseClient() as unknown as CalendarMembersRpc,
  );
}

/** The calendar snapshot, observed through {@link calendarSnapshotQueryOptions}. */
export function useCalendarSnapshot() {
  return useQuery(calendarSnapshotQueryOptions());
}
