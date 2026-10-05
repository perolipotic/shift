import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { readCalendar, type CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { CHECK_READY, CHECK_REFUSED, type ErasureReads } from '@/features/conflicts/services/erasure-check';
import {
  OVERRIDE_CHANGE_AMEND,
  OVERRIDE_CHANGE_ARCHIVED,
  OVERRIDE_CHANGE_CONFIRM,
  OVERRIDE_CHANGE_GONE,
  OVERRIDE_CHANGE_SAME_AS_PROJECTED,
  OVERRIDE_CHANGE_TAKEN,
  overrideErasureCheckOf,
  type OverrideChange,
} from '@/features/conflicts/services/override-erasures';
import {
  DISPOSITION_ARCHIVED,
  DISPOSITION_DENIED,
  DISPOSITION_FAILED,
  DISPOSITION_GONE,
  DISPOSITION_REASON,
  DISPOSITION_SAME_AS_PROJECTED,
  amendEntryOf,
  rowOffersOf,
  type PendingOverrideRow,
} from '@/features/rotation/services/override-disposition';
import {
  reviewAmendChangeOf,
  reviewConfirmChangeOf,
  reviewRefusalOf,
  staleRefusalOf,
} from '@/features/rotation/services/override-review-erasures';
import {
  PILOT,
  SEEDED,
  VIEWER_MEMBER,
  VIEWER_NAME,
  calendarMemberRow,
  calendarOrganizationRow,
  calendarOverrideRow,
  calendarTableOf,
  memberMembershipRow,
  membersAnswerOf,
  membershipRow,
  overridesAnswerOf,
  rosterOverridesAnswerOf,
  viewerRow,
  viewerSession,
} from '@/features/rotation/rotation.fixture';
import { initLocalization, t } from '@/lib/i18n';

/**
 * Story 5.5h's override review guard, executed (AD-15): every row of the
 * spec's matrix but "Keep" and "Read failed" (the e2e spec's), from the
 * review's row to the shared check's answer and back to the review's own
 * codes. (That discard asks no check is the sign-in suite's source claim.) The pilot fixture — `[Dan, Noć, Slobodno, Slobodno]`, the viewer on
 * Smjena A, which works Dan 10.09 — with every override written before the
 * rotation versions were saved, so pending review.
 */

const A = 'pilot-smjena-a';
const DAN = 'pilot-dan';
const NOC = 'pilot-noc';
const SLOBODNO = 'pilot-slobodno';
const DATE = '2026-09-10';
/** Before the rotation versions were saved: an override written then is pending review. */
const BEFORE_VERSIONS = '2019-12-01T08:00:00+00:00';
const NAMES: Readonly<Record<string, string>> = { [DAN]: 'Dan', [NOC]: 'Noć', [SLOBODNO]: 'Slobodno' };

type Row = Record<string, unknown>;

async function calendarOf(overrides: readonly Row[]): Promise<CalendarSnapshot> {
  const source = calendarTableOf(
    {
      data: [
        calendarOrganizationRow(PILOT, {
          viewers: [viewerRow([membershipRow(A, SEEDED)], { role: 'admin' })],
          versions: [memberMembershipRow(VIEWER_MEMBER, A, SEEDED)],
        }),
      ],
      error: null,
      count: 1,
    },
    membersAnswerOf([calendarMemberRow(VIEWER_MEMBER, VIEWER_NAME)]),
    overridesAnswerOf(overrides),
    rosterOverridesAnswerOf([]),
  );
  const outcome = await readCalendar(source, source, viewerSession());

  if (!outcome.ok) throw new Error(outcome.code);

  return outcome.snapshot;
}

/** The review's row of a pending override of Smjena A on 10.09 (projected Dan), as `pendingOverrideRowsOf` lists it. */
function rowOf(id: string, shiftTypeId: string, governed = true): PendingOverrideRow {
  return {
    id,
    teamId: A,
    teamName: 'Smjena A',
    isoDate: DATE,
    date: '10.09.2026',
    shiftTypeId,
    typeName: NAMES[shiftTypeId] ?? shiftTypeId,
    projectedShiftTypeId: governed ? DAN : null,
    projectedTypeName: governed ? 'Dan' : null,
    reason: 'Zamjena zbog vježbe.',
    authorName: VIEWER_NAME,
    governed,
    options: governed
      ? [
          { id: NOC, name: 'Noć' },
          { id: SLOBODNO, name: 'Slobodno' },
        ]
      : [],
  };
}

const LEAVE_10 = [{ id: 'record-1', member_id: VIEWER_MEMBER, during: '[2026-09-10,2026-09-11)' }];

function readsOf(calendar: CalendarSnapshot, resolutions: readonly Row[] = []): () => Promise<ErasureReads> {
  return () => Promise.resolve({ calendar, records: LEAVE_10, resolutions });
}

async function checkOf(calendar: CalendarSnapshot, change: OverrideChange, resolutions: readonly Row[] = []) {
  return overrideErasureCheckOf(readsOf(calendar, resolutions), change, true);
}

beforeAll(async () => {
  await initLocalization();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the row → change mapping', () => {
  it('asks a confirm of the row\'s override, matched by id', () => {
    expect(reviewConfirmChangeOf(rowOf('pending-free', SLOBODNO))).toEqual({
      kind: OVERRIDE_CHANGE_CONFIRM,
      overrideId: 'pending-free',
    });
  });

  it('asks an amend of the row\'s override to the type the preflight passed', () => {
    expect(reviewAmendChangeOf(rowOf('pending-noc', NOC), SLOBODNO)).toEqual({
      kind: OVERRIDE_CHANGE_AMEND,
      overrideId: 'pending-noc',
      shiftTypeId: SLOBODNO,
    });
  });
});

describe('the refusal → disposition code mapping', () => {
  it('says gone and archived as the review\'s own, and both are stale', () => {
    expect(reviewRefusalOf(OVERRIDE_CHANGE_GONE)).toBe(DISPOSITION_GONE);
    expect(reviewRefusalOf(OVERRIDE_CHANGE_ARCHIVED)).toBe(DISPOSITION_ARCHIVED);
    expect(staleRefusalOf(DISPOSITION_GONE)).toBe(true);
    expect(staleRefusalOf(DISPOSITION_ARCHIVED)).toBe(true);
  });

  it('says sameAsProjected as the amend\'s preflight does, kept in its dialog', () => {
    expect(reviewRefusalOf(OVERRIDE_CHANGE_SAME_AS_PROJECTED)).toBe(DISPOSITION_SAME_AS_PROJECTED);
    expect(staleRefusalOf(DISPOSITION_SAME_AS_PROJECTED)).toBe(false);
  });

  it('logs taken, which no review write should meet, and says it as a failure', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(reviewRefusalOf(OVERRIDE_CHANGE_TAKEN)).toBe(DISPOSITION_FAILED);
    expect(logged).toHaveBeenCalledWith(DISPOSITION_FAILED, OVERRIDE_CHANGE_TAKEN);
    expect(staleRefusalOf(DISPOSITION_FAILED)).toBe(false);
  });

  it.each([DISPOSITION_DENIED, DISPOSITION_REASON] as const)('keeps %s out of the stale path', (code) => {
    expect(staleRefusalOf(code)).toBe(false);
  });
});

describe('Confirm erases', () => {
  it('lists the conflict a pending Slobodno override would erase once confirmed, in the review\'s words', async () => {
    const calendar = await calendarOf([calendarOverrideRow('pending-free', A, DATE, SLOBODNO, { createdAt: BEFORE_VERSIONS })]);
    const check = await checkOf(calendar, reviewConfirmChangeOf(rowOf('pending-free', SLOBODNO)));

    expect(check).toEqual({
      kind: CHECK_READY,
      rows: [expect.objectContaining({ memberId: VIEWER_MEMBER, date: DATE, teamId: A, shiftTypeName: 'Dan', teamWorks: false })],
    });
    if (check.kind !== CHECK_READY) throw new Error(check.kind);

    const [row] = check.rows;

    if (row === undefined) throw new Error('no row');

    expect(t('rotation.builder.overrides.erasures.rowFree', { member: row.memberName, team: row.teamName })).toBe(
      `${VIEWER_NAME} na godišnjem · nakon promjene: Smjena A taj dan slobodna`,
    );
    expect(t('rotation.builder.overrides.erasures.title', { count: 1 })).toBe('Izmjena briše 1 konflikt');
    expect(t('rotation.builder.overrides.erasures.removed', { count: 1 })).toBe('Uklonjen 1 konflikt.');
  });
});

describe('Confirm working', () => {
  it('lists nothing when the pending override names another working type: one click, as before', async () => {
    const calendar = await calendarOf([calendarOverrideRow('pending-noc', A, DATE, NOC, { createdAt: BEFORE_VERSIONS })]);

    expect(await checkOf(calendar, reviewConfirmChangeOf(rowOf('pending-noc', NOC)))).toEqual({ kind: CHECK_READY, rows: [] });
  });
});

describe('Amend erases', () => {
  it('lists the conflict a pending Noć override amended to Slobodno would erase', async () => {
    const row = rowOf('pending-noc', NOC);
    const calendar = await calendarOf([calendarOverrideRow('pending-noc', A, DATE, NOC, { createdAt: BEFORE_VERSIONS })]);
    const entry = amendEntryOf(row, SLOBODNO, '  Vježba.  ');

    if (!entry.ok) throw new Error(entry.code);

    expect(await checkOf(calendar, reviewAmendChangeOf(row, entry.shiftTypeId))).toEqual({
      kind: CHECK_READY,
      rows: [expect.objectContaining({ date: DATE, teamId: A, teamWorks: false })],
    });
  });
});

describe('Amend preflight', () => {
  it('refuses an amend to the projected type before any check, as it always did', () => {
    expect(amendEntryOf(rowOf('pending-noc', NOC), DAN, 'Vježba.')).toEqual({
      ok: false,
      code: DISPOSITION_SAME_AS_PROJECTED,
    });
  });

  it('would refuse it as the same code were it checked: the check never derives it', async () => {
    const calendar = await calendarOf([calendarOverrideRow('pending-noc', A, DATE, NOC, { createdAt: BEFORE_VERSIONS })]);
    const check = await checkOf(calendar, reviewAmendChangeOf(rowOf('pending-noc', NOC), DAN));

    expect(check).toEqual({ kind: CHECK_REFUSED, code: OVERRIDE_CHANGE_SAME_AS_PROJECTED });
    if (check.kind === CHECK_REFUSED) expect(reviewRefusalOf(check.code)).toBe(DISPOSITION_SAME_AS_PROJECTED);
  });

  it('offers neither confirm nor amend where no version governs the date: the governed refusal comes first', () => {
    expect(rowOffersOf(rowOf('ungoverned', SLOBODNO, false))).toEqual({ confirm: false, amend: false });
  });
});

describe('Gone', () => {
  it.each([
    ['confirm', reviewConfirmChangeOf(rowOf('removed-meanwhile', SLOBODNO))],
    ['amend', reviewAmendChangeOf(rowOf('removed-meanwhile', NOC), SLOBODNO)],
  ])('refuses a %s of an override no longer in the fresh calendar, on the stale path', async (_kind, change) => {
    const calendar = await calendarOf([]);
    const check = await checkOf(calendar, change);

    expect(check).toEqual({ kind: CHECK_REFUSED, code: OVERRIDE_CHANGE_GONE });
    if (check.kind === CHECK_REFUSED) expect(staleRefusalOf(reviewRefusalOf(check.code))).toBe(true);
  });
});

describe('Archived', () => {
  it.each([
    ['team', (calendar: CalendarSnapshot): CalendarSnapshot => ({
      ...calendar,
      teams: calendar.teams.map((team) => (team.id === A ? { ...team, archived: true } : team)),
    })],
    ['type', (calendar: CalendarSnapshot): CalendarSnapshot => ({
      ...calendar,
      types: calendar.types.map((type) => (type.id === SLOBODNO ? { ...type, archived: true } : type)),
    })],
  ])('refuses a confirm or amend once the %s is archived, on the stale path', async (_archived, archive) => {
    const calendar = archive(
      await calendarOf([calendarOverrideRow('pending-free', A, DATE, SLOBODNO, { createdAt: BEFORE_VERSIONS })]),
    );

    for (const change of [
      reviewConfirmChangeOf(rowOf('pending-free', SLOBODNO)),
      reviewAmendChangeOf(rowOf('pending-free', SLOBODNO), SLOBODNO),
    ]) {
      const check = await checkOf(calendar, change);

      expect(check).toEqual({ kind: CHECK_REFUSED, code: OVERRIDE_CHANGE_ARCHIVED });
      if (check.kind === CHECK_REFUSED) {
        expect(reviewRefusalOf(check.code)).toBe(DISPOSITION_ARCHIVED);
        expect(staleRefusalOf(reviewRefusalOf(check.code))).toBe(true);
      }
    }
  });

  it('keeps the team live in the archived-type case: the type alone refuses', async () => {
    const calendar = await calendarOf([calendarOverrideRow('pending-noc', A, DATE, NOC, { createdAt: BEFORE_VERSIONS })]);
    const archivedType: CalendarSnapshot = {
      ...calendar,
      types: calendar.types.map((type) => (type.id === SLOBODNO ? { ...type, archived: true } : type)),
    };

    expect(archivedType.teams.find((team) => team.id === A)?.archived).toBe(false);
    // Confirming the Noć override names no archived type: it goes ahead.
    expect((await checkOf(archivedType, reviewConfirmChangeOf(rowOf('pending-noc', NOC)))).kind).toBe(CHECK_READY);
    expect(await checkOf(archivedType, reviewAmendChangeOf(rowOf('pending-noc', NOC), SLOBODNO))).toEqual({
      kind: CHECK_REFUSED,
      code: OVERRIDE_CHANGE_ARCHIVED,
    });
  });
});

describe('Resolved', () => {
  it('lists nothing when the conflict was already decided', async () => {
    const calendar = await calendarOf([calendarOverrideRow('pending-free', A, DATE, SLOBODNO, { createdAt: BEFORE_VERSIONS })]);
    const resolution = { member_id: VIEWER_MEMBER, date: DATE, team_id: A, kind: 'accept_uncovered', roster_override_id: null };

    expect(await checkOf(calendar, reviewConfirmChangeOf(rowOf('pending-free', SLOBODNO)), [resolution])).toEqual({
      kind: CHECK_READY,
      rows: [],
    });
  });
});
