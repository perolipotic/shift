import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from 'pg';

/**
 * The live-database helpers every root DB suite shares.
 *
 * `provisioning`, `rls-isolation`, `concurrent-writes`, `demo-organization`
 * and `name-key` each carried their own copy of these, and the copies had
 * drifted: two probed connectivity only, two probed the schema, and the
 * fixture list existed in two shapes. One module keeps the readiness rule and
 * the fixture accounts the same everywhere. It is not a `.test.ts` file, so
 * vitest collects it only through the suites that import it (the same idiom
 * as `test/theme-css.ts`).
 */

/**
 * The Supabase CLI's fixed local default. Read from the environment when set,
 * so no credential for any other database is written down here.
 */
export const databaseUrl =
  process.env['SUPABASE_DB_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

/**
 * Whether there is a database here with this schema in it.
 *
 * Connected is not enough. `supabase db reset` ends by restarting containers,
 * and in that window Postgres accepts connections while no migration has been
 * applied, so a connect-only probe turns every case into a failure with
 * `relation "organizations" does not exist` instead of a skip. Connected AND
 * migrated, or not ready.
 */
export async function databaseReady(): Promise<boolean> {
  const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 2000 });
  try {
    await client.connect();
    const { rows } = await client.query<{ migrated: boolean }>(
      `select to_regclass('public.organizations') is not null
                and to_regclass('public.members') is not null as migrated`,
    );
    await client.end();
    return rows[0]?.migrated === true;
  } catch {
    await client.end().catch(() => undefined);
    return false;
  }
}

/**
 * A sanctioned module-scope await: `skipIf` is evaluated at collection time, so
 * the answer has to exist before the first `it` is registered. A
 * database-less checkout reports every DB case as SKIPPED, never as green
 * having asserted nothing.
 */
export const noDatabase = !(await databaseReady());

export async function connect(): Promise<Client> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  return client;
}

/**
 * Run `work` in a transaction that is always rolled back.
 *
 * `isolation` names a stronger level for a suite that compares before and
 * after and must not see another process's commits (`demo-organization`);
 * omitted, the transaction runs at the database default, read committed.
 */
export async function inRolledBackTransaction<T>(
  work: (client: Client) => Promise<T>,
  isolation?: 'repeatable read' | 'serializable',
): Promise<T> {
  const client = await connect();
  try {
    await client.query(isolation === undefined ? 'begin' : `begin isolation level ${isolation}`);
    return await work(client);
  } finally {
    await client.query('rollback').catch(() => undefined);
    await client.end();
  }
}

export interface Refusal {
  readonly code: string;
  readonly message: string;
  /** Present on a database refusal; an HTTP refusal (PostgREST, storage) carries none. */
  readonly detail?: string | undefined;
}

/**
 * Assert that `work` is refused, and hand back what the database raised.
 *
 * A refusal case that only asserts "it threw" passes when the schema breaks in
 * a different way — a typo in a column name throws too — so every caller
 * asserts the SQLSTATE (and usually the message) it hands back.
 */
export async function refused(work: () => Promise<unknown>): Promise<Refusal> {
  try {
    await work();
  } catch (cause) {
    const error = cause as { code?: string; message?: string; detail?: string };
    return {
      code: error.code ?? '',
      message: error.message ?? '',
      detail: error.detail,
    };
  }
  throw new Error('nothing was refused: the statement was permitted');
}

export async function organizationId(client: Client, slug: string): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    'select id from organizations where slug = $1',
    [slug],
  );
  const found = rows[0];
  if (found === undefined) throw new Error(`seed fixture ${slug} is not in the database`);
  return found.id;
}

/**
 * The two seed fixtures every rule is asserted against (AD-15, Q10), and the
 * three accounts a case needs in each: the organization's own admin, a
 * member-role account to attempt an administrative write as, and a second
 * member-role account to attempt it *on* — so a refusal has both a subject and
 * a bystander.
 *
 * Accounts are named by username rather than by display name: the username is
 * the local part of the synthesized sign-in address (AD-12), which is the one
 * key that reaches both GoTrue and the domain tables.
 */
export const FIXTURES = [
  {
    fixture: 'pilot',
    slug: 'dvd-kastel-novi',
    admin: 'ivan.maric',
    member: 'ana.kovac',
    bystander: 'marko.novak',
  },
  {
    fixture: 'UJ-5',
    slug: 'zastita-split',
    admin: 'josip.peric',
    member: 'lucija.simic',
    bystander: 'tomislav.juric',
  },
] as const;

/** The repository root: where the Supabase CLI is installed and run from. */
const repoRoot = fileURLToPath(new URL('..', import.meta.url));

/** The API gateway's default when `supabase status` names none. */
const DEFAULT_API_URL = 'http://127.0.0.1:54321';

/** `supabase status -o json`'s fields, read once per suite, or `undefined`. */
let statusFields: Record<string, unknown> | null | undefined;

/**
 * The local stack's `supabase status -o json`, spawned at most once per
 * suite and never inside a test: the keys are generated per stack, so
 * hard-coding one would both rot and put a key in a tracked file. `null` when
 * there is no database, no CLI, no running stack or a JSON shape we do not
 * know — the cases that need it then skip rather than fail for a reason that
 * is not theirs. `provisioning`, `rls-isolation` and `name-key` each carried
 * their own copy of this read.
 */
function supabaseStatus(): Record<string, unknown> | null {
  if (statusFields !== undefined) return statusFields;
  statusFields = null;
  if (noDatabase) return statusFields;
  try {
    const status = execFileSync(join(repoRoot, 'node_modules', '.bin', 'supabase'), ['status', '-o', 'json'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const parsed: unknown = JSON.parse(status);
    if (typeof parsed === 'object' && parsed !== null) statusFields = parsed as Record<string, unknown>;
  } catch {
    // No CLI or no running stack: every case that needs the API skips.
  }
  return statusFields;
}

/**
 * The local API endpoint and its publishable key, or `undefined`. The key is
 * read under either spelling the CLI has used.
 */
export function localApiEndpoint(): { readonly url: string; readonly key: string } | undefined {
  const fields = supabaseStatus();
  if (fields === null) return undefined;
  const key = fields['PUBLISHABLE_KEY'] ?? fields['ANON_KEY'];
  const url = fields['API_URL'] ?? DEFAULT_API_URL;
  return typeof key === 'string' && typeof url === 'string' ? { url, key } : undefined;
}

/**
 * The local stack's SECRET key, or `undefined`, for the cases that drive
 * GoTrue's admin API. A per-stack local value that never leaves this machine
 * (AD-17 confines the deployed secret to the Edge Function). Read under
 * either spelling the CLI has used, which is why a caller asserts it resolved
 * rather than letting a third rename skip its cases silently.
 */
export function localSecretKey(): string | undefined {
  const fields = supabaseStatus();
  if (fields === null) return undefined;
  const key = fields['SECRET_KEY'] ?? fields['SERVICE_ROLE_KEY'];
  return typeof key === 'string' && key.length > 0 ? key : undefined;
}
