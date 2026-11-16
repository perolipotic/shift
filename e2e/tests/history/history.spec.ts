import { randomBytes, randomUUID } from 'node:crypto';

import { FilterBarParts } from '../../pages/filter-bar.ts';
import { HistoryPage } from '../../pages/history.page.ts';
import { removeTeamInSql, renameTeamInSql, seedExtraTeam } from '../../utils/database-helper.ts';
import { escapeRegExp, fill, hr } from '../../utils/i18n.ts';
import { expectNoHorizontalScroll } from '../../utils/layout.ts';
import { ADMIN_STATE, MEMBER_STATE } from '../../utils/run-fixture.ts';
import { expect, test } from '../../utils/custom-fixtures.ts';

/**
 * Story 14.2: an admin reads the change history. A team of the spec's own is
 * written and renamed in SQL — 0061's triggers record both — and the admin
 * finds the rename on *Povijest promjena*: its time, author, kind, subject
 * and *bilo → sada*; narrows by the team and the kind; and reads where
 * history begins on a long period. A phone draws the same rows stacked. A
 * member reaches none of it. No spec assumes `audit_events` is empty.
 */

const history = hr.history;

test.describe('an admin', () => {
  test.use({ storageState: ADMIN_STATE });

  test('reads a rename on Povijest promjena, narrows by its team and kind, and sees where history begins', async ({
    page,
    fixture,
  }) => {
    const suffix = randomBytes(3).toString('hex');
    const team = await seedExtraTeam(fixture.slug, `Povijest ${suffix}`);
    const renamed = `Povijest ${suffix} novo`;

    try {
      await renameTeamInSql(fixture.slug, team.id, renamed);

      const historyPage = new HistoryPage(page);

      await page.goto('/danas');
      await historyPage.navigationLink(hr.nav.povijestPromjena, { exact: true }).click();
      await expect(historyPage.heading(hr.nav.povijestPromjena)).toBeVisible();

      for (const column of Object.values(history.column)) {
        await expect(historyPage.table.getByRole('columnheader', { name: column, exact: true })).toBeVisible();
      }

      const row = historyPage.rowNaming(historyPage.changeText(history.field.name, team.name, renamed));

      await expect(row).toHaveCount(1);
      await expect(row).toContainText(historyPage.kindText(history.record.team, history.action.changed));
      await expect(row).toContainText(renamed);
      await expect(row).toContainText(history.author.system);
      await expect(row.getByRole('cell').first()).toHaveText(/\d{2}:\d{2}$/);

      // THE TEAM, through the chip's own picker in the *Filtri* sheet: only
      // entries naming this team (its INSERT and the rename), and the URL says so.
      const filters = new FilterBarParts(page);

      await filters.openSheet();
      await filters.pickIn(history.heading.team, filters.picker(history.picker.team).getByRole('button', {
        name: new RegExp(`^${escapeRegExp(renamed)}\\s*\\d`),
      }));
      await filters.showResults();
      await expect(page).toHaveURL(new RegExp(`[?&]smjena=${escapeRegExp(team.id)}`));
      await expect(historyPage.chip(fill(history.chip.team, { value: renamed }))).toBeVisible();
      await expect(historyPage.table.getByRole('row').filter({ hasText: renamed })).toHaveCount(2);

      // THE KIND, from the URL the chip writes: only its changes.
      await historyPage.goto(`?smjena=${team.id}&vrsta=team:changed`);
      await expect(
        historyPage.chip(
          fill(history.chip.kind, { value: historyPage.kindText(history.record.team, history.action.changed) }),
        ),
      ).toBeVisible();
      await expect(historyPage.table.getByRole('row').filter({ hasText: renamed })).toHaveCount(1);

      // WHERE HISTORY BEGINS: the last 365 days reach back to the marker, or
      // to the earliest event read on a seeded database.
      await historyPage.goto('?razdoblje=365-dana');
      await expect(page).toHaveURL(/razdoblje=365-dana$/);
      await expect(historyPage.beginsStatement).toBeVisible();
    } finally {
      await removeTeamInSql(fixture.slug, team.id);
    }
  });

  test('a bad period, or a person the period does not name, is rewritten out of the URL', async ({ page }) => {
    const historyPage = new HistoryPage(page);

    await historyPage.goto('?razdoblje=abc');
    await expect(historyPage.heading(hr.nav.povijestPromjena)).toBeVisible();
    await expect(page).toHaveURL(/\/povijest-promjena$/);

    await historyPage.goto(`?osoba=${randomUUID()}`);
    await expect(historyPage.table).toBeVisible();
    await expect(page).toHaveURL(/\/povijest-promjena$/);
  });

  test('offline, the open page says the history is unavailable and draws no rows', async ({ page }) => {
    const historyPage = new HistoryPage(page);

    await historyPage.goto();
    await expect(historyPage.table).toBeVisible();

    await page.context().setOffline(true);
    await expect(historyPage.offlineNotice).toBeVisible();
    await expect(historyPage.table).toHaveCount(0);
    await expect(historyPage.stackedList).toHaveCount(0);

    await page.context().setOffline(false);
    await expect(historyPage.table).toBeVisible();
    await expect(historyPage.offlineNotice).toHaveCount(0);
  });

  test.describe('on a phone', () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test('the same rows are stacked, and nothing scrolls sideways', async ({ page, fixture }) => {
      const suffix = randomBytes(3).toString('hex');
      const team = await seedExtraTeam(fixture.slug, `Povijest ${suffix}`);
      const renamed = `Povijest ${suffix} novo`;

      try {
        await renameTeamInSql(fixture.slug, team.id, renamed);

        const historyPage = new HistoryPage(page);

        await historyPage.goto();
        await expect(historyPage.heading(hr.nav.povijestPromjena)).toBeVisible();
        await expect(historyPage.table).toHaveCount(0);
        await expect(
          historyPage.stackedRowNaming(historyPage.changeText(history.field.name, team.name, renamed)),
        ).toHaveCount(1);
        await expectNoHorizontalScroll(page);
      } finally {
        await removeTeamInSql(fixture.slug, team.id);
      }
    });
  });
});

test.describe('a member', () => {
  test.use({ storageState: MEMBER_STATE });

  test('has no navigation row, and the URL forwards to Danas', async ({ page }) => {
    const historyPage = new HistoryPage(page);

    await page.goto('/danas');
    await expect(historyPage.heading(hr.nav.danas)).toBeVisible();
    await expect(historyPage.navigationLink(hr.nav.povijestPromjena, { exact: true })).toHaveCount(0);

    await historyPage.goto();
    await expect(historyPage.heading(hr.nav.danas)).toBeVisible();
    await expect(page).toHaveURL(/\/danas/);
  });
});
