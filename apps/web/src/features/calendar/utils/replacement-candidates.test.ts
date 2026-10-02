import { beforeAll, describe, expect, it } from 'vitest';

import { readCalendar, type CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { outOptionOf, type RosterLineTranslate } from '@/features/calendar/utils/day-detail';
import {
  CANDIDATES_FREE,
  CANDIDATES_ON_LEAVE,
  CANDIDATES_WORKING,
  replacementCandidatesOf,
  type CandidateGroup,
} from '@/features/calendar/utils/replacement-candidates';
import { positionsShown } from '@/features/members/utils/position';
import { ranksShown } from '@/features/members/utils/rank';
import { initLocalization, t } from '@/lib/i18n';
import {
  PILOT,
  SEEDED,
  UJ5,
  VIEWER_MEMBER,
  VIEWER_NAME,
  calendarMemberRow,
  calendarOrganizationRow,
  calendarRosterOverrideRow,
  calendarTableOf,
  memberMembershipRow,
  membersAnswerOf,
  membershipRow,
  overridesAnswerOf,
  rosterOverridesAnswerOf,
  statusRow,
  viewerRow,
  viewerSession,
  type FixtureRows,
} from '@/features/rotation/rotation.fixture';

/**
 * Story 5.4c's replacement candidates, executed (AD-15): the spec's Groups
 * and Excluded rows over both fixtures. On 2026-09-10 the pilot's Smjena A
 * works Dan, B works Noć, and C and D are off. On the day UJ-5's rotation
 * starts, its A works Jutarnja, B Popodnevna and C Noćna.
 */

type Row = Record<string, unknown>;

const DATE = '2026-09-10';

const ANA = '00000000-0000-4000-8000-0000000000e1';
const DINO = '00000000-0000-4000-8000-0000000000e2';
const EVA = '00000000-0000-4000-8000-0000000000e3';
const IVO = '00000000-0000-4000-8000-0000000000e4';
const KARLO = '00000000-0000-4000-8000-0000000000e5';
const LUKA = '00000000-0000-4000-8000-0000000000e6';
const MATE = '00000000-0000-4000-8000-0000000000e7';
const NIKO = '00000000-0000-4000-8000-0000000000e8';

function teamOf(rows: FixtureRows, index: number): string {
  const id = rows.teams[index]?.['id'];

  if (typeof id !== 'string') throw new Error(`no team ${String(index)}`);

  return id;
}

const A = teamOf(PILOT, 0);
const B = teamOf(PILOT, 1);
const C = teamOf(PILOT, 2);
const D = teamOf(PILOT, 3);

/**
 * The viewer (absent, on leave) and Karlo on A; Ivo on B, which works Noć;
 * Ana and Luka on C, Luka inactive; Eva and Mate on D; Dino on no team;
 * Niko on A but taken off by a live override.
 */
async function snapshotOf(rosterOverrides: readonly Row[] = [], usesFireRanks = false): Promise<CalendarSnapshot> {
  const source = calendarTableOf(
    {
      data: [
        calendarOrganizationRow(PILOT, {
          usesFireRanks,
          viewers: [viewerRow([membershipRow(A, SEEDED)], { role: 'admin' })],
          versions: [
            memberMembershipRow(VIEWER_MEMBER, A, SEEDED),
            memberMembershipRow(KARLO, A, SEEDED),
            memberMembershipRow(NIKO, A, SEEDED),
            memberMembershipRow(IVO, B, SEEDED, undefined, 'driver'),
            memberMembershipRow(ANA, C, SEEDED),
            memberMembershipRow(LUKA, C, SEEDED),
            memberMembershipRow(EVA, D, SEEDED),
            memberMembershipRow(MATE, D, SEEDED),
          ],
          statuses: [statusRow(LUKA, false, '2026-09-01')],
        }),
      ],
      error: null,
      count: 1,
    },
    membersAnswerOf([
      calendarMemberRow(VIEWER_MEMBER, VIEWER_NAME),
      calendarMemberRow(ANA, 'Ana Babić', 'firefighter'),
      calendarMemberRow(DINO, 'Dino Grgić'),
      calendarMemberRow(EVA, 'Eva Šarić'),
      calendarMemberRow(IVO, 'Ivo Horvat'),
      calendarMemberRow(KARLO, 'Karlo Jelić'),
      calendarMemberRow(LUKA, 'Luka Perić'),
      calendarMemberRow(MATE, 'Mate Rukavina'),
      calendarMemberRow(NIKO, 'Niko Zorić'),
    ]),
    overridesAnswerOf(),
    rosterOverridesAnswerOf(rosterOverrides),
  );
  const outcome = await readCalendar(source, source, viewerSession());

  if (!outcome.ok) throw new Error(outcome.code);

  return outcome.snapshot;
}

/** The viewer's leave over the date, and Eva's. */
const LEAVE = [
  { memberId: VIEWER_MEMBER, from: '2026-09-10', to: '2026-09-14' },
  { memberId: EVA, from: '2026-09-09', to: '2026-09-10' },
];

/** Niko taken off A's shift; Mate already put on it. */
const OVERRIDES = [
  calendarRosterOverrideRow('ro-niko', A, DATE, NIKO, null),
  calendarRosterOverrideRow('ro-mate', A, DATE, null, MATE),
];

function namesOf(groups: readonly CandidateGroup[]): Record<string, readonly string[]> {
  return Object.fromEntries(groups.map((group) => [group.kind, group.candidates.map((one) => one.name)]));
}

beforeAll(async () => {
  await initLocalization();
});

describe('Groups: free, working that day, on leave — in that order, by name', () => {
  it('puts Ana and Dino in slobodan, Ivo in radi taj dan, and Eva in na godišnjem', async () => {
    const groups = replacementCandidatesOf(await snapshotOf(OVERRIDES), LEAVE, A, DATE);

    expect(groups.map((group) => group.kind)).toEqual([CANDIDATES_FREE, CANDIDATES_WORKING, CANDIDATES_ON_LEAVE]);
    expect(namesOf(groups)).toEqual({
      [CANDIDATES_FREE]: ['Ana Babić', 'Dino Grgić'],
      [CANDIDATES_WORKING]: ['Ivo Horvat'],
      [CANDIDATES_ON_LEAVE]: ['Eva Šarić'],
    });
  });

  it('keeps an empty group, so the order never moves', async () => {
    const groups = replacementCandidatesOf(await snapshotOf(OVERRIDES), [], A, DATE);

    expect(namesOf(groups)).toEqual({
      [CANDIDATES_FREE]: ['Ana Babić', 'Dino Grgić', 'Eva Šarić'],
      [CANDIDATES_WORKING]: ['Ivo Horvat'],
      [CANDIDATES_ON_LEAVE]: [],
    });
  });

  it('counts a shift a roster override puts a member on as working that day', async () => {
    const groups = replacementCandidatesOf(
      await snapshotOf([...OVERRIDES, calendarRosterOverrideRow('ro-ana', B, DATE, null, ANA)]),
      LEAVE,
      A,
      DATE,
    );

    expect(namesOf(groups)[CANDIDATES_WORKING]).toEqual(['Ana Babić', 'Ivo Horvat']);
  });

  it('puts leave before work: a member on leave who would work is on leave', async () => {
    const groups = replacementCandidatesOf(
      await snapshotOf(OVERRIDES),
      [...LEAVE, { memberId: IVO, from: DATE, to: DATE }],
      A,
      DATE,
    );

    expect(namesOf(groups)).toEqual({
      [CANDIDATES_FREE]: ['Ana Babić', 'Dino Grgić'],
      [CANDIDATES_WORKING]: [],
      [CANDIDATES_ON_LEAVE]: ['Eva Šarić', 'Ivo Horvat'],
    });
  });

  it('reads each line as the roster form does: Ime · čin · položaj, where the organization uses them', async () => {
    const snapshot = await snapshotOf(OVERRIDES, true);
    const groups = replacementCandidatesOf(snapshot, LEAVE, A, DATE);
    const rankShown = ranksShown(snapshot);
    const positionShown = positionsShown(snapshot);
    const translate: RosterLineTranslate = { word: (key) => t(key), line: (key, values) => t(key, values) };
    const lines = groups.flatMap((group) =>
      group.candidates.map((one) => outOptionOf(one, rankShown, positionShown, translate).label),
    );

    expect(lines).toEqual(['Ana Babić · vatrogasac', 'Dino Grgić', 'Ivo Horvat · vozač', 'Eva Šarić']);
  });
});

describe('Excluded: the absent member, the roster, the already added and the inactive', () => {
  it('lists none of the viewer, Karlo, Niko (taken off), Mate (put on) or Luka (inactive)', async () => {
    const groups = replacementCandidatesOf(await snapshotOf(OVERRIDES), LEAVE, A, DATE);
    const ids = groups.flatMap((group) => group.candidates.map((one) => one.id));

    for (const excluded of [VIEWER_MEMBER, KARLO, NIKO, MATE, LUKA]) expect(ids).not.toContain(excluded);
    expect(ids).toHaveLength(4);
  });

  it('offers a member another team puts on elsewhere, and one on another date\'s override', async () => {
    const groups = replacementCandidatesOf(
      await snapshotOf([calendarRosterOverrideRow('ro-mate', A, '2026-09-11', null, MATE)]),
      LEAVE,
      A,
      DATE,
    );

    expect(namesOf(groups)[CANDIDATES_FREE]).toContain('Mate Rukavina');
  });
});

describe('the second fixture', () => {
  it('groups UJ-5 the same way: both other teams work the day the rotation starts', async () => {
    const uj5A = teamOf(UJ5, 0);
    const uj5B = teamOf(UJ5, 1);
    const uj5C = teamOf(UJ5, 2);
    const source = calendarTableOf(
      {
        data: [
          calendarOrganizationRow(UJ5, {
            viewers: [viewerRow([membershipRow(uj5A, SEEDED)], { role: 'admin' })],
            versions: [
              memberMembershipRow(VIEWER_MEMBER, uj5A, SEEDED),
              memberMembershipRow(IVO, uj5B, SEEDED),
              memberMembershipRow(ANA, uj5C, SEEDED),
            ],
          }),
        ],
        error: null,
        count: 1,
      },
      membersAnswerOf([
        calendarMemberRow(VIEWER_MEMBER, VIEWER_NAME),
        calendarMemberRow(ANA, 'Ana Babić'),
        calendarMemberRow(IVO, 'Ivo Horvat'),
      ]),
      overridesAnswerOf(),
      rosterOverridesAnswerOf(),
    );
    const outcome = await readCalendar(source, source, viewerSession());

    if (!outcome.ok) throw new Error(outcome.code);

    const groups = replacementCandidatesOf(outcome.snapshot, [{ memberId: VIEWER_MEMBER, from: SEEDED, to: SEEDED }], uj5A, SEEDED);

    expect(namesOf(groups)).toEqual({
      [CANDIDATES_FREE]: [],
      [CANDIDATES_WORKING]: ['Ana Babić', 'Ivo Horvat'],
      [CANDIDATES_ON_LEAVE]: [],
    });
    // The next day C is off: Ana is free, and B works Noćna.
    expect(namesOf(replacementCandidatesOf(outcome.snapshot, [], uj5A, '2020-01-02'))).toEqual({
      [CANDIDATES_FREE]: ['Ana Babić'],
      [CANDIDATES_WORKING]: ['Ivo Horvat'],
      [CANDIDATES_ON_LEAVE]: [],
    });
  });
});
