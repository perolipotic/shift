import type { ReactNode, RefObject } from 'react';

import type { FilterBarHandle } from '@/components/filter-bar';
import { Button } from '@/components/ui/button';
import type { HoursSearchChange } from '@/features/hours/services/my-hours';
import {
  HOURS_EMPTY_MONTH,
  HOURS_EMPTY_NOT_IN_TEAM,
  hoursEmptyFactMessageKey,
  hoursEmptyMessageKey,
  type HoursEmpty,
  type OrganizationHoursView,
} from '@/features/hours/services/organization-hours';
import { t } from '@/lib/i18n';
import {
  FILTERS_CLEARED,
  FILTER_TEAM,
  filterRemovalOf,
  monthInMessageKey,
  yearOfMonthText,
  type FilterChange,
} from '@/utils/filter-bar';

/**
 * What an empty table says (story 7.5): what is true, never "no results". The
 * month has nobody, or the person chosen is not in the team chosen — with
 * where they are instead and two ways out: `Ukloni filtar: Smjena B`, which
 * keeps the person, and `Poništi filtre`. Both stay on the screen, and focus
 * goes to the filter bar's first chip once the change has rendered. Should a
 * filter alone ever leave no row, it says the filters show nobody and offers
 * `Poništi filtre`. Drawn by the table from 640 px and in place of the
 * stacked rows below it (story 7.6), so the two forms say the same.
 */
export function EmptyResult({
  empty,
  view,
  filtersRef,
  onChange,
}: {
  readonly empty: HoursEmpty;
  readonly view: OrganizationHoursView;
  readonly filtersRef: RefObject<FilterBarHandle | null>;
  readonly onChange: (change: HoursSearchChange) => void;
}): ReactNode {
  if (empty.code === HOURS_EMPTY_MONTH) {
    return <p>{t(hoursEmptyMessageKey(empty))}</p>;
  }

  // The bar makes the change and, once it has rendered, focuses its first chip.
  function act(change: FilterChange): void {
    if (filtersRef.current === null) onChange(change);
    else filtersRef.current.changeAndFocusFirst(change);
  }

  const notInTeam = empty.code === HOURS_EMPTY_NOT_IN_TEAM ? empty : null;
  const when =
    notInTeam === null
      ? null
      : { monthIn: t(monthInMessageKey(notInTeam.month)), year: yearOfMonthText(notInTeam.month) };

  return (
    <div className="grid min-w-0 gap-3 whitespace-normal">
      {notInTeam === null || when === null ? (
        <p className="font-medium text-foreground">{t(hoursEmptyMessageKey(empty))}</p>
      ) : (
        <div className="grid gap-1">
          <p className="font-medium text-foreground">
            {t(hoursEmptyMessageKey(notInTeam), { person: notInTeam.person, team: notInTeam.team, ...when })}
          </p>
          <p>
            {t(hoursEmptyFactMessageKey(notInTeam.personTeam), {
              person: notInTeam.person,
              team: notInTeam.personTeam,
              ...when,
            })}
          </p>
        </div>
      )}
      <div className="flex min-w-0 flex-wrap gap-2">
        {notInTeam === null ? null : (
          <Button
            type="button"
            variant="outline"
            className="h-11"
            onClick={() => {
              act(filterRemovalOf(view.filters, FILTER_TEAM));
            }}
          >
            {t('filter.empty.removeTeam', { team: notInTeam.team })}
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          className="h-11"
          onClick={() => {
            act(FILTERS_CLEARED);
          }}
        >
          {t('filter.clear')}
        </Button>
      </div>
    </div>
  );
}
