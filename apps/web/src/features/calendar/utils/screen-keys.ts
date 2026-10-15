import { NOTHING_CHOSEN as NONE, type CalendarMonth } from '@/features/calendar/utils/month';

/**
 * What the grid's one tab stop is FORGOTTEN on: the month shown, the team
 * chosen (story 3.3a) and the person chosen (story 3.3b), however they changed
 * — the buttons, the filter, the URL or history. `null` while no month is
 * shown.
 */
export function gridFocusKeyOf(month: CalendarMonth | null): string | null {
  return month === null
    ? null
    : `${month.month}|${month.filter.chosen ?? NONE}|${month.filter.person ?? NONE}`;
}
