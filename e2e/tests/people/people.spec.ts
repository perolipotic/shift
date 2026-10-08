import { sortControlName } from '../../pages/sort-control.ts';
import { ADMIN_STATE } from '../../utils/run-fixture.ts';
import { fill, hr } from '../../utils/i18n.ts';
import { expectNoHorizontalScroll, expectNoInnerHorizontalScroll } from '../../utils/layout.ts';
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

// STORY 7.6: below 640 px the member list is stacked rows — one link per row,
// named as the table's edit link, no address — sorted through the shared
// control, whose state the table reads again from 640 px.
test.describe('the member list on a phone', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('is stacked rows with one link each, and the sort control flips the name and returns focus', async ({
    page,
    peoplePage,
    fixture,
  }) => {
    await peoplePage.goto();
    await expect(peoplePage.list).toBeVisible();
    await expect(peoplePage.table).toHaveCount(0);
    await expectNoHorizontalScroll(page);
    await expectNoInnerHorizontalScroll(page);

    // ONE LINK PER ROW, named for the member, and no address on a phone.
    const row = peoplePage.listRow(fixture.member.name);
    await expect(row).toHaveCount(1);
    await expect(row.getByRole('link')).toHaveCount(1);
    await expect(peoplePage.listLabel(row, hr.ljudi.email)).toHaveCount(0);
    for (const label of [hr.ljudi.name, hr.ljudi.role, hr.smjene.membership.column, hr.ljudi.leave]) {
      await expect(peoplePage.listLabel(row, label)).toHaveCount(1);
    }

    // Name ascending by default; picking it again flips it.
    const control = peoplePage.sortControl;
    await expect(control).toHaveAccessibleName(sortControlName(hr.ljudi.name, true));
    // THE FIXTURE'S THREE, in the order shown: other specs add members to the
    // run organization in parallel, so only these three are compared.
    const fixed = new Set([fixture.admin, fixture.member, fixture.spare].map((person) => fill(hr.ljudi.form.edit, { name: person.name })));
    const shownOrder = async (): Promise<string[]> =>
      (await peoplePage.listLinks.evaluateAll((elements) => elements.map((element) => element.getAttribute('aria-label') ?? ''))).filter(
        (name) => fixed.has(name),
      );
    const links = await shownOrder();
    expect(links, 'the three fixture members are listed').toHaveLength(3);

    // Escape closes the list and puts focus back on the control.
    await control.click();
    // The address is not on the row, so it is not offered.
    await expect(peoplePage.sortOption(hr.ljudi.email)).toHaveCount(0);
    await expect(peoplePage.sortOption(hr.ljudi.name)).toHaveAttribute('aria-pressed', 'true');
    await expect(peoplePage.sortOption(hr.ljudi.name)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(peoplePage.sortPicker).toHaveCount(0);
    await expect(control).toBeFocused();

    await control.click();
    await peoplePage.sortOption(hr.ljudi.name).click();
    await expect(peoplePage.sortPicker).toHaveCount(0);
    await expect(control).toBeFocused();
    await expect(control).toHaveAccessibleName(sortControlName(hr.ljudi.name, false));
    await expect.poll(shownOrder).toEqual([...links].reverse());

    // ANOTHER COLUMN STARTS ASCENDING: the level, administrators first.
    await control.click();
    await peoplePage.sortOption(hr.ljudi.role).click();
    await expect(control).toBeFocused();
    await expect(control).toHaveAccessibleName(sortControlName(hr.ljudi.role, true));
    await expect.poll(async () => (await shownOrder())[0]).toBe(fill(hr.ljudi.form.edit, { name: fixture.admin.name }));
    await control.click();
    await expect(peoplePage.sortOption(hr.ljudi.role)).toHaveAttribute('aria-pressed', 'true');
    await expect(peoplePage.sortOption(hr.ljudi.name)).toHaveAttribute('aria-pressed', 'false');
    await page.keyboard.press('Escape');
    await expect(control).toBeFocused();

    // ACROSS 640 PX THE SORT IS KEPT: the table's level heading is ascending.
    await page.setViewportSize({ width: 1024, height: 800 });
    await expect(peoplePage.table).toBeVisible();
    await expect(peoplePage.list).toHaveCount(0);
    await expect(peoplePage.columnHeader(hr.ljudi.role)).toHaveAttribute('aria-sort', 'ascending');
  });
});
