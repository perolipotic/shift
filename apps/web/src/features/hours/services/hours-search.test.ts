import { describe, expect, it } from 'vitest';

import {
  HOURS_TEAM_PARAM,
  SORT_CONFLICTS,
  hoursSearchOf,
  hoursSearchTo,
  legacyHoursSearchOf,
  type HoursSearch,
} from '@/features/hours/services/hours-search';

/**
 * *Sati*'s URL, executed (AD-15): the parser, the old `?tim=` redirect and
 * the change applied to a search — the table's vocabulary (Epic 4 retro, P1)
 * over the rules *Kalendar* shares (`@/utils/search-params`, D1).
 */

describe('the search', () => {
  it('reads a valid month, and drops an invalid one and everything else', () => {
    expect(hoursSearchOf({ mjesec: '2026-09' })).toEqual({ mjesec: '2026-09' });
    expect(hoursSearchOf({ mjesec: '2026-13' })).toEqual({});
    expect(hoursSearchOf({ mjesec: '2026-9' })).toEqual({});
    expect(hoursSearchOf({ mjesec: 202609 })).toEqual({});
    expect(hoursSearchOf({ prikaz: 'moj', tim: 'x' })).toEqual({});
    expect(hoursSearchOf({})).toEqual({});
  });

  it("reads the organization table's team, person, sort and direction, each dropped on its own when invalid", () => {
    expect(
      hoursSearchOf({ mjesec: '2026-09', smjena: 't', osoba: 'o', sort: 'ukupno', smjer: 'silazno' }),
    ).toEqual({ mjesec: '2026-09', smjena: 't', osoba: 'o', sort: 'ukupno', smjer: 'silazno' });
    for (const sort of ['ime', 'tim', 'smjene', 'ukupno', 'dopust', 'konflikti', 'pojas-b1']) {
      expect(hoursSearchOf({ sort })).toEqual({ sort });
    }
    expect(hoursSearchOf({ sort: 'pojas-' })).toEqual({});
    expect(hoursSearchOf({ sort: 'total' })).toEqual({});
    expect(hoursSearchOf({ smjer: 'gore' })).toEqual({});
    expect(hoursSearchOf({ smjer: 'uzlazno' })).toEqual({ smjer: 'uzlazno' });
    expect(hoursSearchOf({ smjena: '', osoba: 3 })).toEqual({});
  });

  it('sorts by the shifts in unresolved conflict under `konflikti`', () => {
    expect(SORT_CONFLICTS).toBe('konflikti');
    expect(hoursSearchOf({ sort: SORT_CONFLICTS, smjer: 'silazno' })).toEqual({ sort: 'konflikti', smjer: 'silazno' });
  });

  it('names the team `smjena`, as the calendar does, and never reads the old `tim` (story 7.5)', () => {
    expect(HOURS_TEAM_PARAM).toBe('smjena');
    expect(hoursSearchOf({ tim: 't' })).toEqual({});
    // `sort=tim` stays a sort value: the Team column.
    expect(hoursSearchOf({ sort: 'tim' })).toEqual({ sort: 'tim' });
  });

  it('redirects an old `?tim=` to `?smjena=`, keeping every other parameter in order (story 7.5)', () => {
    // Matrix: old URL — `/sati?tim=B&mjesec=2026-07` → `?mjesec=2026-07&smjena=B`.
    const moved = legacyHoursSearchOf({ tim: 'B', mjesec: '2026-07' });

    expect(moved).toEqual({ mjesec: '2026-07', smjena: 'B' });
    expect(Object.keys(moved ?? {})).toEqual(['mjesec', 'smjena']);
    expect(legacyHoursSearchOf({ mjesec: '2026-07', tim: 'B', osoba: 'o', sort: 'tim', smjer: 'silazno' })).toEqual({
      mjesec: '2026-07',
      osoba: 'o',
      sort: 'tim',
      smjer: 'silazno',
      smjena: 'B',
    });
    // `smjena` wins when both are present.
    expect(legacyHoursSearchOf({ tim: 'B', smjena: 'A' })).toEqual({ smjena: 'A' });
    // No `tim`, no redirect.
    expect(legacyHoursSearchOf({ smjena: 'B', mjesec: '2026-07' })).toBeNull();
    expect(legacyHoursSearchOf({})).toBeNull();
  });

  it('navigates to a month, and to the current one by dropping the parameter, keeping the rest', () => {
    expect(hoursSearchTo({}, { mjesec: '2026-10' })).toEqual({ mjesec: '2026-10' });
    expect(hoursSearchTo({ mjesec: '2026-10' }, { mjesec: null })).toEqual({});
    const table: HoursSearch = { mjesec: '2026-10', smjena: 't', osoba: 'o', sort: 'ukupno', smjer: 'silazno' };

    expect(hoursSearchTo(table, { mjesec: null })).toEqual({ smjena: 't', osoba: 'o', sort: 'ukupno', smjer: 'silazno' });
    expect(hoursSearchTo(table, { smjena: null, osoba: 'o' })).toEqual({
      mjesec: '2026-10',
      osoba: 'o',
      sort: 'ukupno',
      smjer: 'silazno',
    });
    expect(hoursSearchTo(table, { smjena: 't', osoba: 'p' })).toEqual({
      mjesec: '2026-10',
      smjena: 't',
      osoba: 'p',
      sort: 'ukupno',
      smjer: 'silazno',
    });
    expect(hoursSearchTo(table, { sort: null, smjer: null })).toEqual({ mjesec: '2026-10', smjena: 't', osoba: 'o' });
  });

  it('writes the parameters in one order, however the search was reached', () => {
    const reached: HoursSearch = { smjer: 'silazno', osoba: 'o', sort: 'ukupno', smjena: 't' };

    expect(Object.keys(hoursSearchTo(reached, { mjesec: '2026-10' }))).toEqual(['mjesec', 'smjena', 'osoba', 'sort', 'smjer']);
  });
});
