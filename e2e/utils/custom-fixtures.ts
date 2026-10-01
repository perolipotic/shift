import { test as base } from '@playwright/test';

import { CalendarPage } from '../pages/calendar.page.ts';
import { ConflictsPage } from '../pages/conflicts.page.ts';
import { HourBandsPage } from '../pages/hour-bands.page.ts';
import { HoursPage } from '../pages/hours.page.ts';
import { LeavePage } from '../pages/leave.page.ts';
import { LoginPage } from '../pages/login.page.ts';
import { OrganizationPage } from '../pages/organization.page.ts';
import { PeoplePage } from '../pages/people.page.ts';
import { RotationPage } from '../pages/rotation.page.ts';
import { TeamsPage } from '../pages/teams.page.ts';
import { holdRotation, type RotationHold } from './database-helper.ts';
import { readFixture, type Fixture, type FixtureBand } from './run-fixture.ts';

export { expect } from '@playwright/test';

/** One page object per screen, each over the test's own `page`. */
export interface PageObjects {
  readonly loginPage: LoginPage;
  readonly calendarPage: CalendarPage;
  readonly conflictsPage: ConflictsPage;
  readonly peoplePage: PeoplePage;
  readonly teamsPage: TeamsPage;
  readonly organizationPage: OrganizationPage;
  readonly hourBandsPage: HourBandsPage;
  readonly hoursPage: HoursPage;
  readonly leavePage: LeavePage;
  readonly rotationPage: RotationPage;
}

/**
 * Adds a team under the run's rotation hold, released as soon as the add
 * lands. The builder opens as the rotation in force only while EVERY active
 * team has one, so a team added between a rotation spec's save and its
 * reload would empty that spec's prefill; the rotation specs hold the same
 * lock around that window. Held only around the add, never for the rest of
 * the test, so no other holder waits longer than an add takes.
 */
export interface RotationHoldFixtures {
  readonly holdRotationForTeams: (add: () => Promise<void>) => Promise<void>;
}

/**
 * `test` with the screens' page objects as test-scoped fixtures, and the run's
 * fixture as a worker-scoped one: read on first use inside a test, never when
 * a spec file is loaded, so listing the suite needs no provisioned run.
 */
export const test = base.extend<PageObjects & RotationHoldFixtures, { fixture: Fixture }>({
  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },
  calendarPage: async ({ page }, use) => {
    await use(new CalendarPage(page));
  },
  conflictsPage: async ({ page }, use) => {
    await use(new ConflictsPage(page));
  },
  peoplePage: async ({ page }, use) => {
    await use(new PeoplePage(page));
  },
  teamsPage: async ({ page }, use) => {
    await use(new TeamsPage(page));
  },
  organizationPage: async ({ page }, use) => {
    await use(new OrganizationPage(page));
  },
  hourBandsPage: async ({ page }, use) => {
    await use(new HourBandsPage(page));
  },
  hoursPage: async ({ page }, use) => {
    await use(new HoursPage(page));
  },
  leavePage: async ({ page }, use) => {
    await use(new LeavePage(page));
  },
  rotationPage: async ({ page }, use) => {
    await use(new RotationPage(page));
  },
  holdRotationForTeams: async ({ fixture }, use, testInfo) => {
    await use(async (add) => {
      // Waiting for another holder may take a while.
      testInfo.slow();
      const hold: RotationHold = holdRotation(fixture.slug);
      try {
        await hold.ready;
      } catch (cause) {
        // An acquire that failed or timed out: the wait is still ended, but a
        // failure to end it must not replace the acquire's own error.
        await hold.release().catch(() => undefined);
        throw cause;
      }
      try {
        await add();
      } finally {
        await hold.release();
      }
    });
  },
  fixture: [
    // eslint-disable-next-line no-empty-pattern -- Playwright requires the destructuring
    async ({}, use) => {
      await use(readFixture());
    },
    { scope: 'worker' },
  ],
});

/** The fixture's first band; `readFixture` guarantees there is one. */
export function firstBand(fixture: Fixture): FixtureBand {
  const band = fixture.bands[0];
  if (band === undefined) throw new Error('E2E: the fixture holds no hour band');
  return band;
}
