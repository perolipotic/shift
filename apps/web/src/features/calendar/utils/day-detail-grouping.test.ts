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
      { kind: 'working', candidates: [{ id: VIEWER_MEMBER, name: VIEWER_NAME, fireRank: null, position: null }] },
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
