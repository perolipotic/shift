import type { ReactNode, RefObject } from 'react';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import {
  ALL_TEAMS_FILTER,
  calendarFilterChangeOf,
  personFilterValueOf,
  type CalendarFilterChange,
  type CalendarMonth,
} from '@/features/calendar/utils/month';
import { t } from '@/lib/i18n';

/**
 * THE FILTER of *Sve smjene*: a native `Select`, as on `/ljudi`, whose value
 * is the team the grid IS narrowed to (story 3.3a) or the person shown
 * (story 3.3b) — so an unknown id reads as every team rather than claiming a
 * filter the screen ignores. The first option counts the active teams
 * (UX-DR19); the teams sit under *Smjene* and the people under *Osobe*,
 * their names data. The reset shows only while a team or a person is
 * chosen, and keeps the viewer on `/kalendar`.
 *
 * Which team is chosen — an unknown or archived id being none — is
 * `calendarMonthOf`'s decision; the state lives in the URL alone. The people
 * offered are every member active on the organization's today: they come from
 * `calendar_members()` (story 3.4a), active or not, and which of them are
 * active today is `calendarMonthOf`'s decision, through `activeOn`.
 */
export function CalendarFilter({
  shown,
  filterRef,
  onFilter,
  onReset,
}: {
  readonly shown: CalendarMonth;
  readonly filterRef: RefObject<HTMLSelectElement | null>;
  readonly onFilter: (change: CalendarFilterChange) => void;
  readonly onReset: () => void;
}): ReactNode {
  if (shown.filter.teams.length === 0 && shown.filter.people.length === 0) return null;

  const value =
    shown.filter.person !== null
      ? personFilterValueOf(shown.filter.person)
      : (shown.filter.chosen ?? ALL_TEAMS_FILTER);

  return (
    <div className="flex min-w-0 flex-wrap items-end gap-3 px-4 pb-4">
      <div className="grid w-full min-w-0 gap-2 sm:w-64">
        <Label htmlFor="kalendar-filter">{t('kalendar.filter.label')}</Label>
        <Select
          id="kalendar-filter"
          ref={filterRef}
          className="h-11"
          value={value}
          onChange={(event) => {
            onFilter(calendarFilterChangeOf(event.target.value));
          }}
        >
          <option value={ALL_TEAMS_FILTER}>{t('kalendar.filter.all', { count: shown.filter.teams.length })}</option>
          {shown.filter.teams.length === 0 ? null : (
            <optgroup label={t('kalendar.filter.group')}>
              {shown.filter.teams.map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </optgroup>
          )}
          {shown.filter.people.length === 0 ? null : (
            <optgroup label={t('kalendar.filter.people')}>
              {shown.filter.people.map((person) => (
                <option key={person.id} value={personFilterValueOf(person.id)}>
                  {person.name}
                </option>
              ))}
            </optgroup>
          )}
        </Select>
      </div>
      {shown.filter.chosen === null && shown.filter.person === null ? null : (
        <Button
          type="button"
          variant="outline"
          className="h-11"
          onClick={() => {
            onReset();
          }}
        >
          {t('kalendar.filter.reset')}
        </Button>
      )}
    </div>
  );
}
