import { describe, expect, it } from 'vitest';

import { MIDNIGHT_MARGIN_MS, PAST_MIDNIGHT_MS, midnightWait, msUntilMidnight } from '../e2e/utils/dates.ts';
import { RUN_TIMEZONE } from '../e2e/utils/run-fixture.ts';

/**
 * The e2e midnight guard (spec-today-spec-midnight-safe): a test that would
 * start too close to 00:00 Europe/Zagreb waits until just past it. DB-free.
 */
describe('msUntilMidnight', () => {
  it.each([
    ['23:55 CET', '2026-11-16T22:55:00Z', 300_000],
    ['00:00:00 CET', '2026-11-16T23:00:00Z', 86_400_000],
    ['00:00:30 CET', '2026-11-16T23:00:30Z', 86_370_000],
    ['14:00 CET', '2026-11-16T13:00:00Z', 36_000_000],
    ['23:59:59.500 CET', '2026-11-16T22:59:59.500Z', 500],
    ['23:52 CEST', '2026-07-01T21:52:00Z', 480_000],
    ['23:55 on the eve of spring-forward', '2026-03-28T22:55:00Z', 300_000],
    ['23:55 on the eve of fall-back', '2026-10-24T21:55:00Z', 300_000],
    ['23:55 on the spring-forward day', '2026-03-29T21:55:00Z', 300_000],
  ])('%s in Zagreb', (_label, instant, expected) => {
    expect(msUntilMidnight(new Date(instant), RUN_TIMEZONE)).toBe(expected);
  });

  it('reads the zone given, never the machine', () => {
    // 22:55 UTC is 23:55 in Zagreb in winter, 22:55 in London.
    expect(msUntilMidnight(new Date('2026-11-16T22:55:00Z'), 'Europe/London')).toBe(65 * 60_000);
  });
});

describe('midnightWait', () => {
  it('waits from inside the margin until just past midnight', () => {
    expect(midnightWait(new Date('2026-11-16T22:55:00Z'), RUN_TIMEZONE, 30_000)).toBe(300_000 + PAST_MIDNIGHT_MS);
  });

  it('does not wait at the margin or outside it, nor just after midnight', () => {
    const atMargin = new Date(Date.parse('2026-11-16T23:00:00Z') - MIDNIGHT_MARGIN_MS);
    expect(midnightWait(atMargin, RUN_TIMEZONE, 30_000)).toBe(0);
    expect(midnightWait(new Date(atMargin.getTime() + 1), RUN_TIMEZONE, 30_000)).toBeGreaterThan(0);
    expect(midnightWait(new Date('2026-11-16T23:00:30Z'), RUN_TIMEZONE, 30_000)).toBe(0);
    expect(midnightWait(new Date('2026-11-16T13:00:00Z'), RUN_TIMEZONE, 30_000)).toBe(0);
  });

  it('widens the margin to a longer timeout plus a minute', () => {
    // 23:45: outside 8 min, inside a 15 min timeout + 1 min.
    expect(midnightWait(new Date('2026-11-16T22:45:00Z'), RUN_TIMEZONE, 30_000)).toBe(0);
    expect(midnightWait(new Date('2026-11-16T22:45:00Z'), RUN_TIMEZONE, 15 * 60_000)).toBe(15 * 60_000 + PAST_MIDNIGHT_MS);
  });

  it('keeps the 8 min margin for a test with no timeout', () => {
    expect(midnightWait(new Date('2026-11-16T22:55:00Z'), RUN_TIMEZONE, 0)).toBe(300_000 + PAST_MIDNIGHT_MS);
  });
});
