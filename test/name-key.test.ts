import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from 'pg';
import { describe, expect, it } from 'vitest';

import { isBlankName, nameKey } from '../apps/web/src/utils/name.ts';

/**
 * `0024`: every name check strips all white space, and name uniqueness compares
 * Unicode-normalized names — executed against the live database.
 *
 * Every write here runs as `authenticated` with the pilot admin's claims
 * injected, inside a transaction that is rolled back, so the refusals are the
 * ones a direct API caller meets and nothing is left behind. Running as the
 * request role is also what shows `name_key` is executable by it: a check or
 * an index expression is permission-checked against the writer.
 *
 * A database-less checkout reports every case as SKIPPED, as
 * `test/provisioning.test.ts` does.
 */

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

const databaseUrl =
  process.env['SUPABASE_DB_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

async function reachable(): Promise<boolean> {
  const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 2000 });
  try {
    await client.connect();
    await client.end();
    return true;
  } catch {
    return false;
  }
}

const noDatabase = !(await reachable());

/**
 * The local API and its publishable key, or `undefined`: read from `supabase
 * status` once, as `test/rls-isolation.test.ts` does, so no key is tracked.
 */
const apiEndpoint: { readonly url: string; readonly key: string } | undefined = (() => {
  if (noDatabase) return undefined;
  try {
    const status = execFileSync(join(repoRoot, 'node_modules', '.bin', 'supabase'), ['status', '-o', 'json'], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const fields = JSON.parse(status) as Record<string, unknown>;
    const key = fields['PUBLISHABLE_KEY'] ?? fields['ANON_KEY'];
    const url = fields['API_URL'] ?? 'http://127.0.0.1:54321';
    return typeof key === 'string' && typeof url === 'string' ? { url, key } : undefined;
  } catch {
    return undefined;
  }
})();

const noApi = noDatabase || apiEndpoint === undefined;

/** `supabase/seed.sql` — one password, shared, local and test only. */
const FIXTURE_PASSWORD = 'local-fixture-password';

async function connect(): Promise<Client> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  return client;
}

const PILOT = 'dvd-kastel-novi';
const PILOT_ADMIN = 'ivan.maric';
const PILOT_MEMBER = 'ana.kovac';

interface Admin {
  readonly authUserId: string;
  readonly memberId: string;
  readonly organizationId: string;
}

async function pilotAdmin(client: Client): Promise<Admin> {
  const { rows } = await client.query<Admin>(
    `select m.auth_user_id as "authUserId", m.id as "memberId", m.organization_id as "organizationId"
       from members m join organizations o on o.id = m.organization_id
      where o.slug = $1 and m.username = $2`,
    [PILOT, PILOT_ADMIN],
  );
  const admin = rows[0];
  if (admin === undefined) throw new Error('the pilot admin is not seeded');
  return admin;
}

/** A transaction as the pilot admin, always rolled back. */
async function asPilotAdmin(run: (client: Client, admin: Admin) => Promise<void>): Promise<void> {
  const client = await connect();
  try {
    await client.query('begin');
    const admin = await pilotAdmin(client);
    await client.query('select set_config($1, $2, true)', [
      'request.jwt.claims',
      JSON.stringify({ sub: admin.authUserId, role: 'authenticated', organization_id: admin.organizationId }),
    ]);
    await client.query('set local role authenticated');
    await run(client, admin);
  } finally {
    await client.query('rollback');
    await client.end();
  }
}

interface Refusal {
  readonly code: string | undefined;
  readonly constraint: string | undefined;
}

/** Run one statement under a savepoint: `null` when it landed, else its refusal. */
async function attempt(client: Client, sql: string, params: readonly unknown[]): Promise<Refusal | null> {
  await client.query('savepoint attempt');
  try {
    await client.query(sql, [...params]);
    await client.query('release savepoint attempt');
    return null;
  } catch (cause) {
    await client.query('rollback to savepoint attempt');
    const error = cause as { code?: string; constraint?: string };
    return { code: error.code, constraint: error.constraint };
  }
}

/** Blank in `0024`'s class; the three the spec names first. */
const BLANK_NAMES = [
  { label: 'a tab', name: '\t' },
  { label: 'a newline', name: '\n' },
  { label: 'an NBSP', name: '\u00A0' },
  { label: 'a narrow NBSP and a figure space', name: '\u202F\u2007' },
  { label: 'a BOM and a NEL', name: '\uFEFF\u0085' },
];

const ACCEPTED_NAMES = ['Probno ime', 'Probno  ime s\u00A0razmacima'];

/**
 * One writer per table, each naming the constraint a refusal must name. The
 * `write` takes the name and a distinguishing index (for hour bands' start).
 */
const BLANK_TABLES = [
  {
    table: 'organizations',
    constraint: 'organizations_name_check',
    write: (client: Client, admin: Admin, name: string) =>
      attempt(client, 'update organizations set name = $1 where id = $2', [name, admin.organizationId]),
  },
  {
    table: 'members',
    constraint: 'members_name_check',
    write: (client: Client, admin: Admin, name: string) =>
      attempt(client, 'update members set name = $1 where id = $2', [name, admin.memberId]),
  },
  {
    table: 'teams',
    constraint: 'teams_name_not_blank',
    write: (client: Client, admin: Admin, name: string) =>
      attempt(client, 'insert into teams (organization_id, name) values ($1, $2)', [admin.organizationId, name]),
  },
  {
    table: 'hour_bands',
    constraint: 'hour_bands_name_not_blank',
    write: (client: Client, admin: Admin, name: string, index = 0) =>
      attempt(client, 'insert into hour_bands (organization_id, name, start_time) values ($1, $2, $3)', [
        admin.organizationId,
        name,
        `03:${String(10 + index).padStart(2, '0')}`,
      ]),
  },
  {
    table: 'shift_types',
    constraint: 'shift_types_name_not_blank',
    write: (client: Client, admin: Admin, name: string) =>
      attempt(client, 'insert into shift_types (organization_id, name, is_working) values ($1, $2, false)', [
        admin.organizationId,
        name,
      ]),
  },
];

const UNIQUE_TABLES = BLANK_TABLES.filter((entry) =>
  ['teams', 'hour_bands', 'shift_types'].includes(entry.table),
).map((entry) => ({ ...entry, unique: `${entry.table}_organization_name_key` }));

describe('every name check refuses a name of white space alone (0024)', () => {
  it.skipIf(noDatabase).each(BLANK_TABLES)('$table', async ({ constraint, write }) => {
    await asPilotAdmin(async (client, admin) => {
      for (const [index, { label, name }] of BLANK_NAMES.entries()) {
        expect(await write(client, admin, name, index), `${label} was stored`).toEqual({
          code: '23514',
          constraint,
        });
      }
      for (const [index, name] of ACCEPTED_NAMES.entries()) {
        expect(await write(client, admin, name, 20 + index), `${name} was refused`).toBeNull();
      }
    });
  });
});

describe('name uniqueness compares trimmed, NFC, lower-cased names (0024)', () => {
  it.skipIf(noDatabase).each(UNIQUE_TABLES)('$table', async ({ unique, write }) => {
    await asPilotAdmin(async (client, admin) => {
      expect(await write(client, admin, 'Probni X', 0), 'the first name was refused').toBeNull();
      for (const [index, padded] of ['Probni X\t', '\u00A0probni x', 'PROBNI X\u202F'].entries()) {
        expect(await write(client, admin, padded, 1 + index), `${JSON.stringify(padded)} was stored`).toEqual({
          code: '23505',
          constraint: unique,
        });
      }

      const composed = 'Probna Noć';
      const decomposed = 'Probna Noc\u0301';
      expect(composed).not.toBe(decomposed);
      expect(await write(client, admin, composed, 10), 'the NFC name was refused').toBeNull();
      expect(await write(client, admin, decomposed, 11), 'the NFD twin was stored').toEqual({
        code: '23505',
        constraint: unique,
      });

      // Internal white space still tells names apart.
      expect(await write(client, admin, 'Probni  X', 12), 'an internal space made a duplicate').toBeNull();
    });
  });

  it.skipIf(noDatabase)('stores a valid name exactly as it was written', async () => {
    await asPilotAdmin(async (client, admin) => {
      const decomposed = 'Probna Noc\u0301';
      const { rows } = await client.query<{ name: string }>(
        'insert into teams (organization_id, name) values ($1, $2) returning name',
        [admin.organizationId, decomposed],
      );
      expect(rows[0]?.name).toBe(decomposed);
    });
  });
});

describe('the client and the database agree on a name (0024)', () => {
  const BMP = Array.from({ length: 0xffff }, (_, index) => index + 1).filter(
    (codePoint) => codePoint < 0xd800 || codePoint > 0xdfff,
  );

  it.skipIf(noDatabase)('on which code points are blank, over the whole BMP', async () => {
    const client = await connect();
    try {
      const { rows } = await client.query<{ code: number }>(
        `select c as code from generate_series(1, 65535) c
          where c not between 55296 and 57343 and private.name_key(chr(c)) = ''
          order by c`,
      );
      const database = rows.map((row) => row.code);
      const browser = BMP.filter((codePoint) => isBlankName(String.fromCodePoint(codePoint)));

      expect(browser.map((code) => code.toString(16))).toEqual(database.map((code) => code.toString(16)));
    } finally {
      await client.end();
    }
  });

  it.skipIf(noDatabase)('covering all Postgres\'s `\\s` and all of `String.prototype.trim`', async () => {
    const client = await connect();
    try {
      const { rows } = await client.query<{ code: number }>(
        `select c as code from generate_series(1, 65535) c
          where c not between 55296 and 57343
            and (chr(c) ~ '^\\s$' or chr(c) ~ '^[[:space:]]$')
            and private.name_key(chr(c)) <> ''`,
      );
      expect(rows, 'Postgres counts these as white space and name_key keeps them').toEqual([]);

      const trimmed = BMP.filter((codePoint) => String.fromCodePoint(codePoint).trim() === '');
      expect(trimmed.filter((codePoint) => !isBlankName(String.fromCodePoint(codePoint)))).toEqual([]);
    } finally {
      await client.end();
    }
  });

  const NAMES = [
    'Tim',
    'Tim\t',
    ' \u00A0Tim\u2007\n',
    '\uFEFFTim\u0085',
    '\u001CTim\u001F',
    'Noć',
    'Noc\u0301',
    'NOC\u0301NA SMJENA',
    'Čađa Šuma Žuta',
    'C\u030Cađa',
    'Ǆep',
    'Ana\u00A0Marija',
    'Ana  Marija',
    '\u200BTim',
  ];

  it.skipIf(noDatabase).each(NAMES.map((name) => [name]))('on the key of %j', async (name) => {
    const client = await connect();
    try {
      const { rows } = await client.query<{ key: string }>('select private.name_key($1) as key', [name]);
      expect(rows[0]?.key).toBe(nameKey(name));
    } finally {
      await client.end();
    }
  });
});

describe('name_key is no RPC, and trims in linear time (0024)', () => {
  it.skipIf(noApi)('refuses a signed-in member calling it over PostgREST', async () => {
    // `private` is not in `supabase/config.toml`'s exposed schemas, so the
    // function is not in PostgREST's schema cache at all: not a privilege
    // refusal (42501) but "no such function" (PGRST202), answered 404.
    const endpoint = apiEndpoint;
    if (endpoint === undefined) throw new Error('unreachable: gated by skipIf');

    const signIn = await fetch(`${endpoint.url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: endpoint.key, 'content-type': 'application/json' },
      body: JSON.stringify({ email: `${PILOT_MEMBER}@${PILOT}.shift.invalid`, password: FIXTURE_PASSWORD }),
    });
    const { access_token: token } = (await signIn.json()) as { access_token?: string };
    expect(token, `${PILOT_MEMBER} could not sign in: ${signIn.status}`).toEqual(expect.any(String));

    const response = await fetch(`${endpoint.url}/rest/v1/rpc/name_key`, {
      method: 'POST',
      headers: {
        apikey: endpoint.key,
        Authorization: `Bearer ${token ?? ''}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ name: ' Tim ' }),
    });
    const body = (await response.json()) as { code?: string };

    expect(response.status, 'a member reached name_key as an RPC').toBe(404);
    expect(body.code).toBe('PGRST202');
  });

  it.skipIf(noDatabase)('opens `private` to the two writing roles and to nobody else', async () => {
    // A stored check or index expression names `name_key` by OID, so writes
    // need EXECUTE, not USAGE (a revoked USAGE still lets every write through).
    // USAGE is granted anyway so that a writer's own statement may name the
    // function; it is pinned here so it cannot widen to `anon` or PUBLIC.
    const client = await connect();
    try {
      const { rows } = await client.query<{ role: string; usage: boolean }>(
        `select role, pg_catalog.has_schema_privilege(role, 'private', 'USAGE') as usage
           from unnest(array['anon', 'authenticated', 'service_role']) as role order by role`,
      );
      expect(rows).toEqual([
        { role: 'anon', usage: false },
        { role: 'authenticated', usage: true },
        { role: 'service_role', usage: true },
      ]);
      const { rows: acl } = await client.query<{ publicUsage: boolean }>(
        `select exists (select 1 from pg_namespace n, aclexplode(n.nspacl) a
                         where n.nspname = 'private' and a.grantee = 0) as "publicUsage"`,
      );
      expect(acl[0]?.publicUsage, 'PUBLIC holds a privilege on private').toBe(false);
    } finally {
      await client.end();
    }
  });

  it.skipIf(noDatabase)('lets a secret-key operator update any column of the five tables', async () => {
    // A check runs on EVERY update of its row, whatever column it names, and
    // it is permission-checked against the writer. So `service_role` must hold
    // USAGE on `private` and EXECUTE on `name_key`, or an operator update of a
    // leave allowance would fail with `permission denied for function`.
    const client = await connect();
    try {
      await client.query('begin');
      const admin = await pilotAdmin(client);
      await client.query('set local role service_role');
      for (const [table, id] of [
        ['organizations', admin.organizationId],
        ['members', admin.memberId],
      ] as const) {
        const { rowCount } = await client.query(`update ${table} set name = name where id = $1`, [id]);
        expect(rowCount, `${table} was not updated`).toBe(1);
      }
      for (const table of ['teams', 'hour_bands', 'shift_types']) {
        await client.query(`update ${table} set name = name where organization_id = $1`, [admin.organizationId]);
      }
      const { rowCount } = await client.query(
        'update members set leave_allowance_days = leave_allowance_days where id = $1',
        [admin.memberId],
      );
      expect(rowCount).toBe(1);
    } finally {
      await client.query('rollback');
      await client.end();
    }
  });

  it.skipIf(noDatabase)('keys a 100 000-character pathological name inside a statement timeout', async () => {
    // `'a' || repeat(' ', n) || 'b'` is the input a backtracking trim costs
    // O(n²) on. The `statement_timeout` is what decides, not a clock read here:
    // `btrim` answers in about a millisecond, so five seconds is never close,
    // and a quadratic trim is cancelled with 57014 instead of hanging the run.
    const client = await connect();
    try {
      await client.query('begin');
      await client.query(`set local statement_timeout = '5s'`);
      const { rows } = await client.query<{ inside: number; padded: number; blank: string }>(
        `select pg_catalog.length(private.name_key('a' || repeat(' ', 100000) || 'b')) as inside,
                pg_catalog.length(private.name_key(repeat(' ', 100000) || 'a' || repeat(' ', 100000) || 'b' || repeat(' ', 100000))) as padded,
                private.name_key(repeat(E'\\u00a0', 100000)) as blank`,
      );
      expect(rows[0]).toEqual({ inside: 100_002, padded: 100_002, blank: '' });
    } finally {
      await client.query('rollback');
      await client.end();
    }
  });
});

describe('existing rows the new rules would refuse stop the migration (0024)', () => {
  const migration = readFileSync(join(repoRoot, 'supabase', 'migrations', '0024_name_key.sql'), 'utf8');
  const guard = /^do \$\$[\s\S]*?^\$\$;$/m.exec(migration)?.[0];

  it('carries one guard block', () => {
    expect(guard, 'no guard block in 0024').toBeDefined();
  });

  const CASES = [
    {
      label: 'a blank team',
      setup: [
        'alter table teams drop constraint teams_name_not_blank',
        `insert into teams (organization_id, name) values ($1, E'\\t')`,
      ],
      detail: 'teams (blank name)',
    },
    {
      label: 'a blank member',
      setup: ['alter table members drop constraint members_name_check', `update members set name = E'\\u00a0' where id = $2`],
      detail: 'members (blank name)',
    },
    {
      label: 'a blank organization',
      setup: [
        'alter table organizations drop constraint organizations_name_check',
        `update organizations set name = E'\\u2007' where id = $1`,
      ],
      detail: 'organizations (blank name)',
    },
    {
      label: 'a blank band',
      setup: [
        'alter table hour_bands drop constraint hour_bands_name_not_blank',
        `insert into hour_bands (organization_id, name, start_time) values ($1, E'\\u0085', '03:10')`,
      ],
      detail: 'hour_bands (blank name)',
    },
    {
      label: 'a blank type',
      setup: [
        'alter table shift_types drop constraint shift_types_name_not_blank',
        `insert into shift_types (organization_id, name, is_working) values ($1, E'\\ufeff', false)`,
      ],
      detail: 'shift_types (blank name)',
    },
    {
      label: 'two active teams with one key',
      setup: [
        'drop index teams_organization_name_key',
        `insert into teams (organization_id, name) values ($1, 'Probni X'), ($1, E'Probni X\\t')`,
      ],
      detail: 'teams (duplicate name)',
    },
    {
      label: 'two bands with one key',
      setup: [
        'drop index hour_bands_organization_name_key',
        `insert into hour_bands (organization_id, name, start_time)
           values ($1, E'Probna No\\u0107', '03:10'), ($1, E'Probna Noc\\u0301', '03:11')`,
      ],
      detail: 'hour_bands (duplicate name)',
    },
    {
      label: 'two active types with one key',
      setup: [
        'drop index shift_types_organization_name_key',
        `insert into shift_types (organization_id, name, is_working) values ($1, 'Probni', false), ($1, 'PROBNI ', false)`,
      ],
      detail: 'shift_types (duplicate name)',
    },
  ];

  /**
   * Plant the rows as the owner inside a transaction that is rolled back, then
   * run the guard: its refusal, or `null` when it passed.
   */
  async function guardAfter(
    setup: readonly string[],
  ): Promise<{ code?: string; message?: string; detail?: string } | null> {
    const client = await connect();
    try {
      await client.query('begin');
      const admin = await pilotAdmin(client);
      // Still the owner, so the dropped constraint stays dropped; the claims
      // only give `created_by`'s `auth.uid()` default someone to name.
      await client.query('select set_config($1, $2, true)', [
        'request.jwt.claims',
        JSON.stringify({ sub: admin.authUserId, role: 'authenticated' }),
      ]);
      for (const statement of setup) {
        const params = statement.includes('$2')
          ? [admin.organizationId, admin.memberId].slice(1)
          : statement.includes('$1')
            ? [admin.organizationId]
            : [];
        await client.query(statement.replace('$2', '$1'), params);
      }

      return await client.query(guard ?? '').then(
        () => null,
        (cause: { code?: string; message?: string; detail?: string }) => cause,
      );
    } finally {
      await client.query('rollback');
      await client.end();
    }
  }

  it.skipIf(noDatabase).each(CASES)('$label', async ({ setup, detail }) => {
    const refusal = await guardAfter(setup);

    expect(refusal?.code, 'the guard let the rows through').toBe('23514');
    expect(refusal?.message).toBe('NAME_KEY_CONFLICT');
    expect(refusal?.detail).toContain(detail);
  });

  // AN ARCHIVED ROW NEVER COMPETES. Both partial indexes bind active rows only,
  // so the guard's `where not archived` must too: an archived team or type
  // sharing a key with an active one is data 0024 admits, and refusing it
  // would stop the migration over rows nothing is wrong with.
  it.skipIf(noDatabase).each([
    {
      label: 'an archived team sharing a key with an active one',
      setup: [
        `insert into teams (organization_id, name, archived) values ($1, 'Probni X', false), ($1, E'probni x\\t', true)`,
      ],
    },
    {
      label: 'an archived type sharing a key with an active one',
      setup: [
        `insert into shift_types (organization_id, name, is_working, archived)
           values ($1, 'Probni', false, false), ($1, E'PROBNI\\u00a0', false, true)`,
      ],
    },
  ])('lets through $label', async ({ setup }) => {
    expect(await guardAfter(setup), 'the guard refused an archived duplicate').toBeNull();
  });

  // WHAT THIS DOES AND DOES NOT PROVE. `supabase db reset` applies 0024 to an
  // empty database and loads the seed afterwards, and the constraints already
  // hold for every row here, so this shows only that the guard's SQL runs
  // clean over the stored data. That the seed and demo data satisfy the new
  // rules is proved by their loading under the 0024 constraints at all.
  it.skipIf(noDatabase)('runs clean over the data the constraints already admit', async () => {
    expect(await guardAfter([])).toBeNull();
  });
});
