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

async function connect(): Promise<Client> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  return client;
}

const PILOT = 'dvd-kastel-novi';
const PILOT_ADMIN = 'ivan.maric';

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
          where c not between 55296 and 57343 and public.name_key(chr(c)) = ''
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
            and public.name_key(chr(c)) <> ''`,
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
      const { rows } = await client.query<{ key: string }>('select public.name_key($1) as key', [name]);
      expect(rows[0]?.key).toBe(nameKey(name, 'hr'));
    } finally {
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

  it.skipIf(noDatabase).each(CASES)('$label', async ({ setup, detail }) => {
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

      const refusal = await client.query(guard ?? '').then(
        () => null,
        (cause: { code?: string; message?: string; detail?: string }) => cause,
      );

      expect(refusal?.code, 'the guard let the rows through').toBe('23514');
      expect(refusal?.message).toBe('NAME_KEY_CONFLICT');
      expect(refusal?.detail).toContain(detail);
    } finally {
      await client.query('rollback');
      await client.end();
    }
  });

  it.skipIf(noDatabase)('passes the seeded data', async () => {
    const client = await connect();
    try {
      await expect(client.query(guard ?? '')).resolves.toBeDefined();
    } finally {
      await client.end();
    }
  });
});
