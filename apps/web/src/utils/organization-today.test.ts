import { describe, expect, it } from 'vitest';

import { organizationTodayAt } from '@/utils/organization-today';

const ZAGREB = 'Europe/Zagreb';

describe('organizationTodayAt', () => {
  it("reads the organization's date, not the device's", () => {
    // 22:30 UTC on 13 October is already 14 October in Zagreb (UTC+2).
    expect(organizationTodayAt(null, ZAGREB, new Date('2026-10-13T22:30:00Z')).today).toBe('2026-10-14');
    expect(organizationTodayAt(null, 'UTC', new Date('2026-10-13T22:30:00Z')).today).toBe('2026-10-13');
  });

  it('holds the same object, and the first instant, for every tick of one day', () => {
    const first = organizationTodayAt(null, ZAGREB, new Date('2026-10-13T08:00:00Z'));
    const later = organizationTodayAt(first, ZAGREB, new Date('2026-10-13T21:59:00Z'));

    expect(later).toBe(first);
    expect(later.now).toEqual(new Date('2026-10-13T08:00:00Z'));
  });

  it("moves at the organization's midnight, with the tick as the new instant", () => {
    const evening = organizationTodayAt(null, ZAGREB, new Date('2026-10-13T21:59:00Z'));
    const midnight = new Date('2026-10-13T22:00:00Z');
    const next = organizationTodayAt(evening, ZAGREB, midnight);

    expect(next).not.toBe(evening);
    expect(next).toEqual({ today: '2026-10-14', now: midnight });
  });

  it('answers no date while the zone is unknown, held across ticks, and a date once it is known', () => {
    const waiting = organizationTodayAt(null, null, new Date('2026-10-13T08:00:00Z'));

    expect(waiting.today).toBeNull();
    expect(organizationTodayAt(waiting, null, new Date('2026-10-13T08:01:00Z'))).toBe(waiting);

    const known = organizationTodayAt(waiting, ZAGREB, new Date('2026-10-13T08:02:00Z'));

    expect(known.today).toBe('2026-10-13');
    expect(known.now).toEqual(new Date('2026-10-13T08:02:00Z'));
  });

  it('moves when the zone changes the date, even within one minute', () => {
    const tick = new Date('2026-10-13T22:30:00Z');
    const utc = organizationTodayAt(null, 'UTC', tick);

    expect(organizationTodayAt(utc, ZAGREB, tick).today).toBe('2026-10-14');
  });
});
