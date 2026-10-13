import { useState } from 'react';

import { useMinuteTicker } from '@/hooks/minute-ticker';
import { organizationTodayAt, type OrganizationToday } from '@/utils/organization-today';

/**
 * The organization's today in `timeZone` (the calendar snapshot's; `null`
 * until it lands), moved at the organization's midnight by the minute ticker
 * (story 6.2's), so the calendar, *Raspored*, *Sati* and the leave overview
 * never keep marking yesterday. Wiring only: the rule, and why the instant is
 * held for the whole day, is `organizationTodayAt`, which the node suite
 * executes.
 */
export function useOrganizationToday(timeZone: string | null): OrganizationToday {
  const tick = useMinuteTicker();
  const [held, setHeld] = useState(() => organizationTodayAt(null, timeZone, tick));
  const next = organizationTodayAt(held, timeZone, tick);

  // Stored while rendering, as React derives state from a changed input: the
  // re-render answers `next` itself, so it settles at once.
  if (next !== held) setHeld(next);

  return next;
}
