import { test as base } from '@playwright/test';

import { readFixture, type Fixture, type FixtureBand } from './fixture.ts';

export { expect } from '@playwright/test';

/**
 * `test` with the run's fixture as a worker-scoped Playwright fixture: read on
 * first use inside a test, never when a spec file is loaded, so listing the
 * suite needs no provisioned run.
 */
export const test = base.extend<object, { fixture: Fixture }>({
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
