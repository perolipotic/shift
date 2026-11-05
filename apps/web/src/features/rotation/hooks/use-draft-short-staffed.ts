import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { calendarSnapshotQueryOptions } from '@/features/calendar/hooks/use-calendar-snapshot';
import { builderCalendarOf, builderShortStaffedOf } from '@/features/rotation/services/erasures';
import type { RotationSnapshot } from '@/features/rotation/services/list';
import type { RotationDraft } from '@/features/rotation/utils/draft';
import { useStaffingLeave } from '@/features/staffing/hooks/use-staffing-leave';
import type { ShortStaffedReport } from '@/features/staffing/services/short-staffed';

/**
 * STORY 11.2: what saving the builder's draft would newly leave short of
 * people, over the erasure check's own "after". Wiring only: every decision
 * is `builderShortStaffedOf`'s (Epic 11 retro A2, R1) — `null` until the
 * calendar snapshot, which holds Minimum Members, is in.
 *
 * TWO OBSERVED READS, NEITHER THE BUILDER'S OWN. The calendar snapshot under
 * its one key (`CALENDAR_KEY`), only while there is a draft to save
 * (`unsaved`); the organization's leave under its shared key, only while the
 * minimum is set too (`useStaffingLeave`). A preview from the cache, never a
 * gate: the save's own erasure check reads afresh, as it always did.
 */
export function useDraftShortStaffed(
  unsaved: boolean,
  rotation: RotationSnapshot | null,
  draft: RotationDraft | null,
  today: string | null,
): ShortStaffedReport | null {
  const { isError, data } = useQuery({ ...calendarSnapshotQueryOptions(), enabled: unsaved });
  const leave = useStaffingLeave(builderCalendarOf(unsaved, { isError, data }));

  // `draft` is the builder's memoized draft, so the report — a year of shifts —
  // is worked out only when the draft, a read or today changes.
  return useMemo(
    () => builderShortStaffedOf(unsaved, { isError, data }, rotation, draft, today, leave),
    [unsaved, isError, data, rotation, draft, today, leave],
  );
}
