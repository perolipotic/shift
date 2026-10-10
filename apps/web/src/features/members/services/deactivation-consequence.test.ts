import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { readCalendar, type CalendarMember, type CalendarSnapshot } from '@/features/calendar/services/snapshot';
import {
  deactivationConsequenceOf,
  shownDeactivationConsequenceOf,
} from '@/features/members/services/deactivation-consequence';
import {
  DEACTIVATE,
  REACTIVATE,
  deactivationConsequenceMessageKey,
  statusSubmitMessageKey,
} from '@/features/members/services/write';
import { initLocalization, t } from '@/lib/i18n';
import {
  PILOT,
  SEEDED,
  VIEWER_MEMBER,
  VIEWER_NAME,
  calendarMemberRow,
  calendarOrganizationRow,
  calendarRosterOverrideRow,
  calendarTableOf,
  memberMembershipRow,
  stepRow,
  type FixtureRows,
  membersAnswerOf,
  membershipRow,
  overridesAnswerOf,
  rosterOverridesAnswerOf,
  statusRow,
  viewerRow,
  viewerSession,
} from '@/features/rotation/rotation.fixture';
import { monthInMessageKey } from '@/utils/filter-bar';

/**
 * Story 7.13c's consequence in numbers, executed (AD-15): every row of the
 * spec's matrix that the computation decides, over the pilot fixture —
 * `[Dan, Noć, Slobodno, Slobodno]` from 2020-01-01, Smjena B working Dan on
 * 13.09.2026 and every fourth day after (…, 03.10., 07.10., …, 31.10.,
 * 04.11., …, 28.11.) and Noć the day after each (…, 04.10., …, 28.10.,
 * 01.11., …, 29.11.). Zoran, Ana, Iva and Marko are on Smjena B; the viewer
 * on Smjena A.
 *
 * NO PILOT SHIFTS TOUCH: a Dan 07:00–19:00 ends a whole day before the Noć
 * 19:00–07:00 dated the next day starts, so every pilot duty count (story
 * 6.2's `dutiesOf`) is its shift count. {@link NIGHT_FIRST} swaps the first
 * two steps — Noć, then the Dan dated the day after, starting as the Noć
 * ends — so its shifts pair into 24 h duties.
 */

const ZORAN = '00000000-0000-4000-8000-0000000000d1';
const ANA = '00000000-0000-4000-8000-0000000000d2';
const IVA = '00000000-0000-4000-8000-0000000000d3';
const MARKO = '00000000-0000-4000-8000-0000000000d4';
const A = 'pilot-smjena-a';
const B = 'pilot-smjena-b';
/** The organization's today: before every date the tests deactivate from. */
const TODAY = '2026-10-01';

type Row = Record<string, unknown>;

/**
 * The pilot with its first two steps swapped — `[Noć, Dan, Slobodno,
 * Slobodno]` — so a Noć 19:00–07:00 is followed by the next day's Dan
 * 07:00–19:00, starting as it ends: one 24 h duty (story 6.2). Smjena B, at
 * offset 1, then works Noć on 13.09.2026 and every fourth day after (…,
 * 03.10., 07.10., …, 31.10.) and Dan the day after each (…, 04.10., 08.10.,
 * …, 28.10., 01.11.).
 */
const NIGHT_FIRST: FixtureRows = {
  ...PILOT,
  steps: ['pilot-noc', 'pilot-dan', 'pilot-slobodno', 'pilot-slobodno'].map((type, position) =>
    stepRow(`pilot-step-${String(position)}`, 'pilot-rotation', position, type),
  ),
};

/** The calendar snapshot over Smjena B's four members, with `statuses` and `rosterOverrides` as stored. */
async function snapshotOf(
  {
    statuses = [],
    rosterOverrides = [],
    versions = [],
    rows = PILOT,
  }: {
    readonly statuses?: readonly Row[];
    readonly rosterOverrides?: readonly Row[];
    readonly versions?: readonly Row[];
    readonly rows?: FixtureRows;
  } = {},
): Promise<CalendarSnapshot> {
  const source = calendarTableOf(
    {
      data: [
        calendarOrganizationRow(rows, {
          viewers: [viewerRow([membershipRow(A, SEEDED)], { role: 'admin' })],
          versions: [
            memberMembershipRow(VIEWER_MEMBER, A, SEEDED),
            ...[ZORAN, ANA, IVA, MARKO].map((member) => memberMembershipRow(member, B, SEEDED)),
            ...versions,
          ],
          statuses,
        }),
      ],
      error: null,
      count: 1,
    },
    membersAnswerOf([
      calendarMemberRow(VIEWER_MEMBER, VIEWER_NAME),
      calendarMemberRow(ZORAN, 'Zoran Zorić'),
      calendarMemberRow(ANA, 'Ana Anić'),
      calendarMemberRow(IVA, 'Iva Ivić'),
      calendarMemberRow(MARKO, 'Marko Marić'),
    ]),
    overridesAnswerOf([]),
    rosterOverridesAnswerOf(rosterOverrides),
  );
  const outcome = await readCalendar(source, source, viewerSession());

  if (!outcome.ok) throw new Error(outcome.code);

  return outcome.snapshot;
}

let plain: CalendarSnapshot;

beforeAll(async () => {
  await initLocalization();
  plain = await snapshotOf();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** The line the dialog draws for `day`, exactly as the status card words it. */
function lineOf(snapshot: CalendarSnapshot, day: string): string | null {
  const consequence = deactivationConsequenceOf(snapshot, ZORAN, day, TODAY);

  return consequence === null
    ? null
    : t(deactivationConsequenceMessageKey(consequence.duties), {
        ...consequence,
        month: t(monthInMessageKey(consequence.month)),
      });
}

describe('the consequence in numbers', () => {
  it('Happy: the team before and after, and the own duties left in the month, no shifts touching', () => {
    // From 05.10.: Dan 07, 11, 15, 19, 23, 27, 31 and Noć 08, 12, 16, 20, 24,
    // 28 — thirteen, each a duty of its own.
    expect(deactivationConsequenceOf(plain, ZORAN, '2026-10-05', TODAY)).toEqual({
      team: 'Smjena B',
      members: 3,
      total: 4,
      month: '2026-10',
      duties: 13,
    });
    expect(lineOf(plain, '2026-10-05')).toBe('Smjena B od tada ima 3 od 4 člana, a u listopadu je to 13 smjena.');
  });

  it('counts the day itself: a deactivation from a working day loses it too', () => {
    // From 31.10., a Dan: that one shift.
    expect(deactivationConsequenceOf(plain, ZORAN, '2026-10-31', TODAY)?.duties).toBe(1);
    expect(lineOf(plain, '2026-10-31')).toBe('Smjena B od tada ima 3 od 4 člana, a u listopadu je to 1 smjena.');
  });

  it('Late in month: no own shift left drops the month clause', () => {
    // 30.11. is a Slobodno, the month's last day.
    expect(deactivationConsequenceOf(plain, ZORAN, '2026-11-30', TODAY)?.duties).toBe(0);
    expect(lineOf(plain, '2026-11-30')).toBe('Smjena B od tada ima 3 od 4 člana.');
  });

  it('Next month: the month clause names it and counts from the day through its end', () => {
    // From 03.11.: Dan 04, 08, …, 28 and Noć 05, 09, …, 29 — seven each; Noć 01.11. is before it.
    expect(deactivationConsequenceOf(plain, ZORAN, '2026-11-03', TODAY)).toMatchObject({ month: '2026-11', duties: 14 });
    expect(lineOf(plain, '2026-11-03')).toBe('Smjena B od tada ima 3 od 4 člana, a u studenome je to 14 smjena.');
  });

  it('Moved off by override: a shift the member was taken off is not counted, nor one they were put on', async () => {
    const snapshot = await snapshotOf({
      rosterOverrides: [
        // Taken off Smjena B's Dan on 07.10.
        calendarRosterOverrideRow('roster-off', B, '2026-10-07', ZORAN, null),
        // Put on Smjena A's Dan on 08.10. (A works Dan 10.09 and every fourth day after): another team's.
        calendarRosterOverrideRow('roster-on', A, '2026-10-08', null, ZORAN),
      ],
    });

    expect(deactivationConsequenceOf(snapshot, ZORAN, '2026-10-05', TODAY)?.duties).toBe(12);
  });

  it('counts only the active: a member already inactive is in neither size', async () => {
    const snapshot = await snapshotOf({ statuses: [statusRow(MARKO, false, '2026-09-01')] });

    expect(deactivationConsequenceOf(snapshot, ZORAN, '2026-10-05', TODAY)).toMatchObject({ members: 2, total: 3 });
    expect(lineOf(snapshot, '2026-10-05')).toBe('Smjena B od tada ima 2 od 3 člana, a u listopadu je to 13 smjena.');
  });

  it('words the plurals of Croatian for the sizes and the duties, the verb agreeing', () => {
    const line = (total: number, duties: number): string =>
      t(deactivationConsequenceMessageKey(duties), {
        team: 'Smjena B',
        members: total - 1,
        total,
        month: t(monthInMessageKey('2026-10')),
        duties,
      });

    expect(line(1, 2)).toBe('Smjena B od tada ima 0 od 1 člana, a u listopadu su to 2 smjene.');
    expect(line(5, 5)).toBe('Smjena B od tada ima 4 od 5 članova, a u listopadu je to 5 smjena.');
    expect(line(21, 21)).toBe('Smjena B od tada ima 20 od 21 člana, a u listopadu je to 21 smjena.');
  });
});

describe('duties: touching shifts count once', () => {
  let nights: CalendarSnapshot;

  beforeAll(async () => {
    nights = await snapshotOf({ rows: NIGHT_FIRST });
  });

  it('Happy: a Noć and the Dan after it are one duty', () => {
    // From 05.10.: Noć 07 + Dan 08, 11 + 12, 15 + 16, 19 + 20, 23 + 24, 27 + 28,
    // and Noć 31 — seven duties out of thirteen shifts.
    expect(deactivationConsequenceOf(nights, ZORAN, '2026-10-05', TODAY)).toMatchObject({ duties: 7 });
    expect(lineOf(nights, '2026-10-05')).toBe('Smjena B od tada ima 3 od 4 člana, a u listopadu je to 7 smjena.');
  });

  it('Duty split by month end: a Noć on the last day whose Dan is dated the 1st counts once', () => {
    expect(deactivationConsequenceOf(nights, ZORAN, '2026-10-31', TODAY)?.duties).toBe(1);
    expect(lineOf(nights, '2026-10-31')).toBe('Smjena B od tada ima 3 od 4 člana, a u listopadu je to 1 smjena.');
  });

  it('from a duty\'s second leg, only the legs in range are grouped', () => {
    // From 28.10., the Dan of the 27.10. duty: that Dan alone, and Noć 31.
    expect(deactivationConsequenceOf(nights, ZORAN, '2026-10-28', TODAY)?.duties).toBe(2);
  });

  it('Moved off by override: a duty losing a leg counts the leg left once', async () => {
    const snapshot = await snapshotOf({
      rows: NIGHT_FIRST,
      // Taken off Smjena B's Noć 07.10.: Dan 08 stands alone, still one.
      rosterOverrides: [calendarRosterOverrideRow('roster-off', B, '2026-10-07', ZORAN, null)],
    });

    expect(deactivationConsequenceOf(snapshot, ZORAN, '2026-10-05', TODAY)?.duties).toBe(7);
  });

  it('Next month: counts the duties from the day through the month\'s end', () => {
    // From 03.11.: Noć 04 + Dan 05, …, Noć 28 + Dan 29 — seven; Dan 01.11. is before it.
    expect(deactivationConsequenceOf(nights, ZORAN, '2026-11-03', TODAY)).toMatchObject({ month: '2026-11', duties: 7 });
  });
});

describe('no consequence: the question stands alone', () => {
  it('No team: the member is on no team on the day', async () => {
    const snapshot = await snapshotOf({ versions: [memberMembershipRow(ZORAN, null, '2026-10-03')] });

    expect(deactivationConsequenceOf(snapshot, ZORAN, '2026-10-05', TODAY)).toBeNull();
    // Before the move to no team, on Smjena B.
    expect(deactivationConsequenceOf(snapshot, ZORAN, '2026-10-02', TODAY)?.team).toBe('Smjena B');
  });

  it('not on the team\'s roster that day as read: never "4 od 4"', async () => {
    // Zoran already inactive from 01.10.: a deactivation from 05.10. shrinks nothing.
    const snapshot = await snapshotOf({ statuses: [statusRow(ZORAN, false, '2026-10-01')] });

    expect(deactivationConsequenceOf(snapshot, ZORAN, '2026-10-05', TODAY)).toBeNull();
  });

  it('Snapshot pending or failed: no snapshot', () => {
    expect(deactivationConsequenceOf(null, ZORAN, '2026-10-05', TODAY)).toBeNull();
  });

  it('a change the erasure guard refuses: a status version already dated the day', async () => {
    const snapshot = await snapshotOf({ statuses: [statusRow(ZORAN, true, '2026-10-05')] });

    expect(deactivationConsequenceOf(snapshot, ZORAN, '2026-10-05', TODAY)).toBeNull();
  });

  it('a member the snapshot does not hold', () => {
    expect(deactivationConsequenceOf(plain, '00000000-0000-4000-8000-0000000000ff', '2026-10-05', TODAY)).toBeNull();
  });

  it('a domain throw is logged, never rethrown', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(deactivationConsequenceOf(plain, ZORAN, '2026-13-45', TODAY)).toBeNull();
    expect(logged).toHaveBeenCalledOnce();
  });

  it('leaves the snapshot as read', () => {
    const before = plain.members.find((member) => member.id === ZORAN);

    deactivationConsequenceOf(plain, ZORAN, '2026-10-05', TODAY);

    expect(plain.members.find((member) => member.id === ZORAN)).toBe(before);
    expect((before as CalendarMember).statuses).toEqual([]);
  });
});

describe('the line the dialog shows', () => {
  const deactivation = { change: DEACTIVATE, minimum: '2026-10-02' } as const;

  it('shows the consequence for a deactivation on or after the offer\'s minimum', () => {
    expect(shownDeactivationConsequenceOf(plain, ZORAN, deactivation, '2026-10-05', TODAY)).toEqual(
      deactivationConsequenceOf(plain, ZORAN, '2026-10-05', TODAY),
    );
    expect(shownDeactivationConsequenceOf(plain, ZORAN, deactivation, '2026-10-02', TODAY)).not.toBeNull();
  });

  it('Past date: none before the offer\'s minimum', () => {
    expect(shownDeactivationConsequenceOf(plain, ZORAN, deactivation, '2026-10-01', TODAY)).toBeNull();
    expect(shownDeactivationConsequenceOf(plain, ZORAN, deactivation, '2000-01-01', TODAY)).toBeNull();
  });

  it('Reactivation line: a reactivation never has one, whatever the date', () => {
    const reactivation = { change: REACTIVATE, minimum: '2026-10-02' } as const;

    expect(shownDeactivationConsequenceOf(plain, ZORAN, reactivation, '2026-10-05', TODAY)).toBeNull();
    expect(shownDeactivationConsequenceOf(plain, ZORAN, reactivation, '2026-10-02', TODAY)).toBeNull();
  });

  it('Empty or bad date, no dialog, or no today: none', () => {
    expect(shownDeactivationConsequenceOf(plain, ZORAN, deactivation, '', TODAY)).toBeNull();
    expect(shownDeactivationConsequenceOf(plain, ZORAN, deactivation, '2026-13-45', TODAY)).toBeNull();
    expect(shownDeactivationConsequenceOf(plain, ZORAN, null, '2026-10-05', TODAY)).toBeNull();
    expect(shownDeactivationConsequenceOf(plain, ZORAN, deactivation, '2026-10-05', null)).toBeNull();
    expect(shownDeactivationConsequenceOf(null, ZORAN, deactivation, '2026-10-05', TODAY)).toBeNull();
  });
});

describe('the final button', () => {
  it('repeats the date for a deactivation while the field holds one, and is the one word otherwise', () => {
    expect(statusSubmitMessageKey(DEACTIVATE, true)).toBe('ljudi.status.deactivateActionFrom');
    expect(statusSubmitMessageKey(DEACTIVATE, false)).toBe('ljudi.status.deactivateAction');
    // Reactivation is unchanged.
    expect(statusSubmitMessageKey(REACTIVATE, true)).toBe('ljudi.status.reactivateAction');
    expect(statusSubmitMessageKey(REACTIVATE, false)).toBe('ljudi.status.reactivateAction');
    expect(t('ljudi.status.deactivateActionFrom', { date: '05.10.' })).toBe('Deaktiviraj od 05.10.');
  });

  it('drops the month clause only with no shift left', () => {
    expect(deactivationConsequenceMessageKey(0)).toBe('ljudi.status.deactivateConsequenceTeam');
    expect(deactivationConsequenceMessageKey(1)).toBe('ljudi.status.deactivateConsequence');
  });
});
