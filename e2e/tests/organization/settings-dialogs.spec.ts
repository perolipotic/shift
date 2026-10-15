import { ADMIN_STATE } from '../../utils/run-fixture.ts';
import { escapeRegExp, hr } from '../../utils/i18n.ts';
import { expect, test } from '../../utils/custom-fixtures.ts';

test.use({ storageState: ADMIN_STATE });

const organization = hr.organization;

/**
 * Story 7.18: Organizacija is a page of facts, and each change opens its own
 * dialog with one Spremi. Nothing here saves: the run's organization is
 * shared, so these tests open and close dialogs and read what they show.
 */
test('the page states its facts, with the zone locked and the reason said, and no field on the page', async ({
  organizationPage,
}) => {
  await organizationPage.goto();

  await expect(organizationPage.nameOpener).toBeVisible();
  await expect(organizationPage.mainForms).toHaveCount(0);
  await expect(organizationPage.mainFields).toHaveCount(0);
  await expect(organizationPage.text(organization.timezoneReason)).toBeVisible();
  await expect(organizationPage.timeRegion).toContainText(organization.timezoneLocked);
});

test('Satni pojasi is a card of facts about the bands, and Otvori leads to their editor', async ({ page, organizationPage }) => {
  // Deferred work from 7.18: the count and names, the day covered, and the way in.
  await organizationPage.goto();

  const card = page.getByRole('region', { name: organization.hourBands.heading, exact: true });
  await expect(card).toBeVisible();
  await expect(card).toContainText(organization.hourBandsBands);
  await expect(card).toContainText(organization.hourBands.covered);
  await expect(card).toContainText(organization.hourBands.coveredValue.split('}')[1] ?? '');
  await card.getByRole('link', { name: organization.hourBandsOpenLabel, exact: true }).click();
  await expect(page).toHaveURL(/\/organizacija\/satni-pojasi$/);
});

test('every change opens its own dialog with one Spremi, and each way out returns focus to its button', async ({
  page,
  organizationPage,
}) => {
  await organizationPage.goto();

  // ESCAPE, on the name.
  await organizationPage.nameOpener.click();
  await expect(organizationPage.nameDialog).toBeVisible();
  await expect(organizationPage.nameInput).not.toHaveValue('');
  await expect(organizationPage.nameDialog.getByRole('button', { name: organization.save, exact: true })).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(organizationPage.nameDialog).toHaveCount(0);
  await expect(organizationPage.nameOpener).toBeFocused();

  // ✕, on the leave year.
  const leaveYear = organizationPage.dialog(organization.leaveYearStart);
  await organizationPage.leaveYearOpener.click();
  await expect(leaveYear.getByLabel(organization.leaveYearStartDay, { exact: true })).toBeVisible();
  // The current leave year the saved start gives, in full dates (deferred work from 7.18).
  const lead = escapeRegExp(organization.leaveYearCurrent.split('{')[0] ?? '');
  await expect(leaveYear.getByText(new RegExp(`^${lead}\\d{2}\\.\\d{2}\\.\\d{4}–\\d{2}\\.\\d{2}\\.\\d{4}$`))).toBeVisible();
  await leaveYear.getByRole('button', { name: organization.close, exact: true }).click();
  await expect(leaveYear).toHaveCount(0);
  await expect(organizationPage.leaveYearOpener).toBeFocused();

  // ODUSTANI, on the fire-rank setting.
  await organizationPage.fireRanksOpener.click();
  await expect(organizationPage.fireRanksDialog.getByRole('radio')).toHaveCount(2);
  await organizationPage.fireRanksDialog.getByRole('button', { name: organization.cancel, exact: true }).click();
  await expect(organizationPage.fireRanksDialog).toHaveCount(0);
  await expect(organizationPage.fireRanksOpener).toBeFocused();
});

test('the accent is chosen from named radio cards beside the rule, and nothing is written until Spremi', async ({
  page,
  organizationPage,
}) => {
  await organizationPage.goto();
  await organizationPage.accentOpener.click();

  const dialog = organizationPage.accentDialog;
  for (const name of [
    organization.accentNone,
    organization.accentBlue,
    organization.accentGreen,
    organization.accentAmber,
    organization.accentViolet,
  ]) {
    await expect(dialog.getByRole('radio', { name, exact: true })).toBeVisible();
  }
  await expect(dialog).toContainText(organization.accentRule);

  // A choice alone writes nothing: the organization is never patched.
  let writes = 0;
  await page.route('**/rest/v1/organizations*', (route) => {
    if (route.request().method() === 'PATCH') writes += 1;

    return route.fallback();
  });
  await dialog.getByRole('radio', { name: organization.accentViolet, exact: true }).check();
  await dialog.getByRole('button', { name: organization.cancel, exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(organizationPage.accentOpener).toBeFocused();
  expect(writes).toBe(0);
});

test('Povijest rotacije opens from the header of Postavke rotacije and closes back onto its button', async ({
  rotationPage,
}) => {
  await rotationPage.goto();

  await rotationPage.openHistory();
  await expect(rotationPage.historyDialog).toContainText(hr.rotation.builder.history.lede);
  await rotationPage.closeHistory();
});
