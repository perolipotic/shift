import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { calendarSnapshotQueryOptions } from '@/features/calendar/hooks/use-calendar-snapshot';
import { draftShortStaffedOf } from '@/features/rotation/services/erasures';
import type { RotationSnapshot } from '@/features/rotation/services/list';
import type { RotationDraft } from '@/features/rotation/utils/draft';
import { useStaffingLeave } from '@/features/staffing/hooks/use-staffing-leave';
import { SHORT_STAFFED_UNKNOWN_REPORT, type ShortStaffedReport } from '@/features/staffing/services/short-staffed';

/**
 * STORY 11.2: what saving the builder's draft would newly leave short of
 * people, over the erasure check's own "after" (`draftShortStaffedOf`).
 * Wiring only.
 *
 * TWO OBSERVED READS, NEITHER THE BUILDER'S OWN. The calendar snapshot — which
 * holds Minimum Members — under its one key (`CALENDAR_KEY`), only while
 * there is a draft to save (`unsaved`); the organization's leave under its
 * shared key, only while the minimum is set too (`useStaffingLeave`). A
 * preview from the cache, never a gate: the save's own erasure check reads
 * afresh, as it always did.
 */
export function useDraftShortStaffed(
  unsaved: boolean,
  rotation: RotationSnapshot | null,
  draft: RotationDraft | null,
  today: string | null,
): ShortStaffedReport | null {
  const calendarRead = useQuery({ ...calendarSnapshotQueryOptions(), enabled: unsaved });
  const calendar = unsaved && !calendarRead.isError ? (calendarRead.data ?? null) : null;
  // A DRAFT TO SAVE WHOSE CALENDAR IS NOT IN — pending or failed — cannot be
  // checked now: the neutral line, never silence (the read logs its own failure).
  const calendarMissing = unsaved && calendar === null;
  const leave = useStaffingLeave(calendar);

  // `draft` is the builder's memoized draft, so the report — a year of shifts —
  // is worked out only when the draft, a read or today changes.
  return useMemo(() => {
    if (!unsaved || draft === null) return null;
    if (calendarMissing) return SHORT_STAFFED_UNKNOWN_REPORT;

    return draftShortStaffedOf(calendar, rotation, draft, today, leave);
  }, [unsaved, calendarMissing, calendar, rotation, draft, today, leave]);
}
