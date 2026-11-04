import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import type { CalendarSnapshot } from '@/features/calendar/services/snapshot';
import {
  LEAVE_RECORDS_TABLE,
  organizationLeaveRecordsQueryOptions,
  type OrganizationLeaveRecordsTable,
} from '@/features/leave/services/leave-list';
import { readsStaffingLeaveOf, type StaffingLeaveSource } from '@/features/staffing/services/short-staffed';
import { supabaseClient } from '@/lib/supabase/client';

/**
 * THE ORGANIZATION'S LEAVE, FOR THE SHORT-STAFFED REPORT (story 11.2): wiring
 * only — every decision is `@/features/staffing/services/short-staffed`'s.
 *
 * OBSERVED UNDER ITS SHARED KEY (`ORGANIZATION_LEAVE_RECORDS_KEY`, AD-13),
 * with *Za odluku*'s own query options, so a surface that already reads it
 * (the calendar) adds no request, and one that does not (the member page, a
 * request's decision screen, the rotation builder) reads it once, shared.
 *
 * ONLY WHILE THE MINIMUM IS SET, and only for an admin, whose read is the
 * organization's (`readsStaffingLeaveOf`): with the setting empty nothing more
 * is read, and the answer is `null` — the report is then `null` anyway.
 */
export function useStaffingLeave(calendar: CalendarSnapshot | null): StaffingLeaveSource | null {
  const enabled = readsStaffingLeaveOf(calendar);
  const read = useQuery({
    // Named structurally, as *Za odluku*'s read is.
    ...organizationLeaveRecordsQueryOptions(
      () => supabaseClient().from(LEAVE_RECORDS_TABLE) as unknown as OrganizationLeaveRecordsTable,
    ),
    enabled,
  });
  const { isPending, isError, data } = read;

  return useMemo(() => (enabled ? { isPending, isError, data } : null), [enabled, isPending, isError, data]);
}
