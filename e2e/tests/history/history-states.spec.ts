import { randomBytes } from 'node:crypto';

import { HistoryPage } from '../../pages/history.page.ts';
import {
  backdateHistoryOfRowInSql,
  removeLeaveMemberInSql,
  removeTeamInSql,
  renameTeamInSql,
  renameTeamRepeatedlyInSql,
  seedExtraTeam,
  seedLeaveMember,
  seedLeaveRequest,
} from '../../utils/database-helper.ts';
import { fill, hr } from '../../utils/i18n.ts';
import { ADMIN_STATE } from '../../utils/run-fixture.ts';
import { expect, test } from '../../utils/custom-fixtures.ts';

/**
 * Epic 14 retro A9: *Povijest promjena*'s states the 14.2 e2e left out. A
 * refused read shows one alert and a retry that brings the rows back; chips
 * that leave none of the period's entries say so and offer *Poništi filtre*;
 * a period of 1101 events, past one keyset page of 1000 with the boundary
 * inside a tie on `occurred_at`, is read whole against real PostgREST and
 * drawn 200 rows at a time, *Prikaži još* adding 200; and a member deleted
 * before the period is named from their DELETE event, read beside it. No spec
 * assumes `audit_events` is empty.
 */

const history = hr.history;

test.describe('an admin', () => {
  test.use({ storageState: ADMIN_STATE });

  test('a refused history read shows the unavailable alert, and the retry brings the rows back', async ({ page }) => {
    const events = '**/rest/v1/audit_events*';
    await page.route(events, (route) => route.fulfill({ status: 500, body: '{}' }));

    const historyPage = new HistoryPage(page);

    await historyPage.goto();
    // The read retries once, a second later, before the page gives up.
    await expect(historyPage.unavailableAlert).toBeVisible({ timeout: 15_000 });
    await expect(historyPage.table).toHaveCount(0);
    await expect(historyPage.retryButton).toBeVisible();

    await page.unroute(events);
    await historyPage.retryButton.click();
    await expect(historyPage.table).toBeVisible();
    await expect(historyPage.unavailableAlert).toHaveCount(0);
  });

  test('chips that leave none of the period say so, and Poništi filtre shows the period again', async ({
    page,
    fixture,
  }) => {
    const suffix = randomBytes(3).toString('hex');
    // A team only added, and one renamed, so `team:changed` is offered while
    // the first team has no such entry.
    const added = await seedExtraTeam(fixture.slug, `Povijest filtri ${suffix}`);
    const renamed = await seedExtraTeam(fixture.slug, `Povijest filtri ${suffix} b`);

    try {
      await renameTeamInSql(fixture.slug, renamed.id, `${renamed.name} novo`);

      const historyPage = new HistoryPage(page);

      await historyPage.goto(`?smjena=${added.id}&vrsta=team:changed`);
      await expect(page).toHaveURL(new RegExp(`[?&]smjena=${added.id}`));
      await expect(historyPage.filteredLine).toBeVisible();
      await expect(historyPage.bodyRows).toHaveCount(1);

      await historyPage.clearFiltersButton.click();
      await expect(page).toHaveURL(/\/povijest-promjena$/);
      await expect(historyPage.filteredLine).toHaveCount(0);
      await expect(historyPage.rowNaming(added.name)).not.toHaveCount(0);
    } finally {
      await removeTeamInSql(fixture.slug, added.id);
      await removeTeamInSql(fixture.slug, renamed.id);
    }
  });

  test('reads a period past one keyset page, ties on occurred_at included, and draws it 200 rows at a time', async ({
    page,
    fixture,
  }) => {
    test.setTimeout(120_000);

    const suffix = randomBytes(3).toString('hex');
    const prefix = `Povijest stranice ${suffix}`;
    const team = await seedExtraTeam(fixture.slug, prefix);
    const renames = 1100;
    // The team's INSERT and its renames: 1101 events, newest first, so the
    // first page holds renames 1100 to 101 and the second 100 to 1 and the INSERT.
    const total = renames + 1;
    /** The rename to `${prefix} ${index}`: from the bare prefix for the first, else from the one before. */
    const renameText = (index: number): string =>
      historyPage.changeText(
        history.field.name,
        index === 1 ? prefix : `${prefix} ${String(index - 1)}`,
        `${prefix} ${String(index)}`,
      );
    const historyPage = new HistoryPage(page);

    try {
      // 200 days back, in the renames' own transaction: out of the default 30
      // days other specs read, inside 365.
      await renameTeamRepeatedlyInSql(fixture.slug, team.id, prefix, renames, 200);

      const added = historyPage.kindText(history.record.team, history.action.added);

      await historyPage.goto(`?smjena=${team.id}&razdoblje=365-dana`);
      await expect(historyPage.partialLine(200, total)).toBeVisible({ timeout: 30_000 });
      await expect(historyPage.bodyRows).toHaveCount(200);
      // The newest rename first; the INSERT, on the second page, not yet drawn.
      await expect(historyPage.bodyRows.first()).toContainText(renameText(renames));
      await expect(historyPage.rowNaming(added)).toHaveCount(0);

      for (const shown of [400, 600, 800, 1000]) {
        await historyPage.showMoreButton.click();
        await expect(historyPage.bodyRows).toHaveCount(shown);
        await expect(historyPage.partialLine(shown, total)).toBeVisible();
      }

      // The last step: every event once, the button gone and its focus on the line.
      await historyPage.showMoreButton.click();
      await expect(historyPage.bodyRows).toHaveCount(total);
      await expect(historyPage.partialLine(total, total)).toBeFocused();
      await expect(historyPage.showMoreButton).toHaveCount(0);

      // ACROSS THE PAGE BOUNDARY, inside the tie: row 1000 is rename 101 and
      // row 1001 rename 100, ordered by id alone; each rename once; the INSERT last.
      await expect(historyPage.bodyRows.nth(999)).toContainText(renameText(101));
      await expect(historyPage.bodyRows.nth(1000)).toContainText(renameText(100));
      await expect(historyPage.rowNaming(renameText(101))).toHaveCount(1);
      await expect(historyPage.rowNaming(renameText(100))).toHaveCount(1);
      await expect(historyPage.rowNaming(renameText(1))).toHaveCount(1);
      await expect(historyPage.bodyRows.last()).toContainText(added);
      await expect(historyPage.rowNaming(added)).toHaveCount(1);
    } finally {
      await removeTeamInSql(fixture.slug, team.id);
    }
  });

  test('names a member deleted before the period from their DELETE event, as subject and chip (epic 14 retro A9)', async ({
    page,
    fixture,
  }) => {
    const member = await seedLeaveMember(fixture.slug, null, '', 20);
    let removed = false;

    try {
      // A request names the member in the period. Then the member is deleted
      // (the auth user, cascading to the row) and every `members` event of
      // theirs, the DELETE included, moves 400 days back: only the DELETE read
      // beside the period can name them now.
      await seedLeaveRequest(fixture.slug, member.id, '2030-02-04', '2030-02-05');
      await removeLeaveMemberInSql(fixture.slug, member.id);
      removed = true;
      await backdateHistoryOfRowInSql(fixture.slug, 'members', member.id, 400);

      const historyPage = new HistoryPage(page);

      await historyPage.goto(`?osoba=${member.id}`);
      await expect(page).toHaveURL(new RegExp(`[?&]osoba=${member.id}`));
      await expect(historyPage.chip(fill(history.chip.member, { value: member.name }))).toBeVisible();
      await expect(historyPage.rowNaming(member.name)).not.toHaveCount(0);
      await expect(historyPage.rowNaming(history.value.unknownMember)).toHaveCount(0);
    } finally {
      if (!removed) await removeLeaveMemberInSql(fixture.slug, member.id);
    }
  });
});
