import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import {
  CALENDAR_READ_TABLE,
  calendarQueryOptions,
  calendarSurfaceStateOf,
  type CalendarMembersRpc,
} from '@/features/calendar/services/snapshot';
import { calendarTodayOf } from '@/features/calendar/utils/month';
import {
  hoursSearchTo,
  type HoursSearch,
  type HoursSearchChange,
  type HoursSortKey,
} from '@/features/hours/services/my-hours';
import {
  hoursSearchBaseOf,
  hoursSortChangeOf,
  hoursSurfaceOf,
  nextHoursSort,
} from '@/features/hours/services/organization-hours';
import { supabaseClient } from '@/lib/supabase/client';

/**
 * *Sati*'s state and its one read: the viewer's own month for a member
 * (story 4.1b), every member's for an admin (story 4.2). `search` is the
 * route's search; `go` navigates to another one. A member's month
 * navigation writes the month alone (`hoursSearchBaseOf`); an admin's keeps
 * the table's team, person and sort.
 *
 * THE CALENDAR'S ONE READ (AD-13), under `CALENDAR_KEY` through its own query
 * options: the snapshot carries the hour bands and every member, so there is
 * no second query. Every rule is `@/features/hours/services/my-hours`'s or
 * `@/features/hours/services/organization-hours`'s, which the node suite
 * executes; this hook holds wiring only.
 */
export function useHours(search: HoursSearch, go: (next: HoursSearch) => void) {
  const answer = useQuery(
    calendarQueryOptions(
      () => supabaseClient().from(CALENDAR_READ_TABLE),
      // As the calendar's: the client's `rpc` is wider than the calls made.
      () => supabaseClient() as unknown as CalendarMembersRpc,
    ),
  );
  const { snapshot, refusal, loading } = calendarSurfaceStateOf(answer);
  const today = snapshot === null ? null : calendarTodayOf(snapshot, new Date());
  const { mjesec, tim, osoba, sort, smjer } = search;
  // Worked out once per snapshot, search and day, not on every render.
  const surface = useMemo(
    () => hoursSurfaceOf({ snapshot, refusal, loading }, { mjesec, tim, osoba, sort, smjer }, today),
    [snapshot, refusal, loading, mjesec, tim, osoba, sort, smjer, today],
  );
  // What every change starts from: the table's own search for an admin, the month alone for a member.
  const base = hoursSearchBaseOf(surface.organization, search);

  function change(next: HoursSearchChange): void {
    go(hoursSearchTo(base, next));
  }

  function show(next: string | null): void {
    change({ mjesec: next });
  }

  function pressColumn(key: HoursSortKey): void {
    // Only the table has headings to press.
    if (surface.organization === null) return;

    change(hoursSortChangeOf(nextHoursSort(surface.organization.sort, key)));
  }

  // The export's file name carries it (story 4.3): the same row, the same read.
  const organizationName = snapshot === null ? null : snapshot.organizationName;

  return { ...surface, organizationName, show, change, pressColumn };
}
