import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import { readsOrganizationLeave } from '@/features/calendar/services/marks';
import {
  CALENDAR_KEY,
  CALENDAR_READ_TABLE,
  calendarQueryOptions,
  type CalendarMembersRpc,
} from '@/features/calendar/services/snapshot';
import { calendarTodayOf } from '@/features/calendar/utils/month';
import { hoursConflictsStateOf } from '@/features/hours/services/hours-conflicts';
import {
  hoursSearchTo,
  hoursSnapshotStateOf,
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
import {
  LEAVE_RECORDS_TABLE,
  MY_LEAVE_RECORDS_KEY,
  ORGANIZATION_LEAVE_RECORDS_KEY,
  myLeaveRecordsQueryOptions,
  organizationLeaveRecordsQueryOptions,
  type MyLeaveRecordsRpc,
  type OrganizationLeaveRecordsTable,
} from '@/features/leave/services/leave-list';
import { supabaseClient } from '@/lib/supabase/client';

/**
 * *Sati*'s state and its one read: the viewer's own month for a member
 * (story 4.1b), every member's for an admin (story 4.2). `search` is the
 * route's search; `go` navigates to another one. A member's month
 * navigation writes the month alone (`hoursSearchBaseOf`); an admin's keeps
 * the table's team, person and sort.
 *
 * THE CALENDAR'S ONE READ (AD-13), under `CALENDAR_KEY` through its own query
 * options: the snapshot carries the hour bands and every member. Every rule
 * is `@/features/hours/services/my-hours`'s,
 * `@/features/hours/services/organization-hours`'s or
 * `@/features/hours/services/hours-conflicts`'s, which the node suite
 * executes; this hook holds wiring only.
 *
 * THE LEAVE IS THE SECOND (story 5.3d), as the calendar's marks read it, by
 * the viewer's role once the snapshot names it: an admin reads the
 * organization's live leave under `ORGANIZATION_LEAVE_RECORDS_KEY`, a member
 * their own under `MY_LEAVE_RECORDS_KEY` — never both. Every leave write
 * names both keys among its dependents, so the conflict count follows without
 * a reload. *Sati* waits for both reads, and a failed leave read is its
 * unavailable state with its retry.
 */
export function useHours(search: HoursSearch, go: (next: HoursSearch) => void) {
  const answer = useQuery(
    calendarQueryOptions(
      () => supabaseClient().from(CALENDAR_READ_TABLE),
      // As the calendar's: the client's `rpc` is wider than the calls made.
      () => supabaseClient() as unknown as CalendarMembersRpc,
    ),
  );
  const { snapshot, refusal, loading } = hoursSnapshotStateOf(answer);
  const role = snapshot === null ? null : snapshot.viewer.role;
  const organizationLeave = useQuery({
    // Named structurally, as the calendar's marks read it.
    ...organizationLeaveRecordsQueryOptions(
      () => supabaseClient().from(LEAVE_RECORDS_TABLE) as unknown as OrganizationLeaveRecordsTable,
    ),
    enabled: role !== null && readsOrganizationLeave(role),
  });
  const ownLeave = useQuery({
    // Named structurally, as *Godišnji*'s read is.
    ...myLeaveRecordsQueryOptions(() => supabaseClient() as unknown as MyLeaveRecordsRpc),
    enabled: role !== null && !readsOrganizationLeave(role),
  });
  const leaveAnswer = role !== null && readsOrganizationLeave(role) ? organizationLeave : ownLeave;
  const leaveData = leaveAnswer.data;
  const leaveIsError = leaveAnswer.isError;
  const leaveIsPending = leaveAnswer.isPending;
  const leaveFetchStatus = leaveAnswer.fetchStatus;
  // Derived once per answer, not on every render: the collisions walk every record.
  const conflicts = useMemo(
    () =>
      snapshot === null
        ? null
        : hoursConflictsStateOf(snapshot, {
            data: leaveData,
            isError: leaveIsError,
            isPending: leaveIsPending,
            fetchStatus: leaveFetchStatus,
          }),
    [snapshot, leaveData, leaveIsError, leaveIsPending, leaveFetchStatus],
  );
  const today = snapshot === null ? null : calendarTodayOf(snapshot, new Date());
  const { mjesec, tim, osoba, sort, smjer } = search;
  // Worked out once per snapshot, leave, search and day, not on every render.
  const surface = useMemo(
    () => hoursSurfaceOf({ snapshot, refusal, loading }, conflicts, { mjesec, tim, osoba, sort, smjer }, today),
    [snapshot, refusal, loading, conflicts, mjesec, tim, osoba, sort, smjer, today],
  );
  const client = useQueryClient();

  /** Read again both reads *Sati* stands on, from the unavailable message's retry (`retryable` alone). */
  function retry(): void {
    for (const queryKey of [CALENDAR_KEY, ORGANIZATION_LEAVE_RECORDS_KEY, MY_LEAVE_RECORDS_KEY]) {
      // A read already in flight is left to land: repeated presses never restart it.
      void client.invalidateQueries({ queryKey }, { cancelRefetch: false });
    }
  }
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

  return { ...surface, organizationName, retry, show, change, pressColumn };
}
