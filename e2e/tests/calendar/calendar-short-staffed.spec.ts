import { randomBytes } from 'node:crypto';

import type { Locator } from '@playwright/test';

import type { CalendarPage } from '../../pages/calendar.page.ts';
import {
  holdRotation,
  removeLeaveMemberInSql,
  removeSeededRotation,
  removeTeamInSql,
  seedExtraTeam,
  seedLeaveMember,
  seedLeaveRecord,
  seedTeamRotation,
  setMinimumMembersInSql,
  type RotationHold,
  type SeededRotation,
} from '../../utils/database-helper.ts';
import { addDays, dayMonth } from '../../utils/dates.ts';
import { escapeRegExp, fill, hr, icu } from '../../utils/i18n.ts';
import { ADMIN_STATE } from '../../utils/run-fixture.ts';
import { expect, test } from '../../utils/custom-fixtures.ts';

/**
 * Story 11.2 on the day detail: a roster change that leaves a working shift
 * under *Najmanje ljudi u smjeni* shows the short-staffed block in its *Što
 * se mijenja* before the save, and the save still lands.
 *
 * Under the run's rotation hold, a team of the test's own gets the seeded
 * rotation from today (`[Dan, Noć, Slobodno, Slobodno]`) and one fresh member
 * on it, with no leave, so nothing waits for a decision. With the setting at 1,
 * taking that member off today + 4 (a Dan) leaves nobody at work: `Smjena …,
 * dd.mm. Dan: ne radi nitko od najmanje 1`. The setting is set in SQL for the
 * case and restored after it; everything written is removed in `afterEach`.
 *
 * Story 11.3 on the grid and the day detail: a team of four with two of them
 * on leave on a Dan, the minimum at 3, is marked short-staffed — the cell's
 * label ends `Premalo ljudi`, the legend lists it, and the detail says
 * `Premalo ljudi: rade 2 od najmanje 3`. With the setting empty, none of them
 * does.
 */

test.use({ storageState: ADMIN_STATE, viewport: { width: 1280, height: 900 } });
test.describe.configure({ mode: 'serial' });

const rosterChange = hr.kalendar.detail.rosterChange;
const staffing = hr.popunjenost;
const REASON = 'Premještaj (E2E).';

let hold: RotationHold | null = null;
let seed: SeededRotation | null = null;
let written: { readonly slug: string; members: string[]; teams: string[] } | null = null;

test.afterEach(async () => {
  // EVERY STEP RUNS, whichever fails; the first failure is reported once all have run.
  const failures: unknown[] = [];
  const attempt = async (step: () => Promise<void>): Promise<void> => {
    try {
      await step();
    } catch (cause) {
      failures.push(cause);
    }
  };
  const seeded = seed;
  const own = written;

  // The seed first: it deletes every roster override, which names the member.
  if (seeded !== null) await attempt(() => removeSeededRotation(seeded));
  for (const id of own?.members ?? []) await attempt(() => removeLeaveMemberInSql(own?.slug ?? '', id));
  for (const id of own?.teams ?? []) await attempt(() => removeTeamInSql(own?.slug ?? '', id));
  seed = null;
  written = null;
  await attempt(async () => {
    await hold?.release();
  });
  hold = null;
  if (failures.length > 0) throw failures[0];
});

/** People at work against the minimum, as `popunjenost.atWork` words zero: `ne radi nitko od najmanje 1`. */
function nobodyAtWork(minimum: number): string {
  const zero = /=0 \{([^}]*)\}/.exec(staffing.atWork)?.[1];
  if (zero === undefined) throw new Error('E2E: popunjenost.atWork has no zero form');
  // The tail after the plural block's closing `}}`: ` od najmanje {minimum}`.
  const close = staffing.atWork.indexOf('}}');
  if (close === -1) throw new Error('E2E: popunjenost.atWork has no closing plural block');

  return `${zero}${fill(staffing.atWork.slice(close + 2), { minimum: String(minimum) })}`;
}

/** Opens the day detail of `team` on `date`, on the grid of its month. */
async function openDay(calendarPage: CalendarPage, teamName: string, date: string): Promise<Locator> {
  await calendarPage.goto(`?prikaz=sve&mjesec=${date.slice(0, 7)}`);
  await (await calendarPage.cellOf(teamName, date)).click();
  const detail = calendarPage.detailOf(teamName, date);
  await expect(detail).toBeVisible();

  return detail;
}

test('taking the only member off a Dan shows the short-staffed block, and the save lands', async ({ fixture, calendarPage }) => {
  test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
  hold = holdRotation(fixture.slug);
  await hold.ready;
  const own: { readonly slug: string; members: string[]; teams: string[] } = { slug: fixture.slug, members: [], teams: [] };
  written = own;
  const suffix = randomBytes(3).toString('hex');
  const team = await seedExtraTeam(fixture.slug, `Smjena ${suffix}`);
  own.teams.push(team.id);
  seed = await seedTeamRotation(fixture.slug, team.id, suffix);
  const rotation = seed;
  const person = await seedLeaveMember(fixture.slug, team.id, rotation.today, 20);
  own.members.push(person.id);
  const date = addDays(rotation.today, 4);

  const was = await setMinimumMembersInSql(fixture.slug, 1);
  try {
    const detail = await openDay(calendarPage, team.name, date);
    const form = await calendarPage.openRosterFormIn(detail);
    await calendarPage.chooseIn(calendarPage.rosterOutIn(form), person.name);

    // IN *ŠTO SE MIJENJA*, its polite `<output>`: the heading, the row, the glyph — never an alert.
    const preview = calendarPage.previewIn(form);
    await expect(preview.getByText(staffing.heading, { exact: true })).toBeVisible();
    await expect(
      preview.getByText(
        fill(staffing.row, { team: team.name, date: dayMonth(date), type: rotation.steps[0], atWork: nobodyAtWork(1) }),
        { exact: true },
      ),
    ).toBeVisible();
    await expect(preview.locator('[data-short-staffed] [data-icon]')).toHaveCount(1);
    await expect(form.getByRole('alert')).toHaveCount(0);

    // NEVER A GATE: the save goes through as it always did.
    await calendarPage.rosterReasonIn(form).fill(REASON);
    await calendarPage.rosterSaveIn(form).click();
    await expect(form).toHaveCount(0);
    await expect(calendarPage.statusIn(detail)).toContainText(rosterChange.saved);
    await expect(calendarPage.rosterChangesIn(detail)).toContainText(fill(rosterChange.removed, { name: person.name }));
  } finally {
    await setMinimumMembersInSql(fixture.slug, was);
  }
});

/**
 * Story 11.3's setup: the hold, a team of the test's own on the seeded
 * rotation from today with four fresh members, and `away` of them (two by
 * default) on leave over today + 4 (a Dan).
 */
async function teamOfFourTwoOnLeave(slug: string, away = 2): Promise<{
  readonly team: { readonly id: string; readonly name: string };
  readonly rotation: SeededRotation;
  readonly date: string;
}> {
  hold = holdRotation(slug);
  await hold.ready;
  const own: { readonly slug: string; members: string[]; teams: string[] } = { slug, members: [], teams: [] };
  written = own;
  const suffix = randomBytes(3).toString('hex');
  const team = await seedExtraTeam(slug, `Smjena ${suffix}`);
  own.teams.push(team.id);
  seed = await seedTeamRotation(slug, team.id, suffix);
  const rotation = seed;
  const date = addDays(rotation.today, 4);
  for (let index = 0; index < 4; index += 1) {
    const person = await seedLeaveMember(slug, team.id, rotation.today, 20);
    own.members.push(person.id);
    if (index < away) await seedLeaveRecord(slug, person.id, date, date);
  }

  return { team, rotation, date };
}

const SHORT = hr.kalendar.modifier.shortStaffed;

/** The day detail's people-at-work line, by its stable hook: any, the short one, or the one that is not. */
function staffingLineIn(detail: Locator, short?: boolean): Locator {
  return detail.locator(short === undefined ? '[data-day-staffing]' : `[data-day-staffing="${String(short)}"]`);
}

test('a shift two of four are away from, the minimum at 3, is marked on the grid, the legend and the detail', async ({
  fixture,
  calendarPage,
}) => {
  test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
  const { team, rotation, date } = await teamOfFourTwoOnLeave(fixture.slug);
  const was = await setMinimumMembersInSql(fixture.slug, 3);
  try {
    await calendarPage.goto(`?prikaz=sve&mjesec=${date.slice(0, 7)}`);
    const cell = await calendarPage.cellOf(team.name, date);

    // THE CELL: its full label ends with the mark's name — after the type, its
    // times and the conflict and leave the two records raise — and it carries
    // the glyph and the edge, in a ring precomposed with it.
    await expect(cell).toHaveAccessibleName(
      new RegExp(`, ${escapeRegExp(rotation.steps[0])}, ${escapeRegExp(rotation.ranges[0] ?? '')}(, [^,]+)*, ${escapeRegExp(SHORT)}$`),
    );
    await expect(cell.locator('svg[data-icon="users-three-bold"]')).toHaveCount(1);
    await expect(cell.locator('[class*="-short-staffed"]')).toHaveCount(1);

    // THE LEGEND names it.
    await expect(calendarPage.legendOf().heading).toBeVisible();
    expect(await calendarPage.legendNames()).toContain(SHORT);

    // THE DETAIL states it in numbers, under *Sastav*.
    await cell.click();
    const detail = calendarPage.detailOf(team.name, date);
    await expect(detail).toBeVisible();
    await expect(staffingLineIn(detail)).toHaveCount(1);
    await expect(staffingLineIn(detail, true)).toHaveText(
      fill(staffing.dayShort, { atWork: icu(staffing.atWork, { atWork: 2, minimum: 3 }) }),
    );
    await expect(staffingLineIn(detail, true).locator('[data-icon]')).toHaveCount(1);
    await expect(detail.getByRole('alert')).toHaveCount(0);
  } finally {
    await setMinimumMembersInSql(fixture.slug, was);
  }
});

test('with the setting empty, the same shift carries no mark, no legend entry and no line', async ({ fixture, calendarPage }) => {
  test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
  const { team, date } = await teamOfFourTwoOnLeave(fixture.slug);
  const was = await setMinimumMembersInSql(fixture.slug, null);
  try {
    await calendarPage.goto(`?prikaz=sve&mjesec=${date.slice(0, 7)}`);
    const cell = await calendarPage.cellOf(team.name, date);

    // The conflict and leave marks are there, so the legend is: only short-staffed is not.
    await expect(cell).toHaveAccessibleName(new RegExp(`, ${escapeRegExp(hr.kalendar.modifier.leave)}$`));
    await expect(cell).not.toHaveAccessibleName(new RegExp(`, ${escapeRegExp(SHORT)}(,|$)`));
    await expect(cell.locator('svg[data-icon="users-three-bold"]')).toHaveCount(0);
    await expect(calendarPage.legendOf().heading).toBeVisible();
    expect(await calendarPage.legendNames()).not.toContain(SHORT);

    await cell.click();
    const detail = calendarPage.detailOf(team.name, date);
    await expect(detail).toBeVisible();
    await expect(calendarPage.rosterHeadingIn(detail)).toBeVisible();
    await expect(staffingLineIn(detail)).toHaveCount(0);
  } finally {
    await setMinimumMembersInSql(fixture.slug, was);
  }
});

test('one of four away, the minimum at 3: no mark, and the detail states the bare line', async ({ fixture, calendarPage }) => {
  test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
  const { team, date } = await teamOfFourTwoOnLeave(fixture.slug, 1);
  const was = await setMinimumMembersInSql(fixture.slug, 3);
  try {
    await calendarPage.goto(`?prikaz=sve&mjesec=${date.slice(0, 7)}`);
    const cell = await calendarPage.cellOf(team.name, date);

    await expect(cell).not.toHaveAccessibleName(new RegExp(`, ${escapeRegExp(SHORT)}(,|$)`));
    await expect(cell.locator('svg[data-icon="users-three-bold"]')).toHaveCount(0);

    await cell.click();
    const detail = calendarPage.detailOf(team.name, date);
    await expect(detail).toBeVisible();
    await expect(staffingLineIn(detail)).toHaveCount(1);
    await expect(staffingLineIn(detail, false)).toHaveText(icu(staffing.atWork, { atWork: 3, minimum: 3 }));
    await expect(staffingLineIn(detail, false).locator('[data-icon]')).toHaveCount(0);
    await expect(detail.getByText(SHORT, { exact: false })).toHaveCount(0);
  } finally {
    await setMinimumMembersInSql(fixture.slug, was);
  }
});
