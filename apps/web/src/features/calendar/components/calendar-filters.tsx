import type { ReactNode } from 'react';

import { FilterBar, activeFilterSummaryOf } from '@/components/filter-bar';
import { calendarFilterBarOf } from '@/features/calendar/utils/filters';
import type { CalendarFilterChange, CalendarMonth } from '@/features/calendar/utils/month';
import { t } from '@/lib/i18n';
import { filterSummaryMessageKey, filterSummaryValuesOf } from '@/utils/filter-bar';

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

/** The active filters of *Sve smjene* as one line, or `null` with none on: the phone's sticky head repeats it (deferred-work E816). */
export function calendarFilterSummaryOf(shown: CalendarMonth): string | null {
  return activeFilterSummaryOf(calendarFilterBarOf(shown));
}

/**
 * STORY 16.1 (UX-DR56): what *Sve smjene* shows, in words, for the printed
 * month's header — the summary line the bar itself shows, with no filter on
 * too (`Prikazano: sve smjene (4) · 17 osoba`), so the paper says what the
 * screen said.
 */
export function calendarFilterWordsOf(shown: CalendarMonth): string {
  const { summary } = calendarFilterBarOf(shown);

  return t(filterSummaryMessageKey(summary), filterSummaryValuesOf(summary));
}
