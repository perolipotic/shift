import { organizationIsoDate } from '@/lib/i18n/format';

/**
 * The organization's today on a ticking clock, as a pure module (AD-15).
 *
 * THE ONE RULE for "today" on every screen that reads it (deferred work from
 * 3.1 and 5.3b): the date is the ORGANIZATION'S (L8), never the device's,
 * and it is read again on every tick of `@/hooks/minute-ticker`, so a screen
 * left open past the organization's midnight moves to the new day without a
 * reload. `@/hooks/organization-today` wires this to the ticker.
 *
 * THE INSTANT IS HELD FOR THE DAY. A tick on the same date answers the held
 * value itself — the same object, the same `now` — so a memo keyed on either
 * is worked out again only when the date turns, not once a minute.
 */

export interface OrganizationToday {
  /** The organization's date, `YYYY-MM-DD`, or `null` while its zone is not known yet. */
  readonly today: string | null;
  /** The tick the date was first read at: one object for the whole day. */
  readonly now: Date;
}

/**
 * What `tick` makes of `held` in `timeZone` (`null` while no snapshot names
 * it): `held` itself while the date is unchanged, otherwise the new date with
 * `tick` as its instant.
 */
export function organizationTodayAt(
  held: OrganizationToday | null,
  timeZone: string | null,
  tick: Date,
): OrganizationToday {
  const today = timeZone === null ? null : organizationIsoDate(tick, timeZone);

  return held !== null && held.today === today ? held : { today, now: tick };
}
