import { MEMBER_STATE } from '../../utils/run-fixture.ts';
import { expectNoHorizontalScroll } from '../../utils/layout.ts';
import { hr } from '../../utils/i18n.ts';
import { expect, test } from '../../utils/custom-fixtures.ts';

/**
 * Story 7.17: a member finds the directory in *Više* on a phone. `/ljudi` is
 * role-scoped: for a member it is every active team with today's members,
 * their own team first and marked, read-only, with a name search in `?trazi=`.
 *
 * The stored member is on the fixture team (`run-fixture.ts`), so that team is
 * the one marked *tvoja smjena*.
 */

test.use({ storageState: MEMBER_STATE, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

test('a member opens Ljudi from Više and sees their team first, marked, with nothing but names', async ({
  page,
  loginPage,
  peoplePage,
  fixture,
}) => {
  await page.goto('/danas');
  await expect(loginPage.heading(hr.nav.danas)).toBeVisible();

  await loginPage.moreButton.click();
  await loginPage.moreSheet.getByRole('link', { name: hr.nav.ljudi, exact: true }).click();

  await expect(page).toHaveURL('/ljudi');
  await expect(loginPage.heading(hr.nav.ljudi, { exact: true })).toBeVisible();
  await expect(loginPage.text(hr.ljudi.directory.lede)).toBeVisible();

  // THE CALLER'S TEAM FIRST, marked in words, with the caller in it.
  const groups = peoplePage.directoryGroups;
  const own = peoplePage.directoryGroup(fixture.team.name);
  await expect(groups.first()).toHaveAccessibleName(fixture.team.name);
  await expect(own.getByText(hr.ljudi.directory.own, { exact: true })).toBeVisible();
  await expect(own.getByText(fixture.member.name)).toBeVisible();

  // READ-ONLY AND NARROW: no add action, no link from a line, no address, no
  // username, no allowance.
  await expect(peoplePage.anyAddButton).toHaveCount(0);
  await expect(peoplePage.mainLinks).toHaveCount(0);
  await expect(peoplePage.main).not.toContainText('@');
  await expect(peoplePage.main).not.toContainText(hr.ljudi.leave);
  await expect(peoplePage.main).not.toContainText(fixture.member.username);
  await expectNoHorizontalScroll(page);
});

test('the search narrows by name in the URL, and a search with no hit offers to clear it', async ({
  page,
  peoplePage,
  fixture,
}) => {
  await page.goto('/ljudi');
  const own = peoplePage.directoryGroup(fixture.team.name);
  await expect(own).toBeVisible();

  const search = peoplePage.directorySearch;
  await search.fill(fixture.member.name);
  await expect(page).toHaveURL(/[?&]trazi=/);
  await expect(own.getByText(fixture.member.name)).toBeVisible();

  await search.fill('zzzz-nitko');
  await expect(peoplePage.text(hr.ljudi.directory.noMatch)).toBeVisible();
  await expect(peoplePage.directoryGroups).toHaveCount(0);

  await peoplePage.directoryClear.click();
  await expect(own).toBeVisible();
  await expect(search).toHaveValue('');
  await expect(search).toBeFocused();
});

test('the add dialog never opens for a member, even by its URL', async ({ page, peoplePage, fixture }) => {
  await page.goto('/ljudi?dodaj=1');

  await expect(peoplePage.directoryGroup(fixture.team.name)).toBeVisible();
  await expect(peoplePage.dialog()).toHaveCount(0);
});

test('a failed roster read is one notice with no team, and the retry brings the directory back', async ({
  page,
  peoplePage,
  fixture,
}) => {
  const roster = (url: URL) => url.pathname.endsWith('/rest/v1/rpc/team_roster');
  let failures = 0;
  // FAILS ONCE: the first roster call is answered 500, every later one goes
  // through, so the retry's re-read is what succeeds.
  await page.route(roster, async (route) => {
    if (failures === 0) {
      failures += 1;
      await route.fulfill({ status: 500, body: '{}' });
      return;
    }
    await route.continue();
  });

  await page.goto('/ljudi');

  await expect(peoplePage.alertWith(hr.ljudi.directory.unavailable)).toBeVisible();
  await expect(peoplePage.directoryGroups).toHaveCount(0);

  await peoplePage.directoryRetry.click();

  await expect(peoplePage.directoryGroup(fixture.team.name)).toBeVisible();
  await expect(peoplePage.alertWith(hr.ljudi.directory.unavailable)).toHaveCount(0);
});

test.describe('at a desktop viewport', () => {
  test.use({ viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });

  test('a member finds Ljudi in the sidebar', async ({ page, loginPage }) => {
    await page.goto('/danas');
    await expect(loginPage.heading(hr.nav.danas)).toBeVisible();

    await loginPage.navigationLink(hr.nav.ljudi, { exact: true }).click();
    await expect(page).toHaveURL('/ljudi');
    await expect(loginPage.heading(hr.nav.ljudi, { exact: true })).toBeVisible();
  });
});
