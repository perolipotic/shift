import { describe, expect, it } from 'vitest';

import {
  MONTH_SEARCH_PARAM,
  PERSON_SEARCH_PARAM,
  TEAM_SEARCH_PARAM,
  isSearchText,
  searchChangedTo,
  searchEntryOf,
} from '@/utils/search-params';

/**
 * The search rules *Kalendar* and *Sati* share (Epic 4 retro, D1), executed
 * (AD-15). Each screen's own parser and change are executed in
 * `features/calendar/utils/month.test.ts` and
 * `features/hours/services/hours-search.test.ts`.
 */

interface Search {
  readonly a?: string | undefined;
  readonly b?: string | undefined;
  readonly c?: number | undefined;
}

const ORDER = ['a', 'b', 'c'] as const;

function isNumber(value: unknown): value is number {
  return typeof value === 'number';
}

describe('the shared parameters', () => {
  it('names the month, the team and the person as both screens write them', () => {
    expect(MONTH_SEARCH_PARAM).toBe('mjesec');
    expect(TEAM_SEARCH_PARAM).toBe('smjena');
    expect(PERSON_SEARCH_PARAM).toBe('osoba');
  });

  it('reads an id as any non-empty text, and nothing else', () => {
    expect(isSearchText('t')).toBe(true);
    expect(isSearchText('')).toBe(false);
    expect(isSearchText(3)).toBe(false);
    expect(isSearchText(undefined)).toBe(false);
    expect(isSearchText(null)).toBe(false);
  });

  it('keeps a valid parameter as its entry, and drops an invalid one on its own', () => {
    expect(searchEntryOf('c', 3, isNumber)).toEqual({ c: 3 });
    expect(searchEntryOf('c', '3', isNumber)).toEqual({});
    expect({ ...searchEntryOf('a', 'x', isSearchText), ...searchEntryOf('c', 'no', isNumber) }).toEqual({ a: 'x' });
  });
});

describe('a change applied to a search', () => {
  it('replaces what the change names, drops what it nulls, and keeps the rest', () => {
    const search: Search = { a: 'x', b: 'y', c: 1 };

    expect(searchChangedTo(ORDER, search, { a: 'z' })).toEqual({ a: 'z', b: 'y', c: 1 });
    expect(searchChangedTo(ORDER, search, { b: null, c: 2 })).toEqual({ a: 'x', c: 2 });
    expect(searchChangedTo<Search>(ORDER, {}, { a: null })).toEqual({});
  });

  it('never writes a parameter nobody chose, and writes them in one order', () => {
    const next = searchChangedTo<Search>(ORDER, { c: 1, a: 'x' }, { b: 'y' });

    expect(Object.keys(next)).toEqual(['a', 'b', 'c']);
    expect('b' in searchChangedTo<Search>(ORDER, { a: 'x' }, { c: 1 })).toBe(false);
  });
});
