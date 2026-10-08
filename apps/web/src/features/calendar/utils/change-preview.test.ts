import { beforeAll, describe, expect, it, vi } from 'vitest';

import { readCalendar, type CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { overridePreviewOf, rosterPreviewOf } from '@/features/calendar/utils/change-preview';
import { OVERRIDE_NO_TYPE, ROSTER_NOBODY, dayDetailOf, type DayDetail } from '@/features/calendar/utils/day-detail';
import { initLocalization } from '@/lib/i18n';
import {
  PILOT,
  SEEDED,
  VIEWER_MEMBER,
  VIEWER_NAME,
  calendarMemberRow,
  calendarOrganizationRow,
  calendarOverrideRow,
  calendarRosterOverrideRow,
  calendarTableOf,
  memberMembershipRow,
  membersAnswerOf,
  membershipRow,
  overridesAnswerOf,
  rosterOverridesAnswerOf,
  viewerRow,
  viewerSession,
  type FixtureRows,
} from '@/features/rotation/rotation.fixture';

/**
 * Story 7.9's *Što se mijenja*, executed (AD-15): the spec's Type preview and
 * Roster preview rows. On 2026-09-10 the pilot's Smjena A works Dan
 * (07:00–19:00), B works Noć (19:00–07:00), and C and D are off.
 */

type Row = Record<string, unknown>;

const DATE = '2026-09-10';
const TWELVE_HOURS = 12 * 60;

const ANA = '00000000-0000-4000-8000-0000000000e1';
const DINO = '00000000-0000-4000-8000-0000000000e2';
const EVA = '00000000-0000-4000-8000-0000000000e3';
const IVO = '00000000-0000-4000-8000-0000000000e4';
const KARLO = '00000000-0000-4000-8000-0000000000e5';
const LUKA = '00000000-0000-4000-8000-0000000000e6';
const MARA = '00000000-0000-4000-8000-0000000000e7';

function idOf(rows: readonly Row[], index: number): string {
  const id = rows[index]?.['id'];

  if (typeof id !== 'string') throw new Error(`no row ${String(index)}`);

  return id;
}

const fixture: FixtureRows = PILOT;
const A = idOf(fixture.teams, 0);
const B = idOf(fixture.teams, 1);
const C = idOf(fixture.teams, 2);
const DAN = idOf(fixture.types, 0);
const NOC = idOf(fixture.types, 1);
const SLOBODNO = idOf(fixture.types, 2);

/** Four on B (Noć that day): Ana, Dino, Eva, Ivo; Karlo and the viewer on A (Dan); Luka and Mara on C (off). */
async function snapshotOf(overrides: readonly Row[] = [], rosterOverrides: readonly Row[] = []): Promise<CalendarSnapshot> {
  const source = calendarTableOf(
    {
      data: [
        calendarOrganizationRow(PILOT, {
          viewers: [viewerRow([membershipRow(A, SEEDED)], { role: 'admin' })],
          versions: [
            memberMembershipRow(VIEWER_MEMBER, A, SEEDED),
            memberMembershipRow(KARLO, A, SEEDED),
            memberMembershipRow(ANA, B, SEEDED),
            memberMembershipRow(DINO, B, SEEDED),
            memberMembershipRow(EVA, B, SEEDED),
            memberMembershipRow(IVO, B, SEEDED),
            memberMembershipRow(LUKA, C, SEEDED),
            memberMembershipRow(MARA, C, SEEDED),
          ],
        }),
      ],
      error: null,
      count: 1,
    },
    membersAnswerOf([
      calendarMemberRow(VIEWER_MEMBER, VIEWER_NAME),
      calendarMemberRow(ANA, 'Ana Babić'),
      calendarMemberRow(DINO, 'Dino Grgić'),
      calendarMemberRow(EVA, 'Eva Šarić'),
      calendarMemberRow(IVO, 'Ivo Horvat'),
      calendarMemberRow(KARLO, 'Karlo Jelić'),
      calendarMemberRow(LUKA, 'Luka Perić'),
      calendarMemberRow(MARA, 'Mara Kovač'),
    ]),
    overridesAnswerOf(overrides),
    rosterOverridesAnswerOf(rosterOverrides),
  );
  const outcome = await readCalendar(source, source, viewerSession());

  if (!outcome.ok) throw new Error(outcome.code);

  return outcome.snapshot;
}

function dayOf(snapshot: CalendarSnapshot, teamId: string): DayDetail {
  const detail = dayDetailOf(snapshot, teamId, DATE);

  if (detail === null) throw new Error('no day');

  return detail;
}

let snapshot: CalendarSnapshot;

beforeAll(async () => {
  await initLocalization();
  snapshot = await snapshotOf();
});

describe('the type preview (story 7.9)', () => {
  it('Type preview: Noć → Slobodno on a four-member team is −12 h for each of the four, in one group', () => {
    const preview = overridePreviewOf(snapshot, dayOf(snapshot, B), SLOBODNO, []);

    expect(preview?.type).toEqual({
      from: { name: 'Noć', range: '19:00–07:00' },
      to: { name: 'Slobodno', range: null },
    });
    expect(preview?.roster).toBeNull();
    expect(preview?.hours).toEqual([{ deltaMinutes: -TWELVE_HOURS, memberIds: [ANA, DINO, EVA, IVO] }]);
  });

  it('counts hours as Sati does: a shift accepted as uncovered is leave, so its member\'s hours do not move', () => {
    const preview = overridePreviewOf(snapshot, dayOf(snapshot, B), SLOBODNO, [{ memberId: ANA, date: DATE, teamId: B }]);

    expect(preview?.hours).toEqual([{ deltaMinutes: -TWELVE_HOURS, memberIds: [DINO, EVA, IVO] }]);
  });

  it('an off day made a working one says the type from and to, +12 h for each arriving, and no roster part', () => {
    const preview = overridePreviewOf(snapshot, dayOf(snapshot, C), DAN, []);

    expect(preview?.type).toEqual({ from: { name: 'Slobodno', range: null }, to: { name: 'Dan', range: '07:00–19:00' } });
    // Two members arrive with the type, yet a type change names nobody one by one.
    expect(preview?.roster).toBeNull();
    expect(preview?.hours).toEqual([{ deltaMinutes: TWELVE_HOURS, memberIds: [LUKA, MARA] }]);
  });

  it('the empty type choice — the placeholder — has no preview', () => {
    expect(overridePreviewOf(snapshot, dayOf(snapshot, B), OVERRIDE_NO_TYPE, [])).toBeNull();
  });

  it('a working type for another working one moves the type and no hours of equal length', () => {
    const preview = overridePreviewOf(snapshot, dayOf(snapshot, A), NOC, []);

    expect(preview?.type?.to).toEqual({ name: 'Noć', range: '19:00–07:00' });
    expect(preview?.hours).toEqual([]);
  });

  it('Same as projected: no type, or the projected one, has no preview', () => {
    const day = dayOf(snapshot, A);

    expect(overridePreviewOf(snapshot, day, '', [])).toBeNull();
    expect(overridePreviewOf(snapshot, day, DAN, [])).toBeNull();
    expect(overridePreviewOf(null, day, NOC, [])).toBeNull();
    expect(overridePreviewOf(snapshot, null, NOC, [])).toBeNull();
  });

  it('Taken: a day that already has an override has no preview, as the write would refuse it', async () => {
    const taken = await snapshotOf([calendarOverrideRow('ov-b', B, DATE, SLOBODNO)]);

    expect(overridePreviewOf(taken, dayOf(snapshot, B), DAN, [])).toBeNull();
  });
});

describe('the roster preview (story 7.9)', () => {
  it('Roster preview: Ivo off, Karlo on (who works Dan that day) — Ivo leaves, Karlo arrives, −12 h and +12 h', () => {
    const preview = rosterPreviewOf(snapshot, dayOf(snapshot, B), IVO, KARLO, []);

    expect(preview?.type).toBeNull();
    expect(preview?.roster).toEqual({ out: IVO, in: KARLO });
    expect(preview?.hours).toEqual([
      { deltaMinutes: -TWELVE_HOURS, memberIds: [IVO] },
      { deltaMinutes: TWELVE_HOURS, memberIds: [KARLO] },
    ]);
  });

  it('one side alone names that side, and the other is null', () => {
    const preview = rosterPreviewOf(snapshot, dayOf(snapshot, B), ROSTER_NOBODY, KARLO, []);

    expect(preview?.roster).toEqual({ out: null, in: KARLO });
    expect(preview?.hours).toEqual([{ deltaMinutes: TWELVE_HOURS, memberIds: [KARLO] }]);
  });

  it('shows nothing until a choice is made, and nothing for one member on both sides', () => {
    const day = dayOf(snapshot, B);

    expect(rosterPreviewOf(snapshot, day, ROSTER_NOBODY, ROSTER_NOBODY, [])).toBeNull();
    expect(rosterPreviewOf(snapshot, day, IVO, IVO, [])).toBeNull();
  });

  it('Taken: a member a live change already names has no preview', async () => {
    const taken = await snapshotOf([], [calendarRosterOverrideRow('ro-ivo', B, DATE, IVO, null)]);

    expect(rosterPreviewOf(taken, dayOf(taken, B), IVO, KARLO, [])).toBeNull();
  });

  it('a preview that cannot be derived is none, logged, never a thrown error', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const broken: CalendarSnapshot = { ...snapshot, types: [] };

    expect(rosterPreviewOf(broken, dayOf(snapshot, B), IVO, KARLO, [])).toBeNull();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
