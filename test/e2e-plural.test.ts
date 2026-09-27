import { describe, expect, it } from 'vitest';

import { hr, plural } from '../e2e/utils/i18n.ts';

/**
 * `plural()`, the E2E suite's filler for ICU count messages: it must fill a
 * message exactly as the app's i18next-icu shows it, or a locator built from
 * it matches nothing. Checked against the real `hr.json` messages.
 */
describe('plural', () => {
  it('picks the one, few and other forms Croatian uses', () => {
    expect(plural(hr.smjene.roster.count, 1)).toBe('1 osoba');
    expect(plural(hr.smjene.roster.count, 21)).toBe('21 osoba');
    expect(plural(hr.smjene.archivedCount, 3)).toBe('Arhivirano: 3 smjene');
    expect(plural(hr.smjene.archivedCount, 12)).toBe('Arhivirano: 12 smjena');
    expect(plural(hr.organization.hourBands.count, 5)).toBe('5 pojaseva');
    expect(plural(hr.smjene.roster.count, 0)).toBe('0 osoba');
  });

  it('honours an exact selector before the category, and fills every #', () => {
    const message = '{count, plural, =0 {nitko} one {# osoba} few {# osobe} other {# osoba, # ukupno}}';

    expect(plural(message, 0)).toBe('nitko');
    expect(plural(message, 1)).toBe('1 osoba');
    expect(plural(message, 5)).toBe('5 osoba, 5 ukupno');
  });

  it('formats # with Croatian grouping', () => {
    const shown = new Intl.NumberFormat('hr').format(12345);

    expect(shown).not.toBe('12345');
    expect(plural(hr.smjene.roster.count, 12345)).toBe(`${shown} osoba`);
  });

  it('refuses ICU it does not support', () => {
    expect(() => plural('{count, plural, offset:1 one {# a} other {# b}}', 1)).toThrow();
    expect(() => plural(hr.smjene.membership.filterTeam, 1)).toThrow();
    expect(() => plural('{n, plural, one {# a} other {# b}}', 1)).toThrow();
    expect(() => plural('{count, plural, one {# a} other {# b}} i {team}', 1)).toThrow();
    expect(() => plural('bez broja', 1)).toThrow();
  });
});
