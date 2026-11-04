import { ADMIN_STATE, readFixture } from '../../utils/run-fixture.ts';
import { holdRotation, minimumMembersOf, setMinimumMembersInSql, type RotationHold } from '../../utils/database-helper.ts';
import { fill, hr } from '../../utils/i18n.ts';
import { expect, test } from '../../utils/custom-fixtures.ts';

test.use({ storageState: ADMIN_STATE });

const organization = hr.organization;

/**
 * Story 11.1: *Najmanje ljudi u smjeni* on *Organizacija*. The run's
 * organization is shared, so each case sets the setting in SQL first and
 * restores it after; the file runs serially, so no case races another.
 *
 * UNDER THE RUN'S ROTATION HOLD (story 11.3): while the setting is set, every
 * working shift under it is marked short-staffed on the calendar grid, which
 * would add `Premalo ljudi` to the cell labels and legends the calendar specs
 * pin exactly. Each of those seeds its rotation under `holdRotation`, as the
 * short-staffed specs set the minimum under it, so holding it here too keeps
 * the setting from changing under them.
 */
test.describe.configure({ mode: 'serial' });

let hold: RotationHold | null = null;

test.beforeEach(async () => {
  test.slow(); // the shared rotation lock (`holdRotation`) can take longer than the default timeout
  hold = holdRotation(readFixture().slug);
  await hold.ready;
});

test.afterEach(async () => {
  await hold?.release();
  hold = null;
});

test('sets the minimum, then clears it, and the card and the database say so', async ({ organizationPage }) => {
  const fixture = readFixture();
  const was = await setMinimumMembersInSql(fixture.slug, null);
  try {
    await organizationPage.goto();
    await expect(organizationPage.minimumMembersRegion.getByText(organization.minimumMembersNotSet, { exact: true })).toBeVisible();

    await organizationPage.minimumMembersOpener.click();
    const dialog = organizationPage.minimumMembersDialog;
    const field = dialog.getByLabel(organization.minimumMembers, { exact: true });
    await expect(field).toHaveValue('');
    await field.fill('3');
    await organizationPage.saveIn(dialog).click();

    await expect(dialog).toHaveCount(0);
    await expect(organizationPage.text(fill(organization.minimumMembersStatusSet, { count: '3' }))).toBeVisible();
    await expect(organizationPage.minimumMembersOpener).toBeFocused();
    await expect(organizationPage.minimumMembersRegion.getByText('3', { exact: true })).toBeVisible();
    await expect.poll(() => minimumMembersOf(fixture.slug)).toBe(3);

    await organizationPage.minimumMembersOpener.click();
    await expect(field).toHaveValue('3');
    await field.fill('');
    await organizationPage.saveIn(dialog).click();

    await expect(dialog).toHaveCount(0);
    await expect(organizationPage.text(organization.minimumMembersStatusNotSet)).toBeVisible();
    await expect(organizationPage.minimumMembersRegion.getByText(organization.minimumMembersNotSet, { exact: true })).toBeVisible();
    await expect.poll(() => minimumMembersOf(fixture.slug)).toBeNull();
  } finally {
    await setMinimumMembersInSql(fixture.slug, was);
  }
});

for (const entry of ['0', '40000', '2.5', 'abc', '100000']) {
  test(`refuses ${entry} before anything is sent, keeps the dialog open and marks the field`, async ({
    page,
    organizationPage,
  }) => {
    const fixture = readFixture();
    const was = await setMinimumMembersInSql(fixture.slug, 4);
    // NOTHING IS SENT: every organization PATCH this case makes is counted. `0`
    // alone could not tell the client's refusal from 0048's check, which maps
    // to the same message and field.
    const writes: string[] = [];
    page.on('request', (request) => {
      if (request.method() === 'PATCH' && request.url().includes('/rest/v1/organizations')) writes.push(request.url());
    });
    try {
      await organizationPage.goto();
      await organizationPage.minimumMembersOpener.click();
      const dialog = organizationPage.minimumMembersDialog;
      const field = dialog.getByLabel(organization.minimumMembers, { exact: true });
      await expect(field).toHaveValue('4');
      await field.fill(entry);
      await organizationPage.saveIn(dialog).click();

      await expect(dialog.getByRole('alert')).toHaveText(organization.error.minimumMembers);
      await expect(field).toHaveAttribute('aria-invalid', 'true');
      await expect(field).toBeFocused();
      await expect(field).toHaveValue(entry);
      expect(writes, 'a refused entry was sent').toEqual([]);
      expect(await minimumMembersOf(fixture.slug)).toBe(4);
    } finally {
      await setMinimumMembersInSql(fixture.slug, was);
    }
  });
}
