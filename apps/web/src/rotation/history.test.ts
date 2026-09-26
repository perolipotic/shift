import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { initLocalization, t } from '@/i18n';
import {
  HISTORY_IN_FORCE,
  HISTORY_PREVIOUS,
  HISTORY_SCHEDULED,
  rotationHistoryAuthorMessageKey,
  rotationHistoryOf,
  rotationHistoryStatusMessageKey,
  scheduledChangeOf,
  type RotationHistoryStatus,
} from '@/rotation/history';
import { readRotation, type RotationSnapshot } from '@/rotation/list';
import {
  ADMIN,
  ADMIN_NAME,
  PILOT,
  SEEDED,
  TODAY,
  UJ5,
  answerOf,
  assignmentRow,
  memberRow,
  stepRow,
  type FixtureRows,
} from '@/rotation/rotation.fixture';

/**
 * Story 2.6's `Povijest rotacije`, executed rather than read (AD-15): one row
 * per saved change, newest first, its status in words, its author by name or
 * as unknown, the save time in the organization's zone, and the team count in
 * all three plural forms — over both fixtures.
 */

async function snapshotOf(rows: FixtureRows): Promise<RotationSnapshot> {
  const outcome = await readRotation({ select: () => Promise.resolve(answerOf(rows)) });

  if (!outcome.ok) throw new Error(outcome.code);

  return outcome.snapshot;
}

const SECOND_ADMIN = '00000000-0000-4000-8000-0000000000a2';
const YESTERDAY = '2026-09-25';
const NEXT_WEEK = '2026-10-03';

/** A change saved for every team of `rows` on a new two-step pattern. */
function changed(rows: FixtureRows, patternId: string, effectiveFrom: string, createdBy: string, createdAt: string): FixtureRows {
  const firstType = String(rows.types[0]?.['id']);

  return {
    ...rows,
    steps: [...rows.steps, stepRow(`${patternId}-0`, patternId, 0, firstType), stepRow(`${patternId}-1`, patternId, 1, firstType)],
    assignments: [
      ...rows.assignments,
      ...rows.teams.map((team) =>
        assignmentRow(String(team['id']), patternId, `${patternId}-0`, TODAY, effectiveFrom, undefined, {
          createdBy,
          createdAt,
        }),
      ),
    ],
  };
}

describe('the history', () => {
  it.each([
    { fixture: 'pilot', rows: PILOT, teams: 4 },
    { fixture: 'UJ-5', rows: UJ5, teams: 3 },
  ])('$fixture as seeded: one change, in force, by the admin, every team', async ({ rows, teams }) => {
    const history = rotationHistoryOf(await snapshotOf(rows), TODAY);

    expect(history).toEqual([
      {
        key: `${String(rows.assignments[0]?.['pattern_id'])}:${SEEDED}`,
        effectiveFrom: SEEDED,
        effectiveLabel: '01.01.2020',
        author: ADMIN_NAME,
        // 2019-12-20 09:15 UTC is 10:15 in Zagreb (CET).
        savedDate: '20.12.2019',
        savedTime: '10:15',
        status: HISTORY_IN_FORCE,
        teamCount: teams,
      },
    ]);
  });

  it.each([
    { fixture: 'pilot', rows: PILOT },
    { fixture: 'UJ-5', rows: UJ5 },
  ])('$fixture: a change today, then one from next week — newest first, zakazano, na snazi, prethodno', async ({ rows }) => {
    const today = changed(rows, 'today-rotation', TODAY, ADMIN, '2026-09-26T06:00:00+00:00');
    const snapshot = await snapshotOf({
      ...changed(today, 'next-rotation', NEXT_WEEK, SECOND_ADMIN, '2026-09-26T07:30:00+00:00'),
      members: [memberRow(ADMIN, ADMIN_NAME), memberRow(SECOND_ADMIN, 'Josip Perić')],
    });
    const history = rotationHistoryOf(snapshot, TODAY);

    expect(history.map((row) => [row.effectiveFrom, row.status, row.author, row.savedTime])).toEqual([
      [NEXT_WEEK, HISTORY_SCHEDULED, 'Josip Perić', '09:30'],
      [TODAY, HISTORY_IN_FORCE, ADMIN_NAME, '08:00'],
      [SEEDED, HISTORY_PREVIOUS, ADMIN_NAME, '10:15'],
    ]);
    // On the scheduled date the order holds and the statuses move on.
    expect(rotationHistoryOf(snapshot, NEXT_WEEK).map((row) => row.status)).toEqual([
      HISTORY_IN_FORCE,
      HISTORY_PREVIOUS,
      HISTORY_PREVIOUS,
    ]);
  });

  it('a cancelled change is gone, and the version before it is na snazi again', async () => {
    const scheduled = changed(PILOT, 'next-rotation', NEXT_WEEK, ADMIN, '2026-09-26T07:30:00+00:00');

    expect(rotationHistoryOf(await snapshotOf(scheduled), TODAY).map((row) => row.status)).toEqual([
      HISTORY_SCHEDULED,
      HISTORY_IN_FORCE,
    ]);
    expect(rotationHistoryOf(await snapshotOf(PILOT), TODAY).map((row) => row.status)).toEqual([HISTORY_IN_FORCE]);
  });

  it('orders two changes on one date by when they were saved', async () => {
    // Two patterns from one date cannot both be stored for one team, but a
    // second change may bind a team the first did not.
    const rows: FixtureRows = {
      ...PILOT,
      steps: [...PILOT.steps, stepRow('late-0', 'late', 0, 'pilot-dan')],
      assignments: [
        ...PILOT.assignments.filter((row) => row['team_id'] !== 'pilot-smjena-d'),
        assignmentRow('pilot-smjena-d', 'late', 'late-0', SEEDED, SEEDED, undefined, {
          createdAt: '2019-12-21T09:15:00+00:00',
        }),
      ],
    };
    const history = rotationHistoryOf(await snapshotOf(rows), TODAY);

    expect(history.map((row) => [row.key, row.teamCount])).toEqual([
      [`late:${SEEDED}`, 1],
      [`pilot-rotation:${SEEDED}`, 3],
    ]);
  });

  it('names an author the members embed lacks as unknown, through its own key', async () => {
    const history = rotationHistoryOf(await snapshotOf({ ...PILOT, members: [] }), TODAY);

    expect(history[0]?.author).toBeNull();
    expect(rotationHistoryAuthorMessageKey()).toBe('rotation.builder.history.unknownAuthor');
  });

  it('reads the save time in the organization zone, never the device one', async () => {
    const snapshot = await snapshotOf(changed(PILOT, 'late', YESTERDAY, ADMIN, '2026-09-25T22:30:00+00:00'));

    expect(rotationHistoryOf(snapshot, TODAY)[0]).toMatchObject({ savedDate: '26.09.2026', savedTime: '00:30' });
    expect(rotationHistoryOf({ ...snapshot, timeZone: 'UTC' }, TODAY)[0]).toMatchObject({
      savedDate: '25.09.2026',
      savedTime: '22:30',
    });
  });

  it('is empty for an organization with no rotation', async () => {
    expect(rotationHistoryOf(await snapshotOf({ ...PILOT, assignments: [] }), TODAY)).toEqual([]);
  });

  it('names the scheduled change the cancel is offered for, or none', async () => {
    expect(scheduledChangeOf(await snapshotOf(PILOT), TODAY)).toBeNull();
    expect(scheduledChangeOf(await snapshotOf(changed(PILOT, 'next', NEXT_WEEK, ADMIN, '2026-09-26T07:30:00+00:00')), TODAY)).toEqual({
      effectiveFrom: NEXT_WEEK,
      label: '03.10.2026',
    });
  });
});

describe('the messages', () => {
  const resource = JSON.parse(readFileSync(new URL('../i18n/locales/hr.json', import.meta.url), 'utf8')) as Record<
    string,
    unknown
  >;
  const messageAt = (key: string): unknown =>
    key.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], resource);

  it('gives every status its own key, in words', () => {
    const statuses: RotationHistoryStatus[] = [HISTORY_SCHEDULED, HISTORY_IN_FORCE, HISTORY_PREVIOUS];
    const keys = statuses.map(rotationHistoryStatusMessageKey);

    expect(new Set(keys).size).toBe(3);
    expect(keys.map(messageAt)).toEqual(['zakazano', 'na snazi', 'prethodno']);
    expect(typeof messageAt(rotationHistoryAuthorMessageKey())).toBe('string');
  });

  it('counts the teams in all three plural forms', async () => {
    await initLocalization();

    expect([1, 2, 5, 21].map((count) => t('rotation.builder.history.teamCount', { count }))).toEqual([
      '1 smjena',
      '2 smjene',
      '5 smjena',
      '21 smjena',
    ]);
  });
});
