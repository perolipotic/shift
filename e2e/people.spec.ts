import { ADMIN_STATE } from './support/fixture.ts';
import { fill, hr } from './support/i18n.ts';
import { submitNewMember, uniqueMember } from './support/members.ts';
import { expect, test } from './support/test.ts';

test.use({ storageState: ADMIN_STATE });

test('the member list shows the fixture members', async ({ page, fixture }) => {
  await page.goto('/ljudi');

  await expect(page.getByRole('heading', { level: 1, name: hr.nav.ljudi })).toBeVisible();
  const table = page.getByRole('table', { name: hr.ljudi.caption });
  for (const person of [fixture.admin, fixture.member, fixture.spare]) {
    await expect(table.getByRole('link', { name: fill(hr.ljudi.form.edit, { name: person.name }) })).toBeVisible();
  }
});

test('creating a member shows the one-time password and lists the member', async ({ page }) => {
  // `Članica`: the username is ASCII, the name keeps its diacritics.
  const { name, username } = uniqueMember('Nova Članica');

  await page.goto('/ljudi');
  await page.getByRole('link', { name: hr.ljudi.form.add }).click();
  await expect(page).toHaveURL('/ljudi/novi');

  await submitNewMember(page, name, username);
  await expect(page.getByText(hr.ljudi.form.credential, { exact: true })).toBeVisible();
  await expect(page.getByText(hr.ljudi.form.credentialOnce, { exact: true })).toBeVisible();
  await expect(page.getByText(username, { exact: true })).toBeVisible();

  await page.getByRole('link', { name: hr.ljudi.form.back }).click();
  await expect(page).toHaveURL('/ljudi');
  await expect(page.getByRole('link', { name: fill(hr.ljudi.form.edit, { name }) })).toBeVisible();
});
