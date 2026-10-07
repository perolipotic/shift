import type { ReactNode } from 'react';

import { FilterBar } from '@/components/filter-bar';
import { calendarFilterBarOf } from '@/features/calendar/utils/filters';
import type { CalendarFilterChange, CalendarMonth } from '@/features/calendar/utils/month';

/**
 * THE FILTERS of *Sve smjene* (story 7.5): the shared filter bar under the
 * month toolbar, Smjena and Osoba as chips, the summary line and one
 * `Poništi filtre`. Which team or person is chosen — an unknown or archived
 * id being none — is `calendarMonthOf`'s decision, and the bar's model is
 * `calendarFilterBarOf`'s: a person replaces the team (story 3.3b). The state
 * lives in the URL alone. Nothing is drawn while the month offers no team
 * and nobody.
 */
export function CalendarFilters({
  shown,
  onFilter,
}: {
  readonly shown: CalendarMonth;
  readonly onFilter: (change: CalendarFilterChange) => void;
}): ReactNode {
  if (shown.filter.teams.length === 0 && shown.filter.people.length === 0) return null;

  return <FilterBar model={calendarFilterBarOf(shown)} onChange={onFilter} />;
}
