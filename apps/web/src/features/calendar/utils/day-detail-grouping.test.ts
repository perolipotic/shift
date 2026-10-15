import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { readCalendar, type CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { dayDetailOf, rosterOffersOf } from '@/features/calendar/utils/day-detail';
import type { CandidateGroup } from '@/features/calendar/utils/replacement-candidates';
import { initLocalization } from '@/lib/i18n';
import {
  PILOT,
  SEEDED,
  VIEWER_MEMBER,
  VIEWER_NAME,
  calendarMemberRow,
  calendarOrganizationRow,
  calendarTableOf,
  memberMembershipRow,
  membersAnswerOf,
  membershipRow,
  overridesAnswerOf,
  rosterOverridesAnswerOf,
  viewerRow,
  viewerSession,
} from '@/features/rotation/rotation.fixture';

/**
 * Story 7.9's roster dialog when 5.4c's grouping misbehaves, executed (AD-15):
 * the helper is stubbed here alone, so a grouping that throws and one that
 * leaves a candidate out can be driven. Neither takes a candidate away, and
 * neither puts one under a group it was not placed in.
 */

const grouping = vi.hoisted(() => ({
  answer: null as (() => readonly CandidateGroup[]) | null,
}));

vi.mock('@/features/calendar/utils/replacement-candidates', async (original) => {
  const actual = await original<typeof import('@/features/calendar/utils/replacement-candidates')>();

  return {
    ...actual,
    replacementCandidatesOf: (...args: Parameters<typeof actual.replacementCandidatesOf>) =>
      grouping.answer === null ? actual.replacementCandidatesOf(...args) : grouping.answer(),
  };
});

const TEAM = 'pilot-smjena-b';
const WORKING = '2020-01-01';
const ANA = '00000000-0000-4000-8000-0000000000d1';
const DORA = '00000000-0000-4000-8000-0000000000d4';

let snapshot: CalendarSnapshot;

beforeAll(async () => {
  await initLocalization();
  const source = calendarTableOf(
    {
      data: [
        calendarOrganizationRow(PILOT, {
          viewers: [viewerRow([membershipRow('pilot-smjena-a', SEEDED)], { role: 'admin' })],
          versions: [memberMembershipRow(VIEWER_MEMBER, 'pilot-smjena-a', SEEDED), memberMembershipRow(ANA, TEAM, SEEDED)],
        }),
      ],
      error: null,
      count: 1,
    },
    membersAnswerOf([
      calendarMemberRow(VIEWER_MEMBER, VIEWER_NAME),
      calendarMemberRow(ANA, 'Ana'),
      calendarMemberRow(DORA, 'Dora'),
    ]),
    overridesAnswerOf(),
    rosterOverridesAnswerOf(),
  );
  const outcome = await readCalendar(source, source, viewerSession());

  if (!outcome.ok) throw new Error(outcome.code);
  snapshot = outcome.snapshot;
});

afterEach(() => {
  grouping.answer = null;
  vi.restoreAllMocks();
});

const ids = (candidates: readonly { readonly id: string }[]) => candidates.map((one) => one.id);

describe('the roster dialog\'s groups, when the grouping misbehaves (story 7.9)', () => {
  it('falls back to every candidate ungrouped, logged, when the grouping throws', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    grouping.answer = () => {
      throw new RangeError('the grouping cannot be derived');
    };
    const offers = rosterOffersOf(snapshot, dayDetailOf(snapshot, TEAM, WORKING), []);

    expect(offers.set).toBe(true);
    expect(offers.inGroups).toEqual([]);
    expect(ids(offers.inUngrouped)).toEqual(ids(offers.in));
    expect(ids(offers.in)).toEqual([DORA, VIEWER_MEMBER]);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('never puts a candidate the helper did not place under "slobodan": it is left ungrouped, and logged', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    grouping.answer = () => [
      { kind: 'free', candidates: [] },
      { kind: 'working', candidates: [{ id: VIEWER_MEMBER, name: VIEWER_NAME, fireRank: null, position: null, continuousMinutes: null }] },
      { kind: 'onLeave', candidates: [] },
    ];
    const offers = rosterOffersOf(snapshot, dayDetailOf(snapshot, TEAM, WORKING), []);

    expect(offers.inGroups.map((group) => [group.kind, ids(group.candidates)])).toEqual([
      ['free', []],
      ['working', [VIEWER_MEMBER]],
      ['onLeave', []],
    ]);
    expect(ids(offers.inUngrouped)).toEqual([DORA]);
    expect(error).toHaveBeenCalledTimes(1);
  });
});

describe('the continuous duty each member to put on carries (D717)', () => {
  it('reads the shift\'s own type off the day: the viewer, off A\'s Dan as B\'s Noć starts, makes 24 h; Dora nothing', () => {
    const offers = rosterOffersOf(snapshot, dayDetailOf(snapshot, TEAM, WORKING), []);
    const working = offers.inGroups.find((group) => group.kind === 'working')?.candidates ?? [];
    const free = offers.inGroups.find((group) => group.kind === 'free')?.candidates ?? [];

    expect(working.map((one) => [one.id, one.continuousMinutes])).toEqual([[VIEWER_MEMBER, 24 * 60]]);
    expect(free.map((one) => [one.id, one.continuousMinutes])).toEqual([[DORA, null]]);
    // Not grouped while the leave is unread: no figure either.
    expect(rosterOffersOf(snapshot, dayDetailOf(snapshot, TEAM, WORKING)).in.every((one) => one.continuousMinutes === null)).toBe(true);
  });
});
