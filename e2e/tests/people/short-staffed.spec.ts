import { randomBytes } from 'node:crypto';

import {
  holdRotation,
  removeLeaveMemberInSql,
  removeSeededRotation,
  removeTeamInSql,
  seedExtraTeam,
  seedLeaveMember,
  seedTeamRotation,
  setMinimumMembersInSql,
  type RotationHold,
  type SeededLeaveMember,
  type SeededRotation,
} from '../../utils/database-helper.ts';
import { dayMonth } from '../../utils/dates.ts';
import { ADMIN_STATE } from '../../utils/run-fixture.ts';
import { fill, hr, plural } from '../../utils/i18n.ts';
import { expect, test } from '../../utils/custom-fixtures.ts';

/**
 * Story 11.2: a save that can newly leave a working shift short of people
 * says so in its *Što se mijenja*, and never holds the save. A team of the
 * test's own gets the seeded rotation from today (`[Dan, Noć, Slobodno,
 * Slobodno]`) under the run's rotation hold, and one fresh member on it, so
 * with *Najmanje ljudi u smjeni* at 1 a leave record for today leaves nobody
 * at work: `Smjena …, dd.mm. Dan: ne radi nitko od najmanje 1`. The record
 * saves as it always did. With the setting empty the same range shows no
 * block at all.
 *
 * The run's organization is shared, so the setting is set in SQL for each
 * case and restored after it; the file runs serially.
 */

test.use({ storageState: ADMIN_STATE });
test.describe.configure({ mode: 'serial' });

const leave = hr.ljudi.leaveRecord;
const staffing = hr.popunjenost;

let hold: RotationHold | null = null;
let seed: SeededRotation | null = null;
let written: { slug: string; members: string[]; teams: string[] } = { slug: '', members: [], teams: [] };

test.afterEach(async () => {
  try {
    if (seed !== null) await removeSeededRotation(seed);
  } finally {
    seed = null;
    const own = written;
    written = { slug: '', members: [], teams: [] };
    try {
      for (const id of own.members) await removeLeaveMemberInSql(own.slug, id);
      for (const id of own.teams) await removeTeamInSql(own.slug, id);
    } finally {
      await hold?.release();
      hold = null;
    }
  }
});

/** A team of the test's own on the seeded rotation from today, and one member on it. */
async function seeded(slug: string): Promise<{
  readonly member: SeededLeaveMember;
  readonly team: { readonly id: string; readonly name: string };
  readonly rotation: SeededRotation;
}> {
  hold = holdRotation(slug);
  await hold.ready;
  const suffix = randomBytes(3).toString('hex');
  const team = await seedExtraTeam(slug, `Smjena ${suffix}`);
  written = { slug, members: [], teams: [team.id] };
  seed = await seedTeamRotation(slug, team.id, suffix);
  const member = await seedLeaveMember(slug, team.id, seed.today, 20);
  written.members.push(member.id);

  return { member, team, rotation: seed };
}

/** People at work against the minimum, as `popunjenost.atWork` words zero: `ne radi nitko od najmanje 1`. */
function nobodyAtWork(minimum: number): string {
  const zero = /=0 \{([^}]*)\}/.exec(staffing.atWork)?.[1];
  if (zero === undefined) throw new Error('E2E: popunjenost.atWork has no zero form');

  // The tail after the plural block's closing `}}`: ` od najmanje {minimum}`.
  const close = staffing.atWork.indexOf('}}');
  if (close === -1) throw new Error('E2E: popunjenost.atWork has no closing plural block');

  return `${zero}${fill(staffing.atWork.slice(close + 2), { minimum: String(minimum) })}`;
}

test('a leave record that leaves nobody at work shows the block, and Spremi saves', async ({ peoplePage, fixture }) => {
  test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
  const { member, team, rotation } = await seeded(fixture.slug);
  const today = rotation.today;
  const was = await setMinimumMembersInSql(fixture.slug, 1);
  try {
    await peoplePage.gotoMember(member.id);
    await peoplePage.recordLeaveButton.click();
    await peoplePage.enterLeave(today, today);

    const region = peoplePage.leavePreviewRegion;
    const row = fill(staffing.row, {
      team: team.name,
      date: dayMonth(today),
      type: rotation.steps[0] ?? '',
      atWork: nobodyAtWork(1),
    });
    // INSIDE THE POLITE LIVE REGION, with its heading: a block, never an alert.
    await expect(region.getByText(staffing.heading, { exact: true })).toBeVisible();
    await expect(region.getByText(row, { exact: true })).toBeVisible();
    await expect(region.locator('[data-short-staffed] [data-icon]')).toHaveCount(1);
    await expect(peoplePage.leaveRecordDialog.getByRole('alert')).toHaveCount(0);

    // NEVER A GATE: the save goes through unchanged.
    await expect(peoplePage.saveLeaveButton).toBeEnabled();
    await peoplePage.saveLeaveButton.click();
    await expect(peoplePage.statusWith(plural(leave.saved, 1))).toBeVisible();
    await expect(peoplePage.leaveDialog).toHaveCount(0);
  } finally {
    await setMinimumMembersInSql(fixture.slug, was);
  }
});

test('with the setting empty the same range shows no block and no line', async ({ peoplePage, fixture }) => {
  test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
  const { member, rotation } = await seeded(fixture.slug);
  const today = rotation.today;
  const was = await setMinimumMembersInSql(fixture.slug, null);
  try {
    await peoplePage.gotoMember(member.id);
    await peoplePage.recordLeaveButton.click();
    await peoplePage.enterLeave(today, today);

    const region = peoplePage.leavePreviewRegion;
    // The preview is drawn — its conflict line is there — and says nothing about staffing.
    await expect(region.getByText(plural(leave.conflictsCreated, 1), { exact: true })).toBeVisible();
    await expect(region.getByText(staffing.heading, { exact: true })).toHaveCount(0);
    await expect(region.getByText(staffing.unknown, { exact: true })).toHaveCount(0);
  } finally {
    await setMinimumMembersInSql(fixture.slug, was);
  }
});
