import { describe, expect, it } from 'vitest';

import {
  DUTY_DONE,
  DUTY_RUNNING,
  DUTY_UPCOMING,
  MINUTES_PER_DAY,
  absoluteMinuteOf,
  dutiesOf,
  dutyProgressOf,
  momentOf,
  type DutyLeg,
} from '../src/index.js';
import { at } from './fixtures.js';

/**
 * Story 6.2 — touching working shifts read as one duty, and where a minute
 * falls within it. Node environment, no browser.
 */

const dan = (date: string): DutyLeg => ({ date, startMinute: at(7), durationMinutes: 720 });
const noc = (date: string): DutyLeg => ({ date, startMinute: at(19), durationMinutes: 720 });

describe('absoluteMinuteOf and momentOf', () => {
  it('counts whole days from 1970-01-01 and reads them back', () => {
    expect(absoluteMinuteOf('1970-01-01', 0)).toBe(0);
    expect(absoluteMinuteOf('1970-01-02', at(7))).toBe(MINUTES_PER_DAY + at(7));
    expect(absoluteMinuteOf('1969-12-31', at(23))).toBe(-MINUTES_PER_DAY + at(23));
    expect(momentOf(absoluteMinuteOf('2026-10-02', at(7)))).toEqual({ date: '2026-10-02', minute: at(7) });
    expect(momentOf(absoluteMinuteOf('1969-12-31', 5))).toEqual({ date: '1969-12-31', minute: 5 });
  });

  it('refuses what is not a date or a minute of the day', () => {
    expect(() => absoluteMinuteOf('2026-02-31', 0)).toThrow(RangeError);
    expect(() => absoluteMinuteOf('2026-10-01', MINUTES_PER_DAY)).toThrow(RangeError);
    expect(() => absoluteMinuteOf('2026-10-01', 1.5)).toThrow(RangeError);
    expect(() => momentOf(0.5)).toThrow(RangeError);
    // A minute past 9999-12-31, or before 0001-01-01, names no date this package accepts.
    expect(() => momentOf(absoluteMinuteOf('9999-12-31', 0) + MINUTES_PER_DAY)).toThrow(RangeError);
    expect(() => momentOf(absoluteMinuteOf('0001-01-01', 0) - 1)).toThrow(RangeError);
    expect(momentOf(absoluteMinuteOf('9999-12-31', MINUTES_PER_DAY - 1))).toEqual({
      date: '9999-12-31',
      minute: MINUTES_PER_DAY - 1,
    });
  });
});

describe('dutiesOf', () => {
  it('joins a day shift and the night shift that starts as it ends', () => {
    const legs = [noc('2026-10-01'), dan('2026-10-01')];
    const duties = dutiesOf(legs);

    expect(duties).toHaveLength(1);
    expect(duties[0]?.legs).toEqual([legs[1], legs[0]]);
    expect(duties[0]?.startMinute).toBe(absoluteMinuteOf('2026-10-01', at(7)));
    expect(duties[0]?.endMinute).toBe(absoluteMinuteOf('2026-10-02', at(7)));
    expect(duties[0]?.totalMinutes).toBe(MINUTES_PER_DAY);
  });

  it('joins across dates: a night shift, then the next date’s day shift', () => {
    const duties = dutiesOf([noc('2026-09-30'), dan('2026-10-01')]);

    expect(duties).toHaveLength(1);
    expect(duties[0]?.legs.map((leg) => leg.date)).toEqual(['2026-09-30', '2026-10-01']);
  });

  it('joins three legs and returns the caller’s own objects', () => {
    const legs = [
      { ...noc('2026-09-30'), id: 'a' },
      { ...dan('2026-10-01'), id: 'b' },
      { ...noc('2026-10-01'), id: 'c' },
    ];
    const duties = dutiesOf(legs);

    expect(duties.map((duty) => duty.legs.map((leg) => leg.id))).toEqual([['a', 'b', 'c']]);
    expect(duties[0]?.totalMinutes).toBe(36 * 60);
  });

  it('never joins over a gap (Dan 07–19, Noć 20–08)', () => {
    expect(dutiesOf([dan('2026-10-01'), { date: '2026-10-01', startMinute: at(20), durationMinutes: 720 }])).toEqual(
      [],
    );
  });

  it('never joins an overlap (two Dan 07–19 on one date)', () => {
    expect(dutiesOf([dan('2026-10-01'), dan('2026-10-01')])).toEqual([]);
  });

  it('sets aside every leg an overlap touches: Dan, a duplicate Dan and Noć on one date are no duty', () => {
    expect(dutiesOf([dan('2026-10-01'), dan('2026-10-01'), noc('2026-10-01')])).toEqual([]);
  });

  it('chains the legs an overlap leaves untouched', () => {
    // The two Dans on 03.10. overlap and are set aside; 01.10.'s Dan and Noć still join.
    const duties = dutiesOf([dan('2026-10-01'), noc('2026-10-01'), dan('2026-10-03'), dan('2026-10-03')]);

    expect(duties.map((duty) => duty.legs.map((leg) => leg.date))).toEqual([['2026-10-01', '2026-10-01']]);
  });

  it('sets aside two legs with one start whatever their durations, in either input order', () => {
    const day = dan('2026-10-01');
    const whole = { date: '2026-10-01', startMinute: at(7), durationMinutes: MINUTES_PER_DAY };
    const night = { date: '2026-10-02', startMinute: at(7), durationMinutes: 720 };

    // The 24 h leg would touch 02.10.'s, the 12 h one would not: neither is kept.
    expect(dutiesOf([day, whole, night])).toEqual([]);
    expect(dutiesOf([whole, day, night])).toEqual([]);
  });

  it('is no duty for a single overnight shift', () => {
    expect(dutiesOf([noc('2026-10-01')])).toEqual([]);
    expect(dutiesOf([])).toEqual([]);
  });

  it('keeps two duties apart when a gap separates them', () => {
    const duties = dutiesOf([dan('2026-10-01'), noc('2026-10-01'), dan('2026-10-05'), noc('2026-10-05')]);

    expect(duties.map((duty) => duty.legs[0]?.date)).toEqual(['2026-10-01', '2026-10-05']);
  });

  it('refuses a leg out of range', () => {
    expect(() => dutiesOf([{ date: '2026-13-01', startMinute: 0, durationMinutes: 60 }])).toThrow(RangeError);
    expect(() => dutiesOf([{ date: '2026-10-01', startMinute: -1, durationMinutes: 60 }])).toThrow(RangeError);
    expect(() => dutiesOf([{ date: '2026-10-01', startMinute: 0, durationMinutes: 0 }])).toThrow(RangeError);
    expect(() => dutiesOf([{ date: '2026-10-01', startMinute: 0, durationMinutes: 1441 }])).toThrow(RangeError);
  });
});

describe('dutyProgressOf', () => {
  const [duty] = dutiesOf([dan('2026-10-01'), noc('2026-10-01')]);

  if (duty === undefined) throw new Error('the fixture duty is missing');

  it('is running mid-duty: 14 h 10 min of 24 h, Dan done and Noć running', () => {
    expect(dutyProgressOf(duty, absoluteMinuteOf('2026-10-01', at(21) + 10))).toEqual({
      phase: DUTY_RUNNING,
      elapsedMinutes: 14 * 60 + 10,
      remainingMinutes: 9 * 60 + 50,
      legs: [DUTY_DONE, DUTY_RUNNING],
    });
  });

  it('is running past midnight', () => {
    expect(dutyProgressOf(duty, absoluteMinuteOf('2026-10-02', at(3))).phase).toBe(DUTY_RUNNING);
  });

  it('is upcoming before the start, with nothing elapsed', () => {
    expect(dutyProgressOf(duty, absoluteMinuteOf('2026-10-01', at(6)))).toEqual({
      phase: DUTY_UPCOMING,
      elapsedMinutes: 0,
      remainingMinutes: MINUTES_PER_DAY,
      legs: [DUTY_UPCOMING, DUTY_UPCOMING],
    });
  });

  it('is running exactly at the start, and the first leg with it', () => {
    expect(dutyProgressOf(duty, duty.startMinute)).toEqual({
      phase: DUTY_RUNNING,
      elapsedMinutes: 0,
      remainingMinutes: MINUTES_PER_DAY,
      legs: [DUTY_RUNNING, DUTY_UPCOMING],
    });
  });

  it('hands over exactly at the seam between legs', () => {
    expect(dutyProgressOf(duty, absoluteMinuteOf('2026-10-01', at(19))).legs).toEqual([DUTY_DONE, DUTY_RUNNING]);
  });

  it('is done exactly at the end, and after it', () => {
    for (const now of [duty.endMinute, duty.endMinute + 600]) {
      expect(dutyProgressOf(duty, now)).toEqual({
        phase: DUTY_DONE,
        elapsedMinutes: MINUTES_PER_DAY,
        remainingMinutes: 0,
        legs: [DUTY_DONE, DUTY_DONE],
      });
    }
  });

  it('refuses a minute that is not whole', () => {
    expect(() => dutyProgressOf(duty, 0.5)).toThrow(RangeError);
  });
});
