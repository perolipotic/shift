import { describe, expect, it } from 'vitest';

import {
  sortControlCursorClampOf,
  sortControlCursorOf,
  sortControlLabelOf,
  sortControlListedOf,
  type SortControlColumn,
} from '@/utils/sort-control';

/**
 * Story 7.6's sort control, executed (AD-15): where the list's tab stop
 * starts, and what the trigger names. What a pick CHANGES is the screen's
 * own heading press — `nextHoursSort` and `nextSortState`, executed in their
 * modules — and the focus return and Escape are the browser's, in
 * `e2e/tests/hours` and `e2e/tests/people`.
 */

const COLUMNS: readonly SortControlColumn<'ime' | 'tim' | 'ukupno'>[] = [
  { key: 'ime', label: 'Osoba' },
  { key: 'tim', label: 'Smjena' },
  { key: 'ukupno', label: 'Ukupno' },
];

describe('sortControlCursorOf', () => {
  it('starts on the sorted column', () => {
    expect(sortControlCursorOf(COLUMNS, 'ime')).toBe(0);
    expect(sortControlCursorOf(COLUMNS, 'ukupno')).toBe(2);
  });

  it('falls back to the first column when the sorted one is not offered', () => {
    expect(sortControlCursorOf(COLUMNS.slice(1), 'ime')).toBe(0);
    expect(sortControlCursorOf([], 'ime')).toBe(0);
  });
});

describe('sortControlLabelOf', () => {
  it('names the sorted column', () => {
    expect(sortControlLabelOf(COLUMNS, 'tim')).toBe('Smjena');
  });

  it('names the first column when the sorted one is not offered, and nothing with none', () => {
    expect(sortControlLabelOf(COLUMNS.slice(1), 'ime')).toBe('Smjena');
    expect(sortControlLabelOf([], 'ime')).toBe('');
  });
});

describe('sortControlListedOf', () => {
  it('offers every column not marked unlisted, and still names an unlisted sorted one', () => {
    const columns: readonly SortControlColumn<'ime' | 'adresa'>[] = [
      { key: 'ime', label: 'Ime' },
      { key: 'adresa', label: 'Adresa e-pošte', listed: false },
    ];

    expect(sortControlListedOf(columns).map((column) => column.key)).toEqual(['ime']);
    expect(sortControlLabelOf(columns, 'adresa')).toBe('Adresa e-pošte');
  });
});

describe('sortControlCursorClampOf', () => {
  it('keeps the tab stop on an option when the columns shrink', () => {
    expect(sortControlCursorClampOf(5, 3)).toBe(2);
    expect(sortControlCursorClampOf(1, 3)).toBe(1);
    expect(sortControlCursorClampOf(-1, 3)).toBe(0);
    expect(sortControlCursorClampOf(2, 0)).toBe(0);
  });
});
