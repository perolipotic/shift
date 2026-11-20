import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { MIDNIGHT_MARGIN_MS, PAST_MIDNIGHT_MS, midnightWait, msUntilMidnight } from '../e2e/utils/dates.ts';
import { RUN_TIMEZONE } from '../e2e/utils/run-fixture.ts';
import { FREE_ALL_DAY_DAYS_BEFORE, SEEDED_STEPS, freeAllDay, seededStepAt } from '../e2e/utils/seeded-pattern.ts';

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

/**
 * Not a midnight crossing (spec-e2e-midnight-guard-gap): CI run 44832080218
 * (PR #324, shard 4) waited out midnight — both workers annotated
 * `midnight-wait`, 404 s — and the four free-day `today.spec.ts` cases then
 * started at 00:07 Zagreb, wholly on 2026-11-21, and failed: they seeded the
 * Slobodno right after the 19:00–07:00 Noć, which *Danas* reads as "Danas
 * radiš … od jučer" until 07:00. The same four had failed on PR #310.
 */
describe('a free-day seed', () => {
  it('the guard rightly does not wait at 00:07 Zagreb, when the four failed', () => {
    expect(midnightWait(new Date('2026-11-20T23:07:03Z'), RUN_TIMEZONE, 90_000)).toBe(0);
  });

  it('is the seeded pattern: Dan 07:00–19:00, Noć 19:00–07:00, Slobodno, Slobodno', () => {
    expect(SEEDED_STEPS).toEqual([
      { working: true, start: '07:00', end: '19:00' },
      { working: true, start: '19:00', end: '07:00' },
      { working: false },
      { working: false },
    ]);
  });

  it.each([
    [0, 0],
    [1, 1],
    [2, 2],
    [3, 3],
    [4, 0],
    [-1, 3],
    [-5, 3],
  ])('a date %i days after the start falls on step %i', (days, step) => {
    expect(seededStepAt(days)).toBe(step);
  });

  it.each([
    [0, false, 'today the Dan'],
    [1, false, 'today the Noć'],
    [2, false, 'the Slobodno after the Noć: the Noć carries over until 07:00'],
    [3, true, 'the Slobodno after a Slobodno'],
    [7, true, 'the same step a pattern later'],
  ])('daysBefore %i is free all day: %s (%s)', (daysBefore, free) => {
    expect(freeAllDay(daysBefore)).toBe(free);
  });

  it('the offset the free-day tests seed with is free all day', () => {
    expect(freeAllDay(FREE_ALL_DAY_DAYS_BEFORE)).toBe(true);
  });

  it('today.spec.ts seeds the Slobodno after the Noć only in the test that pins the clock for the carry-over', () => {
    const source = readFileSync(new URL('../e2e/tests/today/today.spec.ts', import.meta.url), 'utf8');
    const tests = source.split(/\n(?=\s*test\()/);
    const afterNoc = tests.filter((block) => /\bseeded\([^)]*,\s*2\)/.test(block));
    expect(afterNoc).toHaveLength(1);
    expect(afterNoc[0]).toContain('a lone Noć from yesterday');
    expect(afterNoc[0]).toContain('page.clock.install');
    // Every test asserting the free card is visible seeds the free-all-day offset.
    for (const block of tests.filter((b) => /todayCard\(danas\.today\.free\)\)\.(toBeVisible|toContainText)/.test(b) || /todayCard\(danas\.today\.free\);/.test(b))) {
      expect(block).toContain('FREE_ALL_DAY_DAYS_BEFORE');
    }
  });
});
