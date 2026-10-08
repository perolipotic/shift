import { PeoplePage } from '../../pages/people.page.ts';
import { sortControlName } from '../../pages/sort-control.ts';
import { leaveYearStartOf } from '../../utils/database-helper.ts';
import { ADMIN_STATE } from '../../utils/run-fixture.ts';
import { addDays, fullDate } from '../../utils/dates.ts';
import { fill, hr, plural } from '../../utils/i18n.ts';
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

test('a status or team date the screen refuses is marked invalid and focused, in its own dialog', async ({
  page,
  peoplePage,
  fixture,
}) => {
  // Nothing is written: both refusals are the screen's own preflight, raised
  // before any request. A fresh member, so no other spec's change to a fixture
  // member's status or team can change which offer is shown.
  const { name, username } = uniqueMember('Datum Odbijen');
  const past = '2000-01-01';

  await peoplePage.createMember(name, username);
  await peoplePage.backLink.click();
  await expect(page).toHaveURL('/ljudi');
  await peoplePage.editLink(name).click();

  // STORY 7.11: the date lives in the status dialog; the refusal keeps it open.
  await peoplePage.deactivateButton(name).click();
  await expect(peoplePage.statusDateInput).toHaveAttribute('aria-invalid', 'false');
  await peoplePage.statusDateInput.fill(past);
  await peoplePage.deactivateSaveButton.click();
  await expect(peoplePage.statusDialog.getByRole('alert').filter({ hasText: hr.ljudi.form.error.statusPast })).toBeVisible();
  await expect(peoplePage.statusDateInput).toHaveAttribute('aria-invalid', 'true');
  await expect(peoplePage.statusDateInput).toBeFocused();
  // Escape closes it, nothing sent, and focus returns to the opener.
  await page.keyboard.press('Escape');
  await expect(peoplePage.statusDialog).toHaveCount(0);
  await expect(peoplePage.deactivateButton(name)).toBeFocused();

  // NOVA SMJENA STARTS EMPTY, and Spremi on the placeholder is refused.
  await peoplePage.moveButton(name).click();
  await expect(peoplePage.selectedTeam).toHaveText(hr.smjene.membership.choose);
  await peoplePage.teamSaveButton.click();
  await expect(peoplePage.teamDialog.getByRole('alert').filter({ hasText: hr.smjene.membership.error.unpicked })).toBeVisible();
  await expect(peoplePage.teamSelect).toHaveAttribute('aria-invalid', 'true');
  await expect(peoplePage.teamSelect).toBeFocused();

  await peoplePage.teamSelect.selectOption({ label: fixture.team.name });
  await expect(peoplePage.dateInput).toHaveAttribute('aria-invalid', 'false');
  await peoplePage.dateInput.fill(past);
  await peoplePage.teamSaveButton.click();
  await expect(peoplePage.teamDialog.getByRole('alert').filter({ hasText: hr.smjene.membership.error.past })).toBeVisible();
  await expect(peoplePage.dateInput).toHaveAttribute('aria-invalid', 'true');
  await expect(peoplePage.dateInput).toBeFocused();
  await peoplePage.teamDialog.getByRole('button', { name: hr.smjene.membership.cancel, exact: true }).click();
  await expect(peoplePage.teamDialog).toHaveCount(0);
  await expect(peoplePage.moveButton(name)).toBeFocused();
  // NOTHING WAS SENT: the card still says no team.
  await expect(peoplePage.teamCard).toContainText(fill(hr.smjene.membership.current, { team: hr.smjene.membership.none }));
});

// STORY 7.11: the member page reads as facts headed by the person's name, and
// each change opens its own dialog with one final button.
test.describe('the member page shows facts and each change opens one dialog', () => {
  for (const viewport of [
    { width: 1280, height: 900 },
    { width: 390, height: 844 },
  ]) {
    test(`is headed by the name and mounts no form outside the leave card at ${String(viewport.width)} px`, async ({
      page,
      peoplePage,
    }) => {
      const { name, username } = uniqueMember('Činjenice Osobe');

      await page.setViewportSize(viewport);
      await peoplePage.createMember(name, username);
      await peoplePage.backLink.click();
      await peoplePage.editLink(name).click();

      await expect(peoplePage.memberHeading(name)).toBeVisible();
      // THE HEADER'S BADGES: the role and today's status, in words.
      const header = peoplePage.memberHeading(name).locator('..');
      await expect(header.getByText(hr.ljudi.member, { exact: true })).toBeVisible();
      await expect(header.getByText(hr.ljudi.page.active, { exact: true })).toBeVisible();
      // No team yet: the subline says so.
      await expect(header.getByText(hr.smjene.membership.none, { exact: true })).toBeVisible();
      for (const card of [peoplePage.basicsCard, peoplePage.teamCard, peoplePage.statusCard, peoplePage.signInCard]) {
        await expect(card).toBeVisible();
      }
      await expect(peoplePage.leaveCard).toBeVisible();
      await expect(peoplePage.basicsCard).toContainText(username);
      await expect(peoplePage.basicsCard).toContainText(hr.ljudi.basics.noEmail);
      // NO FIELD ON THE PAGE: the only form is the leave card's record form,
      // which story 7.12 moves into its own dialog.
      await expect(page.locator('main form')).toHaveCount(await peoplePage.leaveCard.locator('form').count());
      await expect(peoplePage.basicsCard.getByRole('textbox')).toHaveCount(0);
      await expect(peoplePage.teamCard.getByRole('combobox')).toHaveCount(0);
      // THE ALLOWANCE SITS IN THE LEAVE CARD, beside its figure.
      await expect(peoplePage.leaveCard.getByRole('button', { name: fill(hr.ljudi.allowance.changeName, { name }) })).toBeVisible();
      await expect(peoplePage.basicsCard.getByText(hr.ljudi.leave)).toHaveCount(0);
      await expectNoHorizontalScroll(page);
    });
  }

  test('changes the role in its own dialog, leaving the allowance alone, and returns focus to Uredi', async ({
    page,
    peoplePage,
  }) => {
    const { name, username } = uniqueMember('Uloga Osobe');

    await peoplePage.createMember(name, username);
    await peoplePage.backLink.click();
    await peoplePage.editLink(name).click();

    // The allowance is changed first, so the basics save can be shown not to touch it.
    await peoplePage.changeAllowance(name, 25);
    await expect(peoplePage.leaveCard.getByRole('status').filter({ hasText: hr.ljudi.allowance.saved })).toBeVisible();
    await expect(peoplePage.changeAllowanceButton(name)).toBeFocused();

    const save = page.waitForRequest((request) => request.method() === 'PATCH' && request.url().includes('/rest/v1/members'));
    await peoplePage.editBasicsButton(name).click();
    await expect(peoplePage.basicsDialog).toBeVisible();
    await peoplePage.roleSelect.selectOption({ label: hr.ljudi.admin });
    await peoplePage.basicsSaveButton.click();
    const body = (await save).postDataJSON() as Record<string, unknown>;

    expect(body, 'the basics save wrote the allowance back').not.toHaveProperty('leave_allowance_days');
    expect(body).toMatchObject({ role: 'admin' });
    await expect(peoplePage.basicsDialog).toHaveCount(0);
    await expect(peoplePage.basicsCard.getByRole('status')).toHaveText(hr.ljudi.form.saved);
    await expect(peoplePage.basicsCard).toContainText(hr.ljudi.admin);
    await expect(peoplePage.editBasicsButton(name)).toBeFocused();

    // AN ALLOWANCE THAT IS NO NUMBER the column holds is refused in its dialog, the field marked.
    await peoplePage.changeAllowanceButton(name).click();
    await expect(peoplePage.allowanceInput).toHaveValue('25');
    await peoplePage.allowanceInput.fill('-1');
    await peoplePage.allowanceSaveButton.click();
    await expect(peoplePage.allowanceDialog.getByRole('alert').filter({ hasText: hr.ljudi.form.error.invalid })).toBeVisible();
    await expect(peoplePage.allowanceInput).toHaveAttribute('aria-invalid', 'true');
    await expect(peoplePage.allowanceInput).toBeFocused();
  });

  test('a changed allowance reads on the leave card, with the balance from the same snapshot', async ({
    peoplePage,
    fixture,
  }) => {
    const { name, username } = uniqueMember('Pravo Osobe');
    const leave = hr.ljudi.leaveRecord;

    await peoplePage.createMember(name, username);
    await peoplePage.backLink.click();
    await peoplePage.editLink(name).click();
    // ON A TEAM, so the card has a schedule to count against and shows its figures.
    await peoplePage.moveToTeam(fixture.team.name, name);
    await expect(peoplePage.leaveFigure(leave.allowance)).toHaveText(plural(hr.count.days, 20));
    await expect(peoplePage.leaveFigure(leave.balance)).toHaveText(plural(hr.count.days, 20));

    await peoplePage.changeAllowance(name, 25);
    await expect(peoplePage.leaveFigure(leave.allowance)).toHaveText(plural(hr.count.days, 25));
    await expect(peoplePage.leaveFigure(leave.balance)).toHaveText(plural(hr.count.days, 25));
  });

  test('a last-admin demotion is refused inside the basics dialog, which stays open', async ({ page, peoplePage }) => {
    const { name, username } = uniqueMember('Zadnji Admin');

    await peoplePage.createMember(name, username);
    await peoplePage.backLink.click();
    await peoplePage.editLink(name).click();

    // THE DATABASE'S DEFERRED REFUSAL, as PostgREST carries it — mocked, so no
    // shared administrator is ever demoted while other specs run.
    await page.route('**/rest/v1/members*', async (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();

      return route.fulfill({
        status: 400,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({ code: 'P0001', message: 'ORGANIZATION_WOULD_HAVE_NO_ADMIN', details: null, hint: null }),
      });
    });
    await peoplePage.editBasicsButton(name).click();
    await peoplePage.roleSelect.selectOption({ label: hr.ljudi.member });
    await peoplePage.basicsSaveButton.click();

    const alert = peoplePage.basicsDialog.getByRole('alert');
    await expect(alert).toHaveText(hr.ljudi.form.error.lastAdmin);
    await expect(peoplePage.basicsDialog).toBeVisible();
    // ABOVE THE BUTTONS: the alert precedes Spremi in the dialog.
    const alertBox = await alert.boundingBox();
    const saveBox = await peoplePage.basicsSaveButton.boundingBox();
    expect((alertBox?.y ?? 0) < (saveBox?.y ?? 0), 'the alert is not above the buttons').toBe(true);
    await expect(peoplePage.basicsCard.getByRole('status')).toHaveCount(0);
  });

  test('a refused rename after the other fields landed says what was saved, in the dialog', async ({
    page,
    peoplePage,
  }) => {
    const { name, username } = uniqueMember('Djelomicno Spremljen');
    const renamed = `${name} Novi`;

    await peoplePage.createMember(name, username);
    await peoplePage.backLink.click();
    await peoplePage.editLink(name).click();

    // THE RENAME IS REFUSED by the privileged function; the PATCH is real.
    await page.route('**/functions/v1/admin-auth', async (route) => {
      if (route.request().method() === 'OPTIONS') return route.fallback();

      return route.fulfill({
        status: 409,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: JSON.stringify({ code: 'USERNAME_TAKEN' }),
      });
    });
    await peoplePage.editBasicsButton(name).click();
    await peoplePage.nameInput.fill(renamed);
    await peoplePage.usernameInput.fill(`${username}.drugi`);
    await peoplePage.basicsSaveButton.click();

    const alert = peoplePage.basicsDialog.getByRole('alert');
    await expect(alert).toContainText(hr.ljudi.form.error.saved);
    await expect(alert).toContainText(hr.ljudi.form.error.usernameTaken);
    await expect(peoplePage.basicsDialog).toBeVisible();
    // THE NAME DID LAND: the page's title reads it, re-read after the partial save.
    await expect(peoplePage.memberHeading(renamed)).toBeVisible();
    // ODUSTANI: the dialog goes, and the card keeps saying what landed and what did not.
    await peoplePage.basicsDialog.getByRole('button', { name: hr.ljudi.form.cancel, exact: true }).click();
    await expect(peoplePage.basicsDialog).toHaveCount(0);
    await expect(peoplePage.basicsCard.getByRole('alert')).toContainText(hr.ljudi.form.error.saved);
    await expect(peoplePage.basicsCard.getByRole('alert')).toContainText(hr.ljudi.form.error.usernameTaken);
    await expect(peoplePage.editBasicsButton(renamed)).toBeFocused();
  });

  test('a deactivation from a later date shows as the scheduled change on the status card', async ({ peoplePage }) => {
    const { name, username } = uniqueMember('Kasnija Deaktivacija');

    await peoplePage.createMember(name, username);
    await peoplePage.backLink.click();
    await peoplePage.editLink(name).click();

    await peoplePage.deactivateButton(name).click();
    const minimum = await peoplePage.statusDateInput.getAttribute('min');
    if (minimum === null) throw new Error('E2E: the status date control has no minimum');
    const later = addDays(minimum, 3);
    await peoplePage.statusDateInput.fill(later);
    // THE ONE NEUTRAL QUESTION names the person and the date as entered.
    await expect(peoplePage.statusDialog).toContainText(
      fill(hr.ljudi.status.deactivatePromptFuture, { name, date: fullDate(later) }),
    );
    await peoplePage.deactivateSaveButton.click();

    await expect(peoplePage.statusDialog).toHaveCount(0);
    await expect(peoplePage.statusCard.getByRole('status')).toHaveText(hr.ljudi.status.saved);
    await expect(peoplePage.statusCard).toContainText(fill(hr.ljudi.status.scheduledInactive, { date: fullDate(later) }));
    // Offered now: only the withdrawal, from the card.
    await expect(peoplePage.statusWithdrawButton(name)).toBeVisible();
    await expect(peoplePage.deactivateButton(name)).toHaveCount(0);
  });

  test('names the leave year it counts in the leave card\'s heading', async ({ peoplePage, fixture }) => {
    const { name, username } = uniqueMember('Godina Osobe');
    const start = await leaveYearStartOf(fixture.slug);
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zagreb' }).format(new Date());
    const year = Number(today.slice(0, 4));
    const startThisYear = `${String(year)}-${String(start.month).padStart(2, '0')}-${String(start.day).padStart(2, '0')}`;
    const from = today >= startThisYear ? year : year - 1;
    const heading =
      start.month === 1 && start.day === 1
        ? fill(hr.ljudi.leaveRecord.headingYear, { year: String(from) })
        : fill(hr.ljudi.leaveRecord.headingYears, { from: String(from), to: String(from + 1) });

    await peoplePage.createMember(name, username);
    await peoplePage.backLink.click();
    await peoplePage.editLink(name).click();
    await peoplePage.moveToTeam(fixture.team.name, name);

    await expect(peoplePage.leaveFigure(hr.ljudi.leaveRecord.allowance)).toBeVisible();
    await expect(peoplePage.leaveHeading).toHaveText(heading);
  });

  test('a refused password reset says so inside the Prijava card, and focus returns to its button', async ({
    page,
    peoplePage,
  }) => {
    const { name, username } = uniqueMember('Lozinka Odbijena');

    await peoplePage.createMember(name, username);
    await peoplePage.backLink.click();
    await peoplePage.editLink(name).click();

    // Cancelling the confirmation returns focus to the button that armed it.
    await peoplePage.resetButton(name).click();
    await page.keyboard.press('Escape');
    await expect(peoplePage.resetButton(name)).toBeFocused();

    await page.route('**/functions/v1/admin-auth', async (route) => {
      if (route.request().method() === 'OPTIONS') return route.fallback();

      return route.fulfill({
        status: 500,
        contentType: 'application/json',
        headers: { 'access-control-allow-origin': '*' },
        body: '{}',
      });
    });
    await peoplePage.resetButton(name).click();
    await peoplePage.resetConfirmButton(name).click();

    await expect(peoplePage.signInCard.getByRole('alert')).toHaveText(hr.ljudi.form.error.unavailable);
    await expect(peoplePage.issuedPassword).toHaveCount(0);
    await expect(peoplePage.resetButton(name)).toBeFocused();
  });

  test('an id that reaches nobody says why on the basics card', async ({ page, peoplePage }) => {
    await page.goto('/ljudi/00000000-0000-4000-8000-000000000000');

    await expect(peoplePage.heading(hr.ljudi.page.heading)).toBeVisible();
    await expect(peoplePage.basicsCard.getByRole('alert')).toHaveText(hr.ljudi.form.error.unknown);
    await expect(peoplePage.teamCard).toHaveCount(0);
  });

  test('a team dialog whose move is no longer offered on a re-read closes itself and the card says the record moved', async ({
    page,
    peoplePage,
    fixture,
  }) => {
    const { name, username } = uniqueMember('Zastarjela Smjena');

    await peoplePage.createMember(name, username);
    await peoplePage.backLink.click();
    await peoplePage.editLink(name).click();
    await expect(peoplePage.moveButton(name)).toBeVisible();

    // MEANWHILE, in another tab, a move is scheduled for a later date.
    const other = new PeoplePage(await page.context().newPage());
    await other.openMember(name);
    await other.moveButton(name).click();
    await other.teamSelect.selectOption({ label: fixture.team.name });
    const minimum = await other.dateInput.getAttribute('min');
    if (minimum === null) throw new Error('E2E: the team date control has no minimum');
    await other.dateInput.fill(addDays(minimum, 5));
    await other.teamSaveButton.click();
    await expect(other.teamDialog).toHaveCount(0);
    await other.page.close();

    // THIS TAB still offers the move; its write is refused and the re-read no
    // longer offers one, so the dialog closes and the card says why.
    await peoplePage.moveButton(name).click();
    await peoplePage.teamSelect.selectOption({ label: fixture.team.name });
    await peoplePage.teamSaveButton.click();

    await expect(peoplePage.teamDialog).toHaveCount(0);
    await expect(peoplePage.teamCard.getByRole('alert')).toHaveText(hr.smjene.membership.error.stale);
    await expect(peoplePage.withdrawButton(name)).toBeFocused();
  });

  test('drives its dialogs at 390 px, and Escape returns focus to the opener', async ({ page, peoplePage, fixture }) => {
    const { name, username } = uniqueMember('Telefon Osobe');

    await page.setViewportSize({ width: 390, height: 844 });
    await peoplePage.createMember(name, username);
    await peoplePage.backLink.click();
    await peoplePage.editLink(name).click();

    await peoplePage.editBasicsButton(name).click();
    await expect(peoplePage.basicsDialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(peoplePage.basicsDialog).toHaveCount(0);
    await expect(peoplePage.editBasicsButton(name)).toBeFocused();

    await peoplePage.changeAllowanceButton(name).click();
    await expect(peoplePage.allowanceDialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(peoplePage.allowanceDialog).toHaveCount(0);
    await expect(peoplePage.changeAllowanceButton(name)).toBeFocused();

    // A MOVE FROM TODAY: the dialog closes, the card says so, focus is back on Promijeni.
    await peoplePage.moveButton(name).click();
    await peoplePage.teamSelect.selectOption({ label: fixture.team.name });
    await expectNoHorizontalScroll(page);
    await peoplePage.teamSaveButton.click();
    await expect(peoplePage.teamDialog).toHaveCount(0);
    await expect(peoplePage.teamCard.getByRole('status')).toContainText(hr.smjene.membership.saved);
    await expect(peoplePage.moveButton(name)).toBeFocused();
  });

  test('offers no status change on the caller\'s own row', async ({ peoplePage, fixture }) => {
    await peoplePage.openMember(fixture.admin.name);

    await expect(peoplePage.memberHeading(fixture.admin.name)).toBeVisible();
    await expect(peoplePage.basicsCard).toBeVisible();
    await expect(peoplePage.statusCard).toHaveCount(0);
  });
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
