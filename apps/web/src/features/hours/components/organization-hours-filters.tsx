import type { ReactNode } from 'react';

import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import type { HoursSearchChange } from '@/features/hours/services/my-hours';
import {
  ALL_FILTER,
  hoursPersonChangeOf,
  hoursTeamChangeOf,
  type OrganizationHoursView,
} from '@/features/hours/services/organization-hours';
import { t } from '@/lib/i18n';

/**
 * The organization table's two filters (story 4.2): a native `Select` of the
 * teams some row names and one of the members with a row, "all" first in
 * each. They combine. Which team or person is chosen — a stale id being none
 * — is `organizationHoursViewOf`'s decision; the state lives in the URL alone.
 */
export function OrganizationHoursFilters({
  view,
  onChange,
}: {
  readonly view: OrganizationHoursView;
  readonly onChange: (change: HoursSearchChange) => void;
}): ReactNode {
  return (
    <div className="grid min-w-0 gap-3 px-4 pb-4 sm:grid-cols-2 lg:max-w-xl">
      <div className="grid min-w-0 gap-2">
        <Label htmlFor="sati-team-filter">{t('sati.organization.teamFilter')}</Label>
        <Select
          id="sati-team-filter"
          className="h-11"
          value={view.team ?? ALL_FILTER}
          onChange={(event) => {
            onChange(hoursTeamChangeOf(event.target.value));
          }}
        >
          <option value={ALL_FILTER}>{t('sati.organization.allTeams')}</option>
          {view.teams.map((team) => (
            <option key={team.id} value={team.id}>
              {team.name}
            </option>
          ))}
        </Select>
      </div>
      <div className="grid min-w-0 gap-2">
        <Label htmlFor="sati-person-filter">{t('sati.organization.personFilter')}</Label>
        <Select
          id="sati-person-filter"
          className="h-11"
          value={view.person ?? ALL_FILTER}
          onChange={(event) => {
            onChange(hoursPersonChangeOf(event.target.value));
          }}
        >
          <option value={ALL_FILTER}>{t('sati.organization.allPeople')}</option>
          {view.people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
            </option>
          ))}
        </Select>
      </div>
    </div>
  );
}
