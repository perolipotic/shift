import { ADMIN_STATE } from '../../utils/run-fixture.ts';
import { hr } from '../../utils/i18n.ts';
import { uniqueMember } from '../../utils/members.ts';
import { expect, test } from '../../utils/custom-fixtures.ts';

test.use({ storageState: ADMIN_STATE });

test('the member list shows the fixture members', async ({ peoplePage, fixture }) => {
  await peoplePage.goto();

  await expect(peoplePage.heading(hr.nav.ljudi)).toBeVisible();
  for (const person of [fixture.admin, fixture.member, fixture.spare]) {
    await expect(peoplePage.listedMember(person.name)).toBeVisible();
  }
});

test('creating a member shows the one-time password and lists the member', async ({ page, peoplePage }) => {
  // `Članica`: the username is ASCII, the name keeps its diacritics.
  const { name, username } = uniqueMember('Nova Članica');

  await peoplePage.goto();
  await peoplePage.addLink.click();
  await expect(page).toHaveURL('/ljudi/novi');

  await peoplePage.submitNewMember(name, username);
  await expect(peoplePage.text(hr.ljudi.form.credential)).toBeVisible();
  await expect(peoplePage.text(hr.ljudi.form.credentialOnce)).toBeVisible();
  await expect(peoplePage.text(username)).toBeVisible();

  await peoplePage.backLink.click();
  await expect(page).toHaveURL('/ljudi');
  await expect(peoplePage.editLink(name)).toBeVisible();
});
