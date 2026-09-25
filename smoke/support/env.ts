import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * What the remote smoke is pointed at.
 *
 *   SMOKE_BASE_URL          the deployed origin (read by `playwright.smoke.config.ts`)
 *   SMOKE_SUPABASE_URL      that environment's project URL
 *   SMOKE_PUBLISHABLE_KEY   that environment's `sb_publishable_*`
 *   SMOKE_ORG, SMOKE_USERNAME, SMOKE_PASSWORD
 *                           optional: a dedicated smoke account (DEPLOY.md §7);
 *                           all three set runs the sign-in case, none set
 *                           skips it, and one or two set is a configuration
 *                           error that fails the run
 *
 * The project URL and publishable key fall back to `apps/web/.env.local`, the
 * values a local dev server was started with, so the local run needs only
 * `SMOKE_BASE_URL`. The publishable key is public by design (it is inlined into
 * every bundle); nothing here reads or needs the secret key.
 */

const LOCAL_ENV = fileURLToPath(new URL('../../apps/web/.env.local', import.meta.url));

function fromLocalEnv(name: string): string | undefined {
  if (!existsSync(LOCAL_ENV)) return undefined;
  const line = readFileSync(LOCAL_ENV, 'utf8')
    .split('\n')
    .find((entry) => entry.startsWith(`${name}=`));
  return unquote(line?.slice(name.length + 1).trim() ?? '') || undefined;
}

/** `KEY="value"` and `KEY='value'` are both valid dotenv; the quotes are not
 *  part of the value. */
function unquote(value: string): string {
  const quoted = /^(["'])(.*)\1$/.exec(value);
  return quoted === null ? value : (quoted[2] ?? '');
}

function value(name: string): string | undefined {
  return process.env[name]?.trim() || undefined;
}

function required(name: string, fallback: string): string {
  const found = value(name) ?? fromLocalEnv(fallback);
  if (found === undefined) {
    throw new Error(`smoke: set ${name} (or ${fallback} in apps/web/.env.local for a local run)`);
  }
  return found;
}

/** The environment's Supabase project URL, without a trailing slash. */
export function supabaseUrl(): string {
  return required('SMOKE_SUPABASE_URL', 'VITE_SUPABASE_URL').replace(/\/+$/, '');
}

/** The environment's publishable key. */
export function publishableKey(): string {
  return required('SMOKE_PUBLISHABLE_KEY', 'VITE_SUPABASE_PUBLISHABLE_KEY');
}

export interface SmokeAccount {
  readonly organization: string;
  readonly username: string;
  readonly password: string;
}

/**
 * The smoke account, or `null` when none of its three variables is set.
 *
 * THROWS when some but not all are set: that is a half-configured account, and
 * silently skipping the sign-in case would report green on a check nobody ran.
 * A whitespace-only password counts as unset; any other password is used
 * exactly as given, since spaces can be part of one.
 */
export function smokeAccount(): SmokeAccount | null {
  const organization = value('SMOKE_ORG');
  const username = value('SMOKE_USERNAME');
  const rawPassword = process.env['SMOKE_PASSWORD'] ?? '';
  const password = rawPassword.trim() === '' ? undefined : rawPassword;

  const set = { SMOKE_ORG: organization, SMOKE_USERNAME: username, SMOKE_PASSWORD: password };
  const absent = Object.entries(set)
    .filter(([, entry]) => entry === undefined)
    .map(([name]) => name);

  if (absent.length === 3) return null;
  if (organization === undefined || username === undefined || password === undefined) {
    throw new Error(`smoke: the smoke account is half configured — ${absent.join(' and ')} not set; set all three or none`);
  }
  return { organization, username, password };
}
