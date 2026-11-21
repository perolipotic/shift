import { useCalendarSnapshot } from '@/features/calendar/hooks/use-calendar-snapshot';
import { loanTeamsNowOf } from '@/features/calendar/utils/loan-marks';

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

  // Derived on every render, never memoized on the snapshot alone, so a page
  // left open past midnight reads the new day's loans on its next render.
  return loanTeamsNowOf(snapshot, new Date());
}
