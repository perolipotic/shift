import { describe, expect, it } from 'vitest';

import {
  MAX_ZONE_RANGE_DAYS,
  checkTimeZone,
  instantOf,
  offsetMinutesAt,
  utcIsoOf,
  zoneTransitionsOf,
} from '../src/index.js';

/**
 * AD-6 as amended by Architect pass 1 (story 16.2): `zone.ts` is the one
 * local-to-UTC conversion, by the runtime's `Intl` alone. Both fixtures keep
 * the organization's zone, Europe/Zagreb (the pilot and UJ-5 alike), so its
 * four transitions of 2026 and 2027 are pinned; Sydney's are the southern
 * hemisphere's, and UTC has none.
 */

const ZAGREB = 'Europe/Zagreb';
const iso = (date: string, minute: number, zone = ZAGREB): string => utcIsoOf(instantOf(date, minute, zone));

describe('instantOf', () => {
  it('reads a winter and a summer wall clock in Zagreb', () => {
    expect(iso('2026-01-15', 7 * 60)).toBe('2026-01-15T06:00:00Z');
    expect(iso('2026-07-15', 7 * 60)).toBe('2026-07-15T05:00:00Z');
  });

  it('reads a skipped local time with the offset before the gap (spring forward)', () => {
    // 02:00–03:00 does not exist on 2026-03-29: 02:30 reads as 03:30 local.
    expect(iso('2026-03-29', 2 * 60 + 30)).toBe('2026-03-29T01:30:00Z');
    expect(iso('2026-03-29', 2 * 60)).toBe('2026-03-29T01:00:00Z');
    expect(iso('2026-03-29', 3 * 60)).toBe('2026-03-29T01:00:00Z');
    expect(iso('2026-03-29', 60 + 59)).toBe('2026-03-29T00:59:00Z');
  });

  it('reads a repeated local time as its earlier instant (fall back)', () => {
    // 02:00–03:00 happens twice on 2026-10-25: 02:30 is the CEST one.
    expect(iso('2026-10-25', 2 * 60 + 30)).toBe('2026-10-25T00:30:00Z');
    expect(iso('2026-10-25', 3 * 60)).toBe('2026-10-25T02:00:00Z');
  });

  it('runs a midnight-crossing end into the next date (DI-5)', () => {
    // A 19:00–07:00 night starting on the autumn transition: 13 real hours.
    const start = instantOf('2026-10-24', 19 * 60, ZAGREB);
    const end = instantOf('2026-10-24', 1440 + 7 * 60, ZAGREB);

    expect(utcIsoOf(end)).toBe('2026-10-25T06:00:00Z');
    expect((end - start) / 3_600_000).toBe(13);
    expect((instantOf('2026-03-28', 1440 + 7 * 60, ZAGREB) - instantOf('2026-03-28', 19 * 60, ZAGREB)) / 3_600_000).toBe(11);
  });

  it('refuses a malformed date, minute or zone', () => {
    expect(() => instantOf('2026-02-30', 0, ZAGREB)).toThrow(RangeError);
    expect(() => instantOf('2026-01-01', -1, ZAGREB)).toThrow(RangeError);
    expect(() => instantOf('2026-01-01', 2880, ZAGREB)).toThrow(RangeError);
    expect(() => instantOf('2026-01-01', 1.5, ZAGREB)).toThrow(RangeError);
    expect(() => instantOf('2026-01-01', 0, 'Europe/Nowhere')).toThrow(/does not know/);
    expect(() => checkTimeZone('')).toThrow(RangeError);
  });
});

describe('offsetMinutesAt', () => {
  it('answers minutes east of UTC either side of a transition', () => {
    const transition = Date.UTC(2026, 2, 29, 1, 0, 0);

    expect(offsetMinutesAt(transition - 1000, ZAGREB)).toBe(60);
    expect(offsetMinutesAt(transition, ZAGREB)).toBe(120);
    expect(offsetMinutesAt(transition, 'UTC')).toBe(0);
  });

  it('refuses an instant that is not a whole millisecond', () => {
    expect(() => offsetMinutesAt(0.5, ZAGREB)).toThrow(RangeError);
  });
});

describe('zoneTransitionsOf', () => {
  it('lists both transitions of both years in Zagreb, to the second', () => {
    expect(
      zoneTransitionsOf(ZAGREB, '2026-01-01', '2027-12-31').map((one) => [utcIsoOf(one.instant), one.offsetFromMinutes, one.offsetToMinutes]),
    ).toEqual([
      ['2026-03-29T01:00:00Z', 60, 120],
      ['2026-10-25T01:00:00Z', 120, 60],
      ['2027-03-28T01:00:00Z', 60, 120],
      ['2027-10-31T01:00:00Z', 120, 60],
    ]);
  });

  it('lists the southern hemisphere the other way round', () => {
    expect(
      zoneTransitionsOf('Australia/Sydney', '2026-01-01', '2026-12-31').map((one) => [utcIsoOf(one.instant), one.offsetFromMinutes, one.offsetToMinutes]),
    ).toEqual([
      ['2026-04-04T16:00:00Z', 660, 600],
      ['2026-10-03T16:00:00Z', 600, 660],
    ]);
  });

  it('keeps a transition at the first instant of the range (a zone that springs forward at midnight)', () => {
    // America/Santiago moves from -04:00 to -03:00 at 00:00 local on 2026-09-06.
    const [first] = zoneTransitionsOf('America/Santiago', '2026-09-06', '2026-09-06');

    expect(first === undefined ? null : [utcIsoOf(first.instant), first.offsetFromMinutes, first.offsetToMinutes]).toEqual([
      '2026-09-06T04:00:00Z',
      -240,
      -180,
    ]);
  });

  it('answers none for a zone without transitions, and for a range between them', () => {
    expect(zoneTransitionsOf('UTC', '2026-01-01', '2027-12-31')).toEqual([]);
    expect(zoneTransitionsOf(ZAGREB, '2026-04-01', '2026-09-30')).toEqual([]);
  });

  it('takes the range by local date, both ends inclusive', () => {
    expect(zoneTransitionsOf(ZAGREB, '2026-03-29', '2026-03-29')).toHaveLength(1);
    expect(zoneTransitionsOf(ZAGREB, '2026-03-30', '2026-10-24')).toEqual([]);
  });

  it('refuses a reversed, overlong or malformed range', () => {
    expect(() => zoneTransitionsOf(ZAGREB, '2026-02-01', '2026-01-01')).toThrow(/ends before it starts/);
    expect(() => zoneTransitionsOf(ZAGREB, '2020-01-01', '2031-01-01')).toThrow(new RegExp(String(MAX_ZONE_RANGE_DAYS)));
    expect(() => zoneTransitionsOf(ZAGREB, '2026-13-01', '2027-01-01')).toThrow(RangeError);
  });
});

describe('utcIsoOf', () => {
  it('writes an instant to the second, UTC', () => {
    expect(utcIsoOf(0)).toBe('1970-01-01T00:00:00Z');
    expect(utcIsoOf(Date.UTC(2026, 10, 21, 9, 5, 7, 999))).toBe('2026-11-21T09:05:07Z');
    expect(utcIsoOf(-1000)).toBe('1969-12-31T23:59:59Z');
  });
});
