import type { ReactNode } from 'react';

import { CalendarDays, CalendarPerson } from '@/features/calendar/components/calendar-day-list';
import { CalendarGrid } from '@/features/calendar/components/calendar-grid';
import { CalendarSkeleton } from '@/features/calendar/components/calendar-skeleton';
import type { CalendarScreenState } from '@/features/calendar/hooks/use-calendar-screen';
import { MODE_MOJ } from '@/features/calendar/utils/month';

/**
 * What the month card shows under its heading: the skeleton while no month is
 * shown, in the shape the screen will show, the viewer's day list in *Moj raspored*, and in *Sve smjene* the grid
 * — or, a person chosen (story 3.3b), that person's day list in its place.
 */
export function CalendarMonthBody({ screen }: { readonly screen: CalendarScreenState }): ReactNode {
  const { snapshot, month, mode, skeleton, openDay } = screen;

  if (month === null) {
    return <CalendarSkeleton shape={skeleton} />;
  }

  if (mode === MODE_MOJ) {
    return <CalendarDays snapshot={snapshot} days={month.days} openDay={openDay} />;
  }

  if (month.person === null) {
    return <CalendarGrid shown={month} screen={screen} />;
  }

  return <CalendarPerson snapshot={snapshot} person={month.person} openDay={openDay} />;
}
