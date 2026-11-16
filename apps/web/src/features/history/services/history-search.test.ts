import { describe, expect, it } from 'vitest';

import {
  HISTORY_ALL,
  HISTORY_CHIP_KIND,
  HISTORY_CHIP_MEMBER,
  HISTORY_CHIP_PERIOD,
  HISTORY_CHIP_TEAM,
  chooseHistoryChip,
  clearedHistoryFilters,
  historyChipChoiceOf,
  historyChipRemovalOf,
  historyFiltersOf,
  historyFiltersOffered,
  historyLocationRewriteOf,
  historyNarrowed,
  historySearchFor,
  historySearchKeyOf,
  historySearchOf,
  historySearchRewriteOf,
} from '@/features/history/services/history-search';

const OPTIONS = {
  periods: ['7-dana', '30-dana', '90-dana', '365-dana', '2026-11', '2026-10'],
  members: ['ana', 'ivo'],
  teams: ['a'],
  kinds: ['team:changed'],
};

describe('the URL', () => {
  it('defaults to the last 30 days and every chip, all left out of the URL', () => {
    expect(historyFiltersOf({})).toEqual({ period: '30-dana', member: null, team: null, kind: null });
    expect(historySearchFor(historyFiltersOf({}))).toEqual({});
  });

  it('reads every value of the right shape, and a bare number as nothing', () => {
    expect(historyFiltersOf({ razdoblje: '2026-10', osoba: 'ana', smjena: 'a', vrsta: 'team:changed' })).toEqual({
      period: '2026-10',
      member: 'ana',
      team: 'a',
      kind: 'team:changed',
    });
    expect(historyFiltersOf({ razdoblje: 90 }).period).toBe('30-dana');
    expect(historyFiltersOf({ razdoblje: '90-dana' }).period).toBe('90-dana');
  });

  it('rewrites a bad value out, and leaves a clean URL alone', () => {
    expect(historySearchRewriteOf({ razdoblje: 'abc' })).toEqual({});
    expect(historySearchRewriteOf({ razdoblje: '30-dana' })).toEqual({});
    expect(historySearchRewriteOf({ razdoblje: '30' })).toEqual({});
    expect(historySearchRewriteOf({ vrsta: 'team:eaten', osoba: 'ana' })).toEqual({ osoba: 'ana' });
    expect(historySearchRewriteOf({ trazi: 'x' })).toEqual({});
    expect(historySearchRewriteOf({ razdoblje: '7-dana', smjena: 'a' })).toBeNull();
    expect(historySearchRewriteOf({ razdoblje: '2026-11' })).toBeNull();
    expect(historySearchRewriteOf({})).toBeNull();
    expect(historyLocationRewriteOf({ razdoblje: '2026-13' })).toEqual({});
    expect(historyLocationRewriteOf(undefined)).toBeNull();
    expect(historySearchOf({ razdoblje: '365-dana', x: 1 })).toEqual({ razdoblje: '365-dana' });
  });

  it('keys the state as JSON, so two states never share a key', () => {
    expect(historySearchKeyOf({ osoba: 'a,b' })).not.toBe(historySearchKeyOf({ osoba: 'a', smjena: 'b' }));
  });

  it('drops a value the screen does not offer, keeping one whose options are not known yet', () => {
    const filters = { period: '2025-01', member: 'gone', team: 'a', kind: 'team:added' };

    expect(historyFiltersOffered(filters, OPTIONS.periods, OPTIONS)).toEqual({
      period: '30-dana',
      member: null,
      team: 'a',
      kind: null,
    });
    expect(historyFiltersOffered(filters, null, null)).toEqual(filters);
  });
});

describe('the chips', () => {
  const filters = historyFiltersOf({});

  it('picks from the options on screen only, `sve` and a stale value back to the default', () => {
    expect(historyChipChoiceOf(filters, HISTORY_CHIP_PERIOD, '2026-11', OPTIONS).period).toBe('2026-11');
    expect(historyChipChoiceOf(filters, HISTORY_CHIP_PERIOD, '2020-01', OPTIONS).period).toBe('30-dana');
    expect(historyChipChoiceOf(filters, HISTORY_CHIP_MEMBER, 'ivo', OPTIONS).member).toBe('ivo');
    expect(historyChipChoiceOf(filters, HISTORY_CHIP_MEMBER, 'zed', OPTIONS).member).toBeNull();
    expect(historyChipChoiceOf(filters, HISTORY_CHIP_TEAM, HISTORY_ALL, OPTIONS).team).toBeNull();
    expect(historyChipChoiceOf(filters, HISTORY_CHIP_KIND, 'team:changed', OPTIONS).kind).toBe('team:changed');
  });

  it('removes one chip at a time, and clears them all', () => {
    const set = { period: '7-dana', member: 'ana', team: 'a', kind: 'team:changed' };

    expect(historyChipRemovalOf(set, HISTORY_CHIP_PERIOD).period).toBe('30-dana');
    expect(historyChipRemovalOf(set, HISTORY_CHIP_MEMBER).member).toBeNull();
    expect(historyChipRemovalOf(set, HISTORY_CHIP_TEAM).team).toBeNull();
    expect(historyChipRemovalOf(set, HISTORY_CHIP_KIND).kind).toBeNull();
    expect(clearedHistoryFilters()).toEqual(filters);
    expect(historyNarrowed(set)).toBe(true);
    expect(historyNarrowed(filters)).toBe(false);
  });

  it('names a chip by its key, never by a cast', () => {
    expect(chooseHistoryChip('kind')).toBe(HISTORY_CHIP_KIND);
    expect(chooseHistoryChip('state')).toBeNull();
  });
});
