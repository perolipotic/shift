import { requireAdminAuth, requireStack } from './database-helper.ts';
import { provision, sweepStale } from './run-fixture.ts';

/**
 * Before any test: refuse to start without the stack (database and GoTrue) or
 * without the admin-auth function served for the app's origin, clear what
 * crashed runs left behind, then provision this run's own organization.
 */
export default async function globalSetup(): Promise<void> {
  await requireStack();
  await requireAdminAuth();
  await sweepStale();
  await provision();
}
