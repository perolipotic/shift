import type { ReactNode, RefObject } from 'react';

import { FilterBar, type FilterBarHandle } from '@/components/filter-bar';
import type { HoursSearchChange } from '@/features/hours/services/my-hours';
import type { OrganizationHoursView } from '@/features/hours/services/organization-hours';

/**
 * The organization table's filters (story 7.5): the shared filter bar —
 * Smjena and Osoba chips, the summary line and one `Poništi filtre` — whose
 * model is `hoursFilterBarOf`'s. The two COMBINE. Which team or person is
 * chosen — a stale id being none — is `organizationHoursViewOf`'s decision;
 * the state lives in the URL alone.
 */
export function OrganizationHoursFilters({
  view,
  filtersRef,
  onChange,
}: {
  readonly view: OrganizationHoursView;
  readonly filtersRef: RefObject<FilterBarHandle | null>;
  readonly onChange: (change: HoursSearchChange) => void;
}): ReactNode {
  return <FilterBar model={view.filters} onChange={onChange} handle={filtersRef} />;
}
