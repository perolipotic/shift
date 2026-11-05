import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { calendarSnapshotQueryOptions } from '@/features/calendar/hooks/use-calendar-snapshot';
import { builderCalendarOf, cancelShortStaffedOf } from '@/features/rotation/services/erasures';
import type { RotationSnapshot } from '@/features/rotation/services/list';
import { useStaffingLeave } from '@/features/staffing/hooks/use-staffing-leave';
import type { ShortStaffedReport } from '@/features/staffing/services/short-staffed';

/**
 * EPIC 11 RETRO A7: what cancelling the scheduled change would newly leave
 * short of people, over the cancel's erasure "after". Wiring only: every
 * decision is `cancelShortStaffedOf`'s — `null` until the calendar snapshot,
 * which holds Minimum Members, is in.
 *
 * TWO OBSERVED READS, NEITHER THE BUILDER'S OWN. The calendar snapshot under
 * its one key (`CALENDAR_KEY`), only while the cancel's confirmation is shown
 * (`scheduled` is then its date); the organization's leave under its shared
 * key, only while the minimum is set too (`useStaffingLeave`). A preview from
 * the cache, never a gate: the cancel's own erasure check reads afresh.
 */
export function useCancelShortStaffed(
  /** The date of the change whose cancel confirmation is shown, or `null` while none is. */
  scheduled: string | null,
  rotation: RotationSnapshot | null,
): ShortStaffedReport | null {
  const shown = scheduled !== null;
  const { isError, data } = useQuery({ ...calendarSnapshotQueryOptions(), enabled: shown });
  const leave = useStaffingLeave(builderCalendarOf(shown, { isError, data }));

  // A year of shifts: worked out only when the date, a read or the rotation changes.
  return useMemo(
    () => cancelShortStaffedOf({ isError, data }, rotation, scheduled, leave),
    [isError, data, rotation, scheduled, leave],
  );
}
