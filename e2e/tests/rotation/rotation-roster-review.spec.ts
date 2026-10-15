import { randomBytes } from 'node:crypto';

import {
  holdRotation,
  removeSeededRotation,
  seedRosterOverride,
  seedRotationChange,
  seedTeamRotation,
  type RotationHold,
  type SeededRotation,
} from '../../utils/database-helper.ts';
import { addDays, fullDate } from '../../utils/dates.ts';
import { fill, hr } from '../../utils/i18n.ts';
import { ADMIN_STATE } from '../../utils/run-fixture.ts';
import { expect, test } from '../../utils/custom-fixtures.ts';

/**
 * 0039: a roster override a rotation change left pending is reviewed in the
 * builder's "Izmjene za pregled" as a shift-type one is (story 3.5c) —
 * confirmed, amended to another arriving member, or discarded — and the
 * calendar's day detail shows it as waiting for review until then.
 *
 * The fixture team gets a rotation from today in SQL (`[Dan, Noć, Slobodno,
 * Slobodno]`), three roster changes on D+3..D+5 written after it, and then a
 * rotation change from D+1 on the third step, saved after them: D+3 projects
 * Dan and D+4 Noć, and all three changes are pending. No leave is seeded, so
 * nothing is erased and each disposition is one click (or one dialog).
 */

test.use({ storageState: ADMIN_STATE, viewport: { width: 1280, height: 800 } });

/** The run organization's rotation, while this file's test holds it (`holdRotation`). */
let hold: RotationHold | null = null;
/** What this file's test seeded — the rotation, its change and the roster overrides — removed before the hold is released. */
let seed: SeededRotation | null = null;

test.afterEach(async () => {
  try {
    if (seed !== null) await removeSeededRotation(seed);
  } finally {
    seed = null;
    await hold?.release();
    hold = null;
  }
});

const overrides = hr.rotation.builder.overrides;
const rosterChange = hr.kalendar.detail.rosterChange;

test('a pending roster change is shown as pending, then confirmed, amended to another arrival and discarded in the review', async ({
  fixture,
  rotationPage,
  calendarPage,
}) => {
  test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
  hold = holdRotation(fixture.slug);
  await hold.ready;
  seed = await seedTeamRotation(fixture.slug, fixture.team.id, randomBytes(3).toString('hex'));
  const rotation = seed;
  const team = fixture.team.name;
  const [confirmed, amended, discarded] = [3, 4, 5].map((days) => addDays(rotation.today, days)) as [
    string,
    string,
    string,
  ];
  const reason = 'Zamjena zbog tečaja (E2E).';
  const replaced = fill(rosterChange.replaced, { out: fixture.member.name, in: fixture.spare.name });

  for (const date of [confirmed, amended]) {
    await seedRosterOverride(rotation, fixture.team.id, date, fixture.member.name, fixture.spare.name, reason);
  }
  await seedRosterOverride(rotation, fixture.team.id, discarded, fixture.member.name, null, reason);
  await seedRotationChange(rotation, fixture.team.id, addDays(rotation.today, 1), 2);

  // THE CALENDAR shows the change on D+3 as waiting for review, not applied.
  await calendarPage.goto(`?prikaz=sve&mjesec=${confirmed.slice(0, 7)}`);
  await (await calendarPage.cellOf(team, confirmed)).click();
  let detail = calendarPage.detailOf(team, confirmed);
  await expect(calendarPage.rosterPendingIn(detail)).toContainText(replaced);
  await expect(calendarPage.rosterChangesIn(detail)).toHaveCount(0);

  // THE REVIEW lists all three, each saying what it changes.
  await rotationPage.goto();
  await expect(rotationPage.overrideReviewRows).toHaveCount(3);
  await expect(rotationPage.overrideReviewRow(team, fullDate(confirmed))).toContainText(
    fill(overrides.roster.replaced, { out: fixture.member.name, in: fixture.spare.name }),
  );
  await expect(rotationPage.overrideReviewRow(team, fullDate(discarded))).toContainText(
    fill(overrides.roster.removed, { name: fixture.member.name }),
  );
  await expect(rotationPage.overrideReviewRow(team, fullDate(confirmed))).toContainText(
    fill(overrides.reason, { reason }),
  );

  // CONFIRM: nothing to erase, so one click; the row leaves the review.
  await rotationPage.confirmOverrideIn(rotationPage.overrideReviewRow(team, fullDate(confirmed))).click();
  await expect(rotationPage.statusWith(overrides.done.confirmed)).toBeVisible();
  await expect(rotationPage.overrideReviewRows).toHaveCount(2);

  // AMEND WHO ARRIVES: the calendar's candidates, never the member taken off or the one already put on.
  await rotationPage.amendOverrideIn(rotationPage.overrideReviewRow(team, fullDate(amended))).click();
  const amend = rotationPage.rosterAmendDialogOf(team, fullDate(amended));
  await expect(amend).toBeVisible();
  await expect(rotationPage.amendReasonIn(amend)).toHaveValue(reason);
  const offered = await rotationPage.amendMemberNamesIn(amend);
  expect(offered).not.toContain(fixture.member.name);
  expect(offered).not.toContain(fixture.spare.name);
  const arriving = offered[0];
  expect(arriving, 'the amend offers nobody to put on').toBeDefined();
  await rotationPage.amendRosterOverride(amend, arriving ?? '', 'Druga zamjena (E2E).');
  await expect(amend).toHaveCount(0);
  await expect(rotationPage.statusWith(overrides.done.amended)).toBeVisible();
  await expect(rotationPage.overrideReviewRows).toHaveCount(1);

  // DISCARD: one neutral confirmation naming the team and the date.
  await rotationPage.discardOverrideIn(rotationPage.overrideReviewRow(team, fullDate(discarded))).click();
  const discard = rotationPage.rosterDiscardConfirmOf(team, fullDate(discarded));
  await expect(discard).toBeVisible();
  await rotationPage.confirmDiscardIn(discard).click();
  await expect(rotationPage.statusWith(overrides.done.discarded)).toBeVisible();
  await expect(rotationPage.overrideReview).toHaveCount(0);

  // THE CALENDAR follows: the confirmed change and the amended one are applied.
  await calendarPage.goto(`?prikaz=sve&mjesec=${confirmed.slice(0, 7)}`);
  await (await calendarPage.cellOf(team, confirmed)).click();
  detail = calendarPage.detailOf(team, confirmed);
  await expect(calendarPage.rosterChangesIn(detail)).toContainText(replaced);
  await expect(calendarPage.rosterPendingIn(detail)).toHaveCount(0);
  await calendarPage.closeIn(detail).click();
  await calendarPage.goto(`?prikaz=sve&mjesec=${amended.slice(0, 7)}`);
  await (await calendarPage.cellOf(team, amended)).click();
  detail = calendarPage.detailOf(team, amended);
  await expect(calendarPage.rosterChangesIn(detail)).toContainText(
    fill(rosterChange.replaced, { out: fixture.member.name, in: arriving ?? '' }),
  );
});
