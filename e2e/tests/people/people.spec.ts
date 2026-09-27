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

test('a status or team date the screen refuses is marked invalid and focused', async ({ page, peoplePage }) => {
  // Nothing is written: both refusals are the screen's own preflight, raised
  // before any request. A fresh member, so no other spec's change to a fixture
  // member's status or team can change which offer is shown.
  const { name, username } = uniqueMember('Datum Odbijen');
  const past = '2000-01-01';

  await peoplePage.createMember(name, username);
  await peoplePage.backLink.click();
  await expect(page).toHaveURL('/ljudi');
  await peoplePage.editLink(name).click();

  await expect(peoplePage.statusDateInput).toHaveAttribute('aria-invalid', 'false');
  await peoplePage.statusDateInput.fill(past);
  await peoplePage.deactivateButton(name).click();
  await expect(peoplePage.alertWith(hr.ljudi.form.error.statusPast)).toBeVisible();
  await expect(peoplePage.statusDateInput).toHaveAttribute('aria-invalid', 'true');
  await expect(peoplePage.statusDateInput).toBeFocused();

  await expect(peoplePage.dateInput).toHaveAttribute('aria-invalid', 'false');
  await peoplePage.dateInput.fill(past);
  await peoplePage.moveButton(name).click();
  await expect(peoplePage.alertWith(hr.smjene.membership.error.past)).toBeVisible();
  await expect(peoplePage.dateInput).toHaveAttribute('aria-invalid', 'true');
  await expect(peoplePage.dateInput).toBeFocused();
  // EACH BLOCK MARKS ITS OWN DATE: the status refusal still stands, so its
  // date is still marked, by its own refusal and not by the team's.
  await expect(peoplePage.statusDateInput).toHaveAttribute('aria-invalid', 'true');
});
