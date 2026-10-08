import { NOTHING_CHOSEN as NONE, type CalendarMode, type CalendarMonth } from '@/features/calendar/utils/month';

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

/**
 * What an open day detail (story 3.4b) CLOSES on: the grid's key and the mode.
 * Any change closes it — browser Back while it is open included.
 */
export function dayDetailKeyOf(gridKey: string | null, mode: CalendarMode | null): string {
  return `${gridKey ?? NONE}|${mode ?? NONE}`;
}
