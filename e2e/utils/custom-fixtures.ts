import { test as base } from '@playwright/test';

import { CalendarPage } from '../pages/calendar.page.ts';
import { ConflictResolutionPage, ConflictsPage } from '../pages/conflicts.page.ts';
import { HourBandsPage } from '../pages/hour-bands.page.ts';
import { HoursPage } from '../pages/hours.page.ts';
import { LeavePage } from '../pages/leave.page.ts';
import { LoginPage } from '../pages/login.page.ts';
import { OrganizationPage } from '../pages/organization.page.ts';
import { PeoplePage } from '../pages/people.page.ts';
import { RotationPage } from '../pages/rotation.page.ts';
import { TeamsPage } from '../pages/teams.page.ts';
import { TodayPage } from '../pages/today.page.ts';
import { NotificationsPage } from '../pages/notifications.page.ts';
import { holdRotation, type RotationHold } from './database-helper.ts';
import { midnightWait } from './dates.ts';
import { readFixture, RUN_TIMEZONE, type Fixture, type FixtureBand } from './run-fixture.ts';

export { expect } from '@playwright/test';

/** One page object per screen, each over the test's own `page`. */
export interface PageObjects {
  readonly loginPage: LoginPage;
  readonly calendarPage: CalendarPage;
  readonly conflictsPage: ConflictsPage;
  readonly resolutionPage: ConflictResolutionPage;
  readonly peoplePage: PeoplePage;
  readonly teamsPage: TeamsPage;
  readonly organizationPage: OrganizationPage;
  readonly hourBandsPage: HourBandsPage;
  readonly hoursPage: HoursPage;
  readonly leavePage: LeavePage;
  readonly rotationPage: RotationPage;
  readonly todayPage: TodayPage;
  readonly notificationsPage: NotificationsPage;
}

/** Every page object at once, for a spec that picks the screen at run time. */
export interface PagesFixture {
  readonly pages: PageObjects;
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
 * Keeps every test on one side of midnight in the run's zone
 * (spec-today-spec-midnight-safe; epic 14 retro). A test reads "today" in
 * three places — its seed (`organization_today()` in SQL, or `new Date()` in
 * Zagreb), its page (the browser clock, `timezoneId: 'Europe/Zagreb'`) and
 * the RPCs the page calls — at different instants. (The four `today.spec.ts`
 * cases first blamed on a crossing failed on the hour instead: before 07:00
 * their free day read yesterday's Noć; spec-e2e-midnight-guard-gap.) One `now` is read as the
 * test starts: closer to midnight than `midnightWait` allows, the test waits
 * until just past it, its timeout raised by the wait. Playwright sets up auto
 * fixtures before the test's other fixtures, its `beforeEach` hooks and its
 * body; `beforeAll` hooks and worker fixtures run earlier and are NOT
 * covered, so no spec seeds relative to today in them.
 */
export interface MidnightGuardFixtures {
  readonly midnightGuard: void;
}

/**
 * `test` with the screens' page objects as test-scoped fixtures — one each,
 * and all of them as `pages` — and the run's
 * fixture as a worker-scoped one: read on first use inside a test, never when
 * a spec file is loaded, so listing the suite needs no provisioned run.
 */
export const test = base.extend<
  PageObjects & PagesFixture & RotationHoldFixtures & MidnightGuardFixtures,
  { fixture: Fixture }
>({
  midnightGuard: [
    // eslint-disable-next-line no-empty-pattern -- Playwright requires the destructuring
    async ({}, use, testInfo) => {
      // `test.slow()` in a body is not known yet; `midnightWait` keeps 8 min at least.
      const wait = midnightWait(new Date(), RUN_TIMEZONE, testInfo.timeout);
      if (wait > 0) {
        testInfo.annotations.push({
          type: 'midnight-wait',
          description: `started ${Math.ceil(wait / 1000)} s before 00:00:05 ${RUN_TIMEZONE}; waited until then`,
        });
        // 0 is no timeout at all (`--timeout=0`, `--debug`): left as it is.
        if (testInfo.timeout > 0) testInfo.setTimeout(testInfo.timeout + wait);
        await new Promise<void>((resolve) => setTimeout(resolve, wait));
      }
      await use();
    },
    { auto: true },
  ],
  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },
  calendarPage: async ({ page }, use) => {
    await use(new CalendarPage(page));
  },
  conflictsPage: async ({ page }, use) => {
    await use(new ConflictsPage(page));
  },
  resolutionPage: async ({ page }, use) => {
    await use(new ConflictResolutionPage(page));
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
  todayPage: async ({ page }, use) => {
    await use(new TodayPage(page));
  },
  notificationsPage: async ({ page }, use) => {
    await use(new NotificationsPage(page));
  },
  // The same objects the single fixtures hand out, gathered: never a second instance.
  pages: async (
    {
      loginPage,
      calendarPage,
      conflictsPage,
      resolutionPage,
      peoplePage,
      teamsPage,
      organizationPage,
      hourBandsPage,
      hoursPage,
      leavePage,
      rotationPage,
      todayPage,
      notificationsPage,
    },
    use,
  ) => {
    await use({
      loginPage,
      calendarPage,
      conflictsPage,
      resolutionPage,
      peoplePage,
      teamsPage,
      organizationPage,
      hourBandsPage,
      hoursPage,
      leavePage,
      rotationPage,
      todayPage,
      notificationsPage,
    });
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
