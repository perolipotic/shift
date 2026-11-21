import { useMemo } from 'react';

import { useCalendarSnapshot } from '@/features/calendar/hooks/use-calendar-snapshot';
import { currentLoanTeamsOf } from '@/features/calendar/utils/loan-marks';
import { useOrganizationToday } from '@/hooks/organization-today';

/**
 * STORY 18.5 (UX-DR59): who is on loan TODAY, and with which team, by member
 * id — for `trenutno u timu {tim}` on *Ljudi* (the list and the directory)
 * and on a team's roster. From the calendar snapshot under its one key
 * (`CALENDAR_KEY`), which every member reads and every loan write refreshes,
 * and which holds no loan's reason or author. NO SURFACE WAITS FOR IT: while
 * it is pending or failed the map is empty and the surface draws as before.
 */
export function useLoanTeams(): ReadonlyMap<string, string> {
  const calendarRead = useCalendarSnapshot();
  const snapshot = calendarRead.data ?? null;
  // The organization's today in the snapshot's zone (L8), moved at its
  // midnight by the minute ticker, so a page left open overnight drops
  // yesterday's loans without a reload; the map is rebuilt only when the
  // snapshot or the date changes.
  const { today } = useOrganizationToday(snapshot === null ? null : snapshot.timeZone);

  return useMemo(() => currentLoanTeamsOf(snapshot, today), [snapshot, today]);
}
