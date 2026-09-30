import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import {
  CALENDAR_READ_TABLE,
  calendarQueryOptions,
  calendarSurfaceStateOf,
  type CalendarMembersRpc,
} from '@/features/calendar/services/snapshot';
import { calendarTodayOf } from '@/features/calendar/utils/month';
import { hoursSearchTo, myHoursSurfaceOf, type HoursSearch } from '@/features/hours/services/my-hours';
import { supabaseClient } from '@/lib/supabase/client';

/**
 * *Sati*'s state and its one read (story 4.1b). `search` is the route's
 * search; `go` navigates to another one.
 *
 * THE CALENDAR'S ONE READ (AD-13), under `CALENDAR_KEY` through its own query
 * options: the snapshot carries the hour bands, so there is no second query.
 * Every rule is `@/features/hours/services/my-hours`'s, which the node suite
 * executes; this hook holds wiring only.
 */
export function useMyHours(search: HoursSearch, go: (next: HoursSearch) => void) {
  const answer = useQuery(
    calendarQueryOptions(
      () => supabaseClient().from(CALENDAR_READ_TABLE),
      // As the calendar's: the client's `rpc` is wider than the calls made.
      () => supabaseClient() as unknown as CalendarMembersRpc,
    ),
  );
  const { snapshot, refusal, loading } = calendarSurfaceStateOf(answer);
  const today = snapshot === null ? null : calendarTodayOf(snapshot, new Date());
  const mjesec = search.mjesec;
  // Worked out once per snapshot, month and day, not on every render.
  const surface = useMemo(
    () => myHoursSurfaceOf({ snapshot, refusal, loading }, { mjesec }, today),
    [snapshot, refusal, loading, mjesec, today],
  );

  function show(next: string | null): void {
    go(hoursSearchTo(next));
  }

  return { ...surface, show };
}
