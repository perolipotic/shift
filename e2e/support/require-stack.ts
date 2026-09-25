/**
 * Run by `playwright.config.ts` before `supabase functions serve`, with Node's
 * own type stripping. Playwright starts its web servers BEFORE globalSetup, so
 * with the stack down the first thing to fail would otherwise be the CLI, with a
 * message about containers rather than about what to do.
 */
import { requireStack } from './database.ts';

try {
  await requireStack();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
