import { randomBytes } from 'node:crypto';

import type { Route, TestInfo } from '@playwright/test';

import { ADMIN_STATE } from '../../utils/run-fixture.ts';
import { fill, hr } from '../../utils/i18n.ts';
import { expect, firstBand, test } from '../../utils/custom-fixtures.ts';

test.use({ storageState: ADMIN_STATE });

const bands = hr.organization.hourBands;

test('the hour band list shows the fixture bands', async ({ hourBandsPage, fixture }) => {
  await hourBandsPage.goto();

  await expect(hourBandsPage.listHeading).toBeVisible();
  for (const band of fixture.bands) {
    await expect(hourBandsPage.editLink(band.name)).toBeVisible();
  }
});

/**
 * A start no other attempt in this run uses. A start is unique per
 * organization, and a retry or a `--repeat-each` copy runs against the same
 * one, so the start is `hour`:MM with MM derived from the attempt: ten minutes
 * per repeat, one per retry. Each start a test writes owns its own hour (the
 * add 01, the edit's new band 03 and its moved start 05), so no two tests'
 * starts meet; the fixture's 07:00 and 19:00 lie outside all of them. An
 * offset that would leave its hour throws rather than wander into another's.
 */
function attemptStart(hour: number, testInfo: TestInfo): string {
  const minute = testInfo.repeatEachIndex * 10 + testInfo.retry;
  if (minute >= 60) throw new Error(`E2E: attempt offset ${String(minute)} leaves the hour ${String(hour)}`);

  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** Minutes past midnight of an `HH:MM`. */
function minuteOf(time: string): number {
  const [hours = 0, minutes = 0] = time.split(':').map(Number);

  return hours * 60 + minutes;
}

/** The duration line from `start` to a later `end` on the same day, as `hr.json` words it. */
function durationBetween(start: string, end: string): string {
  const total = minuteOf(end) - minuteOf(start);
  const hours = String(Math.floor(total / 60));
  const minutes = String(total % 60);

  if (total % 60 === 0) return fill(bands.duration.hours, { hours });
  if (total < 60) return fill(bands.duration.minutes, { minutes });

  return fill(bands.duration.hoursMinutes, { hours, minutes });
}

test('adding a band lists it', async ({ hourBandsPage }, testInfo) => {
  const name = `Popodne ${randomBytes(3).toString('hex')}`;

  await hourBandsPage.goto();
  // The add form is a dialog, opened from the explainer.
  await hourBandsPage.openButton.click();
  await expect(hourBandsPage.addDialog).toBeVisible();
  await hourBandsPage.nameInput.fill(name);
  await hourBandsPage.startInput.fill(attemptStart(1, testInfo));
  await hourBandsPage.addButton.click();

  // The dialog closes on success, and the confirmation is on the page.
  await expect(hourBandsPage.dialog()).toBeHidden();
  await expect(hourBandsPage.status).toHaveText(bands.created);
  await expect(hourBandsPage.editLink(name)).toBeVisible();
});

/**
 * Holds every `POST` to one PostgREST table until released, for this test's
 * page only: the create stays in flight for as long as the assertions need.
 * #89's hold, for the team insert, on a table named by the caller.
 */
function heldInsert(table: string) {
  let release: () => void = () => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  let reached: () => void = () => undefined;
  const inFlight = new Promise<void>((resolve) => {
    reached = resolve;
  });
  const matches = (url: URL): boolean => url.pathname.endsWith(`/rest/v1/${table}`);
  const handler = async (route: Route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    reached();
    await released;
    return route.continue();
  };

  return { matches, handler, inFlight, release: () => release() };
}

test('the add dialog cannot be dismissed while its create is in flight, and confirms once it lands', async ({
  page,
  hourBandsPage,
}, testInfo) => {
  // ITS OWN BAND, per attempt, in an hour no other test writes in (21), after
  // the fixture's last start, so no other test's end moves.
  const name = `Kasno ${randomBytes(3).toString('hex')}`;
  const hold = heldInsert('hour_bands');

  await hourBandsPage.goto();
  await page.route(hold.matches, hold.handler);
  try {
    await hourBandsPage.openButton.click();
    await hourBandsPage.nameInput.fill(name);
    await hourBandsPage.startInput.fill(attemptStart(21, testInfo));
    await hourBandsPage.addButton.click();
    await hold.inFlight;

    // Cancel is disabled, and Escape (once, twice, three times) and the close
    // control do nothing.
    await expect(hourBandsPage.addDialogCancel).toBeDisabled();
    // ESCAPE, AGAIN AND AGAIN: a second Escape with no user activation between
    // is one the browser's close watcher will not let a `cancel` stop.
    await hourBandsPage.nameInput.press('Escape');
    await expect(hourBandsPage.addDialog).toBeVisible();
    // Pressed from the keyboard with the field kept focused, so a close the
    // dialog then undoes still shows: focus would move to its first control.
    for (const presses of [2, 3]) {
      await hourBandsPage.nameInput.focus();
      for (let press = 0; press < presses; press += 1) await page.keyboard.press('Escape');
      await expect(hourBandsPage.addDialog, `${String(presses)} Escapes closed the dialog`).toBeVisible();
      await expect(
        hourBandsPage.nameInput,
        `${String(presses)} Escapes closed and reopened it`,
      ).toBeFocused();
    }
    await hourBandsPage.addDialogClose.click();
    await expect(hourBandsPage.addDialog).toBeVisible();
    await expect(hourBandsPage.addDialogCancel).toBeDisabled();
  } finally {
    // Released even on a failure; the route stays until the held request has
    // gone on, since unrouting first would drop it.
    hold.release();
  }

  // Released: the create lands, the dialog closes and the page confirms.
  await expect(hourBandsPage.status).toHaveText(bands.created);
  await expect(hourBandsPage.addDialog).toBeHidden();
  await expect(hourBandsPage.editLink(name)).toBeVisible();
  await page.unroute(hold.matches, hold.handler);

  // Removed at the end, so this test leaves no band behind to move another's end.
  await hourBandsPage.editLink(name).click();
  await hourBandsPage.removeButton(name).click();
  await hourBandsPage.removeConfirmButton(name).click();
  await expect(hourBandsPage.statusWith(bands.removed)).toBeVisible();
});

test('editing a band opens it in a dialog over the list, and its close returns to the list', async ({
  page,
  hourBandsPage,
  fixture,
}) => {
  const band = firstBand(fixture);

  await hourBandsPage.goto();
  await hourBandsPage.editLink(band.name).click();

  const dialog = hourBandsPage.editDialog;

  await expect(dialog).toBeVisible();
  await expect(hourBandsPage.editDialogName).toHaveValue(band.name);
  // The list stays behind it.
  await expect(hourBandsPage.listHeading).toBeAttached();

  await hourBandsPage.editDialogClose.click();
  await expect(page).toHaveURL('/organizacija/satni-pojasi');
  await expect(hourBandsPage.dialog()).toBeHidden();
});

test('a start another band holds is refused in the dialog, keeping what was typed, with the start focused', async ({
  hourBandsPage,
  fixture,
}) => {
  // Nothing is written: the fixture's own start is refused.
  const band = firstBand(fixture);
  const name = `Zauzeto ${randomBytes(3).toString('hex')}`;

  await hourBandsPage.goto();
  await hourBandsPage.openButton.click();
  await hourBandsPage.nameInput.fill(name);
  await hourBandsPage.startInput.fill(band.start);
  await hourBandsPage.addButton.click();

  await expect(hourBandsPage.addDialog).toBeVisible();
  await expect(hourBandsPage.addDialogRefusal).toHaveText(bands.error.startTaken);
  await expect(hourBandsPage.nameInput).toHaveValue(name);
  await expect(hourBandsPage.startInput).toHaveValue(band.start);
  await expect(hourBandsPage.startInput).toBeFocused();
  await expect(hourBandsPage.startInput).toHaveAttribute('aria-invalid', 'true');

  // Nothing was added: closed, the list does not hold the typed name.
  await hourBandsPage.addDialogCancel.click();
  await expect(hourBandsPage.dialog()).toBeHidden();
  await expect(hourBandsPage.editLink(name)).toHaveCount(0);
});

test('the add dialog shows the end a typed start will run to, before anything is saved', async ({
  hourBandsPage,
}) => {
  // Nothing is written. 08:00 lies between the fixture's 07:00 and 19:00, and
  // no test writes a band in that span, so the next start is always 19:00.
  await hourBandsPage.goto();
  await hourBandsPage.openButton.click();
  await expect(hourBandsPage.addDialogEnd).toHaveText(bands.endPending);

  await hourBandsPage.startInput.fill('08:00');
  await expect(hourBandsPage.addDialogEnd).toHaveText('19:00');
  await expect(hourBandsPage.addDialogText(fill(bands.duration.hours, { hours: '11' }))).toBeVisible();

  await hourBandsPage.addDialogCancel.click();
  await expect(hourBandsPage.dialog()).toBeHidden();
});

test('an edited band shows its new end before it is saved, saves, keeps what was typed through a cancelled removal, and is removed', async ({
  page,
  hourBandsPage,
}, testInfo) => {
  // ITS OWN BAND, per attempt, added in the hour no other test writes in
  // (03), then moved into another (05). The next start after the moved one is
  // the fixture's 07:00 — or, under `--repeat-each`, a concurrent copy's later
  // 05 start — so the end is asserted as what is guaranteed: a time after the
  // moved start, and no later than 07:00.
  const name = `Rano ${randomBytes(3).toString('hex')}`;
  const renamed = `${name} novo`;
  const moved = attemptStart(5, testInfo);

  await hourBandsPage.goto();
  await hourBandsPage.addBand(name, attemptStart(3, testInfo));
  await hourBandsPage.editLink(name).click();
  await expect(hourBandsPage.editDialog).toBeVisible();

  // The end follows the start as typed, before the save.
  await hourBandsPage.editDialogStart.fill(moved);
  await expect(hourBandsPage.editDialogEnd).toHaveText(/^\d{2}:\d{2}$/);
  await expect
    .poll(async () => {
      const end = ((await hourBandsPage.editDialogEnd.textContent()) ?? '').trim();

      return end > moved && end <= '07:00';
    }, { message: `the end lies after ${moved} and no later than 07:00` })
    .toBe(true);
  // And the duration is computed from the moved start, not the stored one.
  const end = ((await hourBandsPage.editDialogEnd.textContent()) ?? '').trim();
  await expect(hourBandsPage.editDialogText(durationBetween(moved, end))).toBeVisible();
  await hourBandsPage.editDialogSave.click();
  await expect(hourBandsPage.statusWith(bands.saved)).toBeVisible();
  await expect(hourBandsPage.editDialogStart).toHaveValue(moved);

  // A cancelled removal returns to the form with what was typed.
  await hourBandsPage.editDialogName.fill(renamed);
  await hourBandsPage.removeButton(name).click();
  await expect(hourBandsPage.removePrompt(name)).toBeVisible();
  await expect(hourBandsPage.editDialogName).toBeHidden();
  await hourBandsPage.removeCancelButton.click();
  await expect(hourBandsPage.editDialogName).toHaveValue(renamed);

  // A confirmed removal: focus goes to the dialog's close, since the pressed
  // button is gone with the band, and once closed the list no longer holds it.
  await hourBandsPage.removeButton(name).click();
  await hourBandsPage.removeConfirmButton(name).click();
  await expect(hourBandsPage.statusWith(bands.removed)).toBeVisible();
  await expect(hourBandsPage.editDialogClose).toBeFocused();

  await hourBandsPage.editDialogClose.click();
  await expect(page).toHaveURL('/organizacija/satni-pojasi');
  await expect(hourBandsPage.editLink(name)).toHaveCount(0);
});
