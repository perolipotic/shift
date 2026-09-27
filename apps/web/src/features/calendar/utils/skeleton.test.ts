import { describe, expect, it } from 'vitest';

import { MODE_MOJ, MODE_SVE, defaultModeOf } from '@/features/calendar/utils/month';
import {
  SKELETON_GRID,
  SKELETON_LIST,
  cachedRoleOf,
  calendarSkeletonShapeOf,
  earlyCalendarModeOf,
} from '@/features/calendar/utils/skeleton';
import type { MemberRole } from '@/features/navigation/utils/destinations';

/**
 * The skeleton's shape (package 3c), executed (AD-15): the day list whenever
 * the screen will show one, the grid otherwise, and the grid when the role is
 * not yet known and nothing else decides.
 */

const ROLES: readonly MemberRole[] = ['admin', 'member_role'];
const PHONES = [true, false] as const;

describe('calendarSkeletonShapeOf', () => {
  it('follows the default mode for a known role when the search names none', () => {
    for (const role of ROLES) {
      for (const isPhone of PHONES) {
        const expected = defaultModeOf(role, isPhone) === MODE_MOJ ? SKELETON_LIST : SKELETON_GRID;

        expect(calendarSkeletonShapeOf({}, role, isPhone), `${role} on a phone: ${String(isPhone)}`).toBe(expected);
      }
    }
  });

  it('lands a member on a phone on the day list, and everyone else on the grid', () => {
    expect(calendarSkeletonShapeOf({}, 'member_role', true)).toBe(SKELETON_LIST);
    expect(calendarSkeletonShapeOf({}, 'member_role', false)).toBe(SKELETON_GRID);
    expect(calendarSkeletonShapeOf({}, 'admin', true)).toBe(SKELETON_GRID);
    expect(calendarSkeletonShapeOf({}, 'admin', false)).toBe(SKELETON_GRID);
  });

  it('follows the mode the search names, with or without a role', () => {
    for (const role of [...ROLES, null]) {
      for (const isPhone of PHONES) {
        expect(calendarSkeletonShapeOf({ prikaz: MODE_MOJ }, role, isPhone)).toBe(SKELETON_LIST);
        expect(calendarSkeletonShapeOf({ prikaz: MODE_SVE }, role, isPhone)).toBe(SKELETON_GRID);
      }
    }
  });

  it('keeps the grid while the role is unknown and the search decides nothing', () => {
    for (const isPhone of PHONES) {
      expect(calendarSkeletonShapeOf({}, null, isPhone)).toBe(SKELETON_GRID);
      expect(calendarSkeletonShapeOf({ mjesec: '2026-09', smjena: 'team' }, null, isPhone)).toBe(SKELETON_GRID);
    }
  });

  it('shows the day list for a person chosen, whichever mode is the default', () => {
    for (const role of [...ROLES, null]) {
      for (const isPhone of PHONES) {
        expect(calendarSkeletonShapeOf({ osoba: 'member' }, role, isPhone)).toBe(SKELETON_LIST);
        expect(calendarSkeletonShapeOf({ prikaz: MODE_SVE, osoba: 'member' }, role, isPhone)).toBe(SKELETON_LIST);
      }
    }
  });
});

describe('earlyCalendarModeOf', () => {
  it('is the mode the search names, with or without a role', () => {
    for (const role of [...ROLES, null]) {
      for (const isPhone of PHONES) {
        expect(earlyCalendarModeOf({ prikaz: MODE_MOJ }, role, isPhone)).toBe(MODE_MOJ);
        expect(earlyCalendarModeOf({ prikaz: MODE_SVE }, role, isPhone)).toBe(MODE_SVE);
      }
    }
  });

  it('is the default mode for a known role, and unknown without one', () => {
    for (const isPhone of PHONES) {
      for (const role of ROLES) expect(earlyCalendarModeOf({}, role, isPhone)).toBe(defaultModeOf(role, isPhone));
      expect(earlyCalendarModeOf({ osoba: 'member' }, null, isPhone)).toBeNull();
    }
    expect(earlyCalendarModeOf({}, 'member_role', true)).toBe(MODE_MOJ);
  });
});

describe('cachedRoleOf', () => {
  it('reads the role off a successful answer', () => {
    for (const role of ROLES) expect(cachedRoleOf({ ok: true, role })).toBe(role);
  });

  it('is null for no answer, a failure, or a role this build does not know', () => {
    for (const answer of [
      undefined,
      null,
      'admin',
      [],
      { ok: false, code: 'MEMBER_ROLE_REFUSED' },
      { ok: false, role: 'admin' },
      { ok: true, role: 'supervisor' },
      { ok: true },
      { role: 'admin' },
    ]) {
      expect(cachedRoleOf(answer), JSON.stringify(answer) ?? 'undefined').toBeNull();
    }
  });
});
