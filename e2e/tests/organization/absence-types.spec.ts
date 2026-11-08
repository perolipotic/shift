import { randomBytes } from 'node:crypto';

import { ADMIN_STATE, readFixture } from '../../utils/run-fixture.ts';
import {
  ANNUAL_LEAVE_NAME,
  E2E_ABSENCE_TYPE_PREFIX,
  cleanUpAbsenceTypesInSql,
  holdAbsenceTypes,
  type RotationHold,
} from '../../utils/database-helper.ts';
import { hr } from '../../utils/i18n.ts';
import { expect, test } from '../../utils/custom-fixtures.ts';

test.use({ storageState: ADMIN_STATE });

const types = hr.organization.absenceTypes;

/**
 * Story 13.1b: *Vrste odsutnosti* on *Organizacija*. The run's organization is
 * shared, so each case runs under the absence-types hold and, in `finally`,
 * deletes every type it added and restores annual leave's name. CI only: the
 * shared local stack lacks `0052`.
 */
test.describe.configure({ mode: 'serial' });

let hold: RotationHold | null = null;

test.beforeEach(async () => {
  hold = holdAbsenceTypes(readFixture().slug);
  await hold.ready;
});

test.afterEach(async () => {
  await hold?.release();
  hold = null;
});

test('adds a type, then renames it and flips its drawing flag', async ({ organizationPage }) => {
  const fixture = readFixture();
  const suffix = randomBytes(3).toString('hex');
  const name = `${E2E_ABSENCE_TYPE_PREFIX} ${suffix}`;
  const renamed = `${E2E_ABSENCE_TYPE_PREFIX} ${suffix} novo`;

  try {
    await organizationPage.goto();
    // Annual leave is listed first, by its seeded name (the hold restored it), drawing.
    const first = organizationPage.absenceTypesRegion.getByRole('listitem').first();
    await expect(first.getByText(ANNUAL_LEAVE_NAME, { exact: true })).toBeVisible();
    await expect(first).toContainText(types.draws);

    await organizationPage.absenceTypeAdd.click();
    const add = organizationPage.absenceTypeAddDialog;
    await expect(add).toBeVisible();
    // Neither choice is made: `0052` has no default.
    await expect(organizationPage.absenceTypeDraws(add, true)).not.toBeChecked();
    await expect(organizationPage.absenceTypeDraws(add, false)).not.toBeChecked();
    await organizationPage.absenceTypeName(add).fill(name);
    // No choice: nothing is sent, and the dialog says the choice is required.
    await organizationPage.absenceTypeSave(add).click();
    await expect(add.getByRole('alert')).toHaveText(types.error.drawsRequired);
    await organizationPage.absenceTypeDraws(add, false).check();
    await organizationPage.absenceTypeSave(add).click();

    await expect(add).toHaveCount(0);
    await expect(organizationPage.absenceTypesRegion.getByRole('status')).toHaveText(types.added);
    await expect(organizationPage.absenceTypeRow(name)).toContainText(types.doesNotDraw);

    await organizationPage.absenceTypeEdit(name).click();
    const edit = organizationPage.absenceTypeEditDialog;
    await expect(organizationPage.absenceTypeName(edit)).toHaveValue(name);
    await expect(organizationPage.absenceTypeDraws(edit, false)).toBeChecked();
    await organizationPage.absenceTypeName(edit).fill(renamed);
    await organizationPage.absenceTypeDraws(edit, true).check();
    await organizationPage.absenceTypeSave(edit).click();

    await expect(edit).toHaveCount(0);
    await expect(organizationPage.absenceTypesRegion.getByRole('status')).toHaveText(types.saved);
    await expect(organizationPage.absenceTypeRow(renamed)).toContainText(types.draws);
    await expect(organizationPage.absenceTypeRow(name)).toHaveCount(0);
  } finally {
    await cleanUpAbsenceTypesInSql(fixture.slug, [name, renamed]);
  }
});

test('refuses a taken name inside the dialog and keeps what was typed', async ({ organizationPage }) => {
  const fixture = readFixture();
  // Annual leave's seeded name, padded and lower-cased: the same name by `name_key`.
  const taken = ' godišnji odmor ';

  try {
    await organizationPage.goto();
    await organizationPage.absenceTypeAdd.click();
    const add = organizationPage.absenceTypeAddDialog;
    await organizationPage.absenceTypeName(add).fill(taken);
    await organizationPage.absenceTypeDraws(add, true).check();
    await organizationPage.absenceTypeSave(add).click();

    await expect(add.getByRole('alert')).toHaveText(types.error.nameTaken);
    await expect(add).toBeVisible();
    await expect(organizationPage.absenceTypeName(add)).toHaveValue(taken);
    await expect(organizationPage.absenceTypeName(add)).toHaveAttribute('aria-invalid', 'true');
  } finally {
    await cleanUpAbsenceTypesInSql(fixture.slug, []);
  }
});

test("annual leave's drawing choice is disabled, with the reason said", async ({ organizationPage }) => {
  const fixture = readFixture();

  try {
    await organizationPage.goto();
    await expect(organizationPage.absenceTypeRow(ANNUAL_LEAVE_NAME)).toContainText(types.draws);
    await organizationPage.absenceTypeEdit(ANNUAL_LEAVE_NAME).click();

    const edit = organizationPage.absenceTypeEditDialog;
    await expect(organizationPage.absenceTypeDraws(edit, true)).toBeChecked();
    await expect(organizationPage.absenceTypeDraws(edit, true)).toBeDisabled();
    await expect(organizationPage.absenceTypeDraws(edit, false)).toBeDisabled();
    await expect(edit).toContainText(types.annualHint);
    // No delete control anywhere: a type is never deleted.
    // ✕, Odustani and Spremi, and nothing else.
    await expect(edit.getByRole('button')).toHaveCount(3);
    await edit.getByRole('button', { name: types.cancel, exact: true }).click();
    await expect(edit).toHaveCount(0);
  } finally {
    await cleanUpAbsenceTypesInSql(fixture.slug, []);
  }
});
