import { forgetRun, readRunSlug, teardown } from './support/fixture.ts';

/**
 * After every test: delete this run's organization and its auth users, then the
 * stored sessions that belonged to them. Runs even when globalSetup failed, so
 * it tolerates a run that never provisioned anything, and forgets the stored
 * sessions even when the delete fails.
 */
export default async function globalTeardown(): Promise<void> {
  try {
    const slug = readRunSlug();

    if (slug !== null) await teardown(slug);
  } finally {
    forgetRun();
  }
}
