import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import {
  LEAVE_ALLOWANCE_MAX as CLIENT_LEAVE_ALLOWANCE_MAX,
  MEMBER_CREATED as CLIENT_MEMBER_CREATED,
  PASSWORD_RESET as CLIENT_PASSWORD_RESET,
  USERNAME_CHANGED as CLIENT_USERNAME_CHANGED,
  MEMBER_WRITE_FUNCTION,
  RESET_PASSWORD_OPERATION,
  WIRE_CODES,
  editFailureOf,
  memberWriteFailureOf,
  memberWriteMessageKey,
} from '../apps/web/src/members/wire.ts';
import { normalizeUsername, signInAddress } from '../apps/web/src/supabase/address.ts';
import {
  ACCESS_UNREADABLE,
  ADMIN_ROLE,
  CURRENT_MEMBER_ACCESS,
  NOT_AN_ADMIN,
  authorizeAdminOf,
  type AccessAnswer,
  type AccessReader,
} from '../supabase/functions/admin-auth/authorize.ts';
import {
  AUTHORIZATION_MISSING,
  OPERATIONS,
  TRANSPORT_CODES,
  createHandler,
  readConfiguration,
} from '../supabase/functions/admin-auth/handler.ts';
import {
  ACCOUNT_NOT_CREATED,
  ACCOUNT_NOT_REMOVED,
  ADDRESS_DOMAIN,
  EMAIL_EXISTS,
  LEAVE_ALLOWANCE_MAX,
  MEMBERS_TABLE,
  MEMBER_CREATED,
  MEMBER_INVALID,
  MEMBER_ROLES,
  MEMBER_UNKNOWN,
  OPERATION_CODES,
  OPERATION_FAILED,
  ORGANIZATIONS_TABLE,
  ORGANIZATION_UNKNOWN,
  PASSWORD_NOT_APPLIED,
  PASSWORD_RESET,
  PAYLOAD_INVALID,
  USERNAME_CHANGED,
  USERNAME_INVALID,
  USERNAME_NOT_APPLIED,
  USERNAME_NOT_RESTORED,
  USERNAME_TAKEN,
  ORGANIZATION_UNREADABLE,
  createUser,
  membersRefusal,
  normalizedUsername,
  resetAttributes,
  resetPassword,
  synthesizedAddress,
  updateUserById,
  type AccountAnswer,
  type CallerClient,
  type PostgrestAnswer,
  type PrivilegedAccounts,
} from '../supabase/functions/admin-auth/operations.ts';
import {
  AMBIGUOUS,
  PASSWORD_ACCEPTABLE_BYTES,
  PASSWORD_ALPHABET,
  PASSWORD_BITS_OF_ENTROPY,
  PASSWORD_DISCARD_RATE,
  PASSWORD_LENGTH,
  generatePassword,
} from '../supabase/functions/admin-auth/password.ts';

/**
 * AD-16 / AD-17 — the privileged boundary refuses to act, and fails fast when
 * misconfigured. Both are asserted here in the node environment, with no
 * deployed function and no browser (AD-15).
 */

const VALID_ENV = {
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SHIFT_SECRET_KEY: 'sb_secret_test_value',
  SHIFT_PUBLISHABLE_KEY: 'sb_publishable_test_value',
  SHIFT_ALLOWED_ORIGINS: 'https://shift.example',
} as const;

const ALLOWED_ORIGIN = VALID_ENV.SHIFT_ALLOWED_ORIGINS;
const UNLISTED_ORIGIN = 'https://attacker.example';

function envFrom(overrides: Record<string, string | undefined> = {}) {
  const merged: Record<string, string | undefined> = { ...VALID_ENV, ...overrides };
  return (name: string): string | undefined => merged[name];
}

function deps() {
  return {
    makePrivilegedClient: vi.fn(() => ({ privileged: true })),
    makeCallerClient: vi.fn((_authorization: string) => ({ caller: true })),
  };
}

/**
 * The operation the transport cases below are made against.
 *
 * AN IMPLEMENTED OPERATION CARRYING NO PAYLOAD. These cases used to use `ban`,
 * which answered 501 before touching anything; story 1.6 removed `ban` and
 * `unban` from the vocabulary, so nothing unimplemented is left to aim at. A
 * `resetPassword` with no `memberId` is refused as `PAYLOAD_INVALID` by the
 * operation's own validation before either client is used, so a CORS or
 * misconfiguration case still asserts a header on a reply that acted on
 * nothing — and the fakes `deps()` hands out are inert objects, so a case that
 * did reach a client would throw into the 500 path rather than write.
 */
const TRANSPORT_PROBE = 'resetPassword';

function post(
  operation: unknown,
  headers: Record<string, string> = {},
  payload: Readonly<Record<string, unknown>> = {},
): Request {
  return new Request('http://localhost/admin-auth', {
    method: 'POST',
    headers: { Authorization: 'Bearer caller-jwt', 'content-type': 'application/json', ...headers },
    // A BODY, not just an operation, since story 1.5b: each operation validates
    // its own payload (`handler.ts` still validates only `operation`), so a
    // request carrying nothing else is refused as `PAYLOAD_INVALID` before it
    // reaches anything this file wants to assert.
    body: JSON.stringify({ operation, ...payload }),
  });
}

/** Every `Access-Control-Allow-*` header on a response, as a plain object. */
function allowHeaders(response: Response): Record<string, string> {
  return Object.fromEntries(
    [...response.headers].filter(([name]) => name.startsWith('access-control-allow-')),
  );
}

describe('admin-auth: exactly three operations, and none of them refuses to act', () => {
  it('answers a request aimed at a removed operation as unknown, never as 501', async () => {
    // STORY 1.6 REMOVED `ban` AND `unban`. Deactivation is a versioned row
    // written through PostgREST under row level security, and the access token
    // hook ends sign-in; the secret key had nothing left to add. A build that
    // still dispatched either name — or still answered `NOT_IMPLEMENTED` —
    // would be a privileged entry point nothing reviews.
    const dependencies = deps();
    const handle = createHandler(readConfiguration(envFrom()), dependencies);

    for (const removed of ['ban', 'unban']) {
      const response = await handle(post(removed));

      expect(response.status, `${removed} is still an operation`).toBe(400);
      expect(await response.json()).toMatchObject({ code: 'OPERATION_UNKNOWN' });
    }
    expect(dependencies.makePrivilegedClient).not.toHaveBeenCalled();
    expect([...TRANSPORT_CODES] as string[]).not.toContain('NOT_IMPLEMENTED');
  });

  it('dispatches every declared operation, so none can fall through', async () => {
    // With the 501 path gone, a name in `OPERATIONS` that no branch handled
    // would reach the handler's final `OPERATION_FAILED`. Each operation with no
    // payload is refused by its own validation instead, which is the proof it
    // was dispatched.
    for (const operation of OPERATIONS) {
      const handle = createHandler(readConfiguration(envFrom()), deps());
      const response = await handle(post(operation));

      expect(response.status, `${operation} was not dispatched`).toBe(400);
      expect(await response.json()).toEqual({ code: 'PAYLOAD_INVALID' });
    }
  });

  it('constructs both clients on a real request, proving the two-client wiring', async () => {
    const dependencies = deps();
    const handle = createHandler(readConfiguration(envFrom()), dependencies);

    await handle(post(TRANSPORT_PROBE));

    expect(dependencies.makePrivilegedClient).toHaveBeenCalledOnce();
    expect(dependencies.makeCallerClient).toHaveBeenCalledExactlyOnceWith('Bearer caller-jwt');
  });

  it('exposes exactly the three operations AD-16 permits, and nothing else', async () => {
    // THREE SINCE STORY 1.6, and every one of them is written out rather than
    // derived: this list is the whole of what the secret key may be pointed at,
    // so an operation appearing in it is the moment somebody decides a new
    // capability exists. `ban` and `unban` left it by human decision
    // 2026-09-23.
    expect([...OPERATIONS]).toEqual(['createUser', 'updateUserById', 'resetPassword']);

    const handle = createHandler(readConfiguration(envFrom()), deps());
    const response = await handle(post('deleteUser'));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'OPERATION_UNKNOWN' });
  });

  it('refuses a request carrying no Authorization header', async () => {
    const dependencies = deps();
    const handle = createHandler(readConfiguration(envFrom()), dependencies);

    const response = await handle(
      new Request('http://localhost/admin-auth', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ operation: TRANSPORT_PROBE }),
      }),
    );

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ code: 'AUTHORIZATION_MISSING' });
    expect(dependencies.makePrivilegedClient).not.toHaveBeenCalled();
  });
});

describe('admin-auth: transport refusals', () => {
  it('refuses a method other than POST, naming the method it refused', async () => {
    const dependencies = deps();
    const handle = createHandler(readConfiguration(envFrom()), dependencies);

    const response = await handle(
      new Request('http://localhost/admin-auth', {
        method: 'GET',
        headers: { Authorization: 'Bearer caller-jwt' },
      }),
    );

    expect(response.status).toBe(405);
    expect(await response.json()).toEqual({ code: 'METHOD_NOT_ALLOWED', method: 'GET' });
    expect(dependencies.makePrivilegedClient).not.toHaveBeenCalled();
  });

  it('refuses a body that is not JSON', async () => {
    const dependencies = deps();
    const handle = createHandler(readConfiguration(envFrom()), dependencies);

    const response = await handle(
      new Request('http://localhost/admin-auth', {
        method: 'POST',
        headers: { Authorization: 'Bearer caller-jwt', 'content-type': 'application/json' },
        body: '{ not json',
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ code: 'BODY_NOT_JSON' });
    expect(dependencies.makePrivilegedClient).not.toHaveBeenCalled();
  });

  // Valid JSON that is not an object reaches the operation lookup, where it must
  // be refused as an unknown operation rather than throwing on property access
  // — a throw would surface as a 500 with no code at all.
  it.each([
    ['a string', '"createUser"'],
    ['null', 'null'],
    ['an array', '["createUser"]'],
    ['a number', '7'],
  ])('refuses %s body as an unknown operation rather than throwing', async (_label, body) => {
    const handle = createHandler(readConfiguration(envFrom()), deps());

    const response = await handle(
      new Request('http://localhost/admin-auth', {
        method: 'POST',
        headers: { Authorization: 'Bearer caller-jwt', 'content-type': 'application/json' },
        body,
      }),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: 'OPERATION_UNKNOWN' });
  });
});

describe('admin-auth: CORS is an allowlist, not a wildcard', () => {
  it('parses the allowlist into trimmed entries', () => {
    const result = readConfiguration(
      envFrom({ SHIFT_ALLOWED_ORIGINS: ' https://a.example ,https://b.example , ' }),
    );

    expect(result).toMatchObject({
      ok: true,
      configuration: { allowedOrigins: ['https://a.example', 'https://b.example'] },
    });
  });

  it('echoes an allowed origin back, and varies on Origin', async () => {
    const handle = createHandler(readConfiguration(envFrom()), deps());

    const response = await handle(post(TRANSPORT_PROBE, { Origin: ALLOWED_ORIGIN }));

    expect(response.headers.get('access-control-allow-origin')).toBe(ALLOWED_ORIGIN);
    expect(response.headers.get('vary')).toBe('Origin');
  });

  // The inversion this guards against: an allowlist check written the wrong way
  // round keeps every other test in this file green while turning CORS into `*`.
  it('grants an unlisted origin no Access-Control-Allow header at all', async () => {
    const handle = createHandler(readConfiguration(envFrom()), deps());

    const response = await handle(post(TRANSPORT_PROBE, { Origin: UNLISTED_ORIGIN }));

    expect(allowHeaders(response)).toEqual({});
    // Still varies, so a cache cannot replay this reply to an allowed origin.
    expect(response.headers.get('vary')).toBe('Origin');
  });

  it('grants a request with no Origin no Access-Control-Allow header either', async () => {
    const handle = createHandler(readConfiguration(envFrom()), deps());

    const response = await handle(post(TRANSPORT_PROBE));

    expect(allowHeaders(response)).toEqual({});
    expect(response.headers.get('vary')).toBe('Origin');
  });
});

describe('admin-auth: the CORS preflight', () => {
  const preflight = (origin: string): Request =>
    new Request('http://localhost/admin-auth', {
      method: 'OPTIONS',
      headers: { Origin: origin, 'Access-Control-Request-Method': 'POST' },
    });

  it('answers an allowed origin with 204 and the negotiated method and headers', async () => {
    const handle = createHandler(readConfiguration(envFrom()), deps());

    const response = await handle(preflight(ALLOWED_ORIGIN));

    expect(response.status).toBe(204);
    expect(response.headers.get('access-control-allow-origin')).toBe(ALLOWED_ORIGIN);
    expect(response.headers.get('access-control-allow-methods')).toBe('POST, OPTIONS');
    expect(response.headers.get('access-control-allow-headers')).toBe('authorization, content-type');
  });

  it('answers an unlisted origin with 204 but grants it nothing', async () => {
    const handle = createHandler(readConfiguration(envFrom()), deps());

    const response = await handle(preflight(UNLISTED_ORIGIN));

    expect(response.status).toBe(204);
    expect(allowHeaders(response)).toEqual({});
  });

  // Deliberate precedence: the preflight is answered before the configuration
  // check, so a misconfigured function still lets the browser reach the POST
  // and read the real 500 code instead of reporting an opaque CORS failure.
  it('still answers 204 when the function is misconfigured, not the 500 code', async () => {
    const handle = createHandler(
      readConfiguration(envFrom({ SHIFT_SECRET_KEY: undefined })),
      deps(),
    );

    const response = await handle(preflight(ALLOWED_ORIGIN));

    expect(response.status).toBe(204);
    // No allowlist survives a failed configuration read, so nothing is granted.
    expect(allowHeaders(response)).toEqual({});
  });
});

describe('admin-auth: fails fast when misconfigured, and never falls back', () => {
  it.each([
    ['secret key absent', { SHIFT_SECRET_KEY: undefined }, 'SECRET_KEY_MISSING'],
    ['secret key blank', { SHIFT_SECRET_KEY: '   ' }, 'SECRET_KEY_MISSING'],
    ['secret slot holds a publishable key', { SHIFT_SECRET_KEY: 'sb_publishable_oops' }, 'SECRET_KEY_INVALID'],
    ['publishable key absent', { SHIFT_PUBLISHABLE_KEY: undefined }, 'PUBLISHABLE_KEY_MISSING'],
    ['publishable slot holds a secret key', { SHIFT_PUBLISHABLE_KEY: 'sb_secret_oops' }, 'PUBLISHABLE_KEY_INVALID'],
    ['project url absent', { SUPABASE_URL: undefined }, 'PROJECT_URL_MISSING'],
    ['project url is not a url', { SUPABASE_URL: 'not-a-url' }, 'PROJECT_URL_INVALID'],
    ['project url is not http(s)', { SUPABASE_URL: 'postgres://db.example:5432' }, 'PROJECT_URL_INVALID'],
  ])('reports %s as %s', (_label, overrides, code) => {
    const result = readConfiguration(envFrom(overrides));

    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ code });
  });

  // A dashboard paste or a heredoc leaves a trailing newline. Untrimmed it
  // passes `startsWith` and then fails opaquely at the real auth call.
  it('accepts values carrying surrounding whitespace, and stores them trimmed', () => {
    const result = readConfiguration(
      envFrom({
        SUPABASE_URL: ' http://127.0.0.1:54321\n',
        SHIFT_SECRET_KEY: 'sb_secret_test_value\n',
        SHIFT_PUBLISHABLE_KEY: '\tsb_publishable_test_value ',
      }),
    );

    expect(result).toMatchObject({
      ok: true,
      configuration: {
        projectUrl: 'http://127.0.0.1:54321',
        secretKey: 'sb_secret_test_value',
        publishableKey: 'sb_publishable_test_value',
      },
    });
  });

  it('answers 500 with the stable code and never reaches an operation', async () => {
    const dependencies = deps();
    const configuration = readConfiguration(envFrom({ SHIFT_SECRET_KEY: undefined }));
    const handle = createHandler(configuration, dependencies);

    const response = await handle(post(TRANSPORT_PROBE));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ code: 'SECRET_KEY_MISSING' });
    // The fallback AD-17 forbids: downgrading to the publishable key and
    // acting anyway would show up here as a constructed client.
    expect(dependencies.makePrivilegedClient).not.toHaveBeenCalled();
    expect(dependencies.makeCallerClient).not.toHaveBeenCalled();
  });

  it('reports CLIENT_CONSTRUCTION_FAILED rather than acting when a client cannot be built', async () => {
    const handle = createHandler(readConfiguration(envFrom()), {
      makePrivilegedClient: () => {
        throw new Error('SECRET_KEY_MISSING');
      },
      makeCallerClient: () => ({ caller: true }),
    });

    const response = await handle(post(TRANSPORT_PROBE));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ code: 'CLIENT_CONSTRUCTION_FAILED' });
  });

  it('leaks no key material in any response, configured or not', async () => {
    for (const configuration of [
      readConfiguration(envFrom()),
      readConfiguration(envFrom({ SHIFT_SECRET_KEY: undefined })),
    ]) {
      const handle = createHandler(configuration, deps());
      const response = await handle(post(TRANSPORT_PROBE, { Origin: ALLOWED_ORIGIN }));
      const serialized = `${await response.text()}${JSON.stringify([...response.headers])}`;

      expect(serialized).not.toContain('sb_secret_');
      expect(serialized).not.toContain(VALID_ENV.SHIFT_SECRET_KEY);
    }
  });
});

// ---------------------------------------------------------------------------
// Story 1.5b — the two implemented operations, their authorization, and the two
// vocabularies that have to agree across a wire.
// ---------------------------------------------------------------------------

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

function migration(name: string): string {
  return readFileSync(join(repoRoot, 'supabase', 'migrations', name), 'utf8');
}

/** The permission levels `members.role`'s check constraint actually admits. */
function levelsTheDatabaseAdmits(): string[] {
  const clause = /role text not null check \(role in \(([^)]*)\)\)/.exec(
    migration('0002_organizations_and_members.sql'),
  )?.[1];

  return [...(clause ?? '').matchAll(/'([^']+)'/g)].map((found) => found[1] ?? '');
}

describe('every constant that decides a security outcome is pinned to the database', () => {
  /**
   * THE FOUR PROBES ITERATION 0 SHIPPED GREEN all had one cause: an assertion
   * that compared a value to itself. A test that imports `ADMIN_ROLE`, builds
   * its stub's answer from it and compares the two passes for every value —
   * `'administrator'` included, which would have this boundary answer
   * `NOT_AN_ADMIN` to every legitimate administrator, so no account could ever
   * be issued, with 1412 tests green. So every constant below is compared
   * against what the DATABASE or the CLIENT actually carries, read out of the
   * migration or imported from the other tree.
   */

  it('finds the schema it is reading, so every pin below means something', () => {
    // Vacuous-pass guard. A renamed migration would make each extraction return
    // nothing and each pin compare an empty list to an empty list.
    expect(levelsTheDatabaseAdmits()).toEqual(['admin', 'member_role']);
  });

  it('names the level members.role actually carries, not one of its own', () => {
    // THE PROBE: change `ADMIN_ROLE` to any other value. The database admits
    // exactly two levels, and the administering one is the level every policy
    // in `0003` compares against — so this fails the moment the constant stops
    // being one of them.
    expect(levelsTheDatabaseAdmits()).toContain(ADMIN_ROLE);
  });

  it('names the level the POLICIES compare against, which is the stronger claim', () => {
    // Being one of two admitted levels is not enough: `member_role` is also
    // admitted, and using it here would authorize exactly the population AD-16
    // exists to refuse. `0003`'s three write policies each narrow to
    // `access.member_role = '<level>'`, and that literal is what this boundary
    // has to agree with.
    const policies = [
      ...migration('0003_access_control.sql').matchAll(/access\.member_role = '([^']+)'/g),
    ].map((found) => found[1] ?? '');

    expect(policies.length, 'no policy narrows by level at all').toBeGreaterThan(0);
    expect([...new Set(policies)], 'the policies disagree about the administering level').toEqual([
      ADMIN_ROLE,
    ]);
  });

  it('names the function 0003 actually creates, not one of its own', () => {
    // THE PROBE: change `CURRENT_MEMBER_ACCESS` to any other name. It is a
    // PostgREST RPC path, so a typo is a 404 at runtime and nothing in
    // TypeScript can see it — and a 404 here reads as `ACCESS_UNREADABLE`,
    // which is a 503 on every privileged call in the system.
    const access = migration('0003_access_control.sql');

    expect(access, `0003 creates no function called ${CURRENT_MEMBER_ACCESS}`).toContain(
      `create function public.${CURRENT_MEMBER_ACCESS}()`,
    );
    // And it is the one the policies read the caller's access through, so this
    // boundary and row level security are asking the same question.
    expect(access).toContain(`from public.${CURRENT_MEMBER_ACCESS}() as access`);
    // Executable by the request role, or every call answers "permission denied
    // for function" rather than an access row.
    expect(access).toContain(
      `grant execute on function public.${CURRENT_MEMBER_ACCESS}() to authenticated`,
    );
  });

  it('offers exactly the levels the check constraint admits, and no third', () => {
    // The create payload narrows `role` against this list. A level here that
    // the constraint does not admit is a 23514 an admin cannot act on; a level
    // the constraint admits and this list omits is a level no form can ever
    // set.
    expect([...MEMBER_ROLES]).toEqual(levelsTheDatabaseAdmits());
  });

  it('writes the relations the migrations actually create', () => {
    const tables = migration('0002_organizations_and_members.sql');

    expect(tables).toContain(`create table ${MEMBERS_TABLE} (`);
    expect(tables).toContain(`create table ${ORGANIZATIONS_TABLE} (`);
  });

  it('refuses exactly the usernames the database refuses, in all three places', () => {
    // THE SHAPE RULE EXISTS THREE TIMES and nothing bound it: `0007`'s CHECK,
    // `normalizedUsername` here, and `normalizeUsername` in
    // `apps/web/src/supabase/address.ts`. Loosen one and the function accepts a
    // username the database refuses with a constraint violation naming nothing
    // an admin can act on — or the sign-in path refuses a username an account
    // genuinely holds. Both suites stay green, because each copy is tested
    // against itself.
    //
    // The CHECK is read out of the migration and executed as a JavaScript
    // predicate over the same inputs: a POSIX bracket expression for "not
    // whitespace and not @" is `\S` here, and `= lower(username)` is the
    // lowercase half.
    const check = /check \(username ~ '([^']+)' and username = lower\(username\)\)/.exec(
      migration('0007_member_username.sql'),
    )?.[1];

    expect(check, '0007 no longer carries the username shape check').toBe('^[^[:space:]@]+$');

    const admittedByTheDatabase = (value: string): boolean =>
      /^\S+$/.test(value) && !value.includes('@') && value === value.toLowerCase();

    for (const typed of [
      'ana.kovac',
      'Ana.Kovac',
      '  ana.kovac  ',
      'ana kovac',
      'ana@kovac',
      '',
      '   ',
      'ANA',
      'ana-kovac_1',
    ]) {
      const here = normalizedUsername(typed);
      const atSignIn = normalizeUsername(typed);

      // THE TWO NORMALIZERS AGREE, value for value.
      expect(atSignIn, `the sign-in path disagrees about "${typed}"`).toBe(here);
      // AND WHAT EITHER PRODUCES IS SOMETHING THE DATABASE ADMITS. The
      // normalizers may accept MORE inputs than the check does — they trim and
      // lowercase — but what comes out of them has to satisfy it, or the write
      // is refused with a constraint name.
      if (here !== null) {
        expect(admittedByTheDatabase(here), `"${typed}" normalizes to "${here}", which 0007 refuses`).toBe(
          true,
        );
      }
    }

    // And the predicate is not vacuous: it refuses what the check refuses.
    expect(admittedByTheDatabase('Ana')).toBe(false);
    expect(admittedByTheDatabase('a b')).toBe(false);
    expect(admittedByTheDatabase('a@b')).toBe(false);
  });

  it('builds the same sign-in address the SPA does, character for character', () => {
    // AD-12's expression exists in TWO places and cannot exist in one: this
    // tree is bundled by Vite and that one runs on Deno with an `npm:`
    // specifier. An account issued here that the sign-in path cannot address
    // authenticates nothing, silently, for ever — so the two are bound rather
    // than trusted.
    for (const [username, slug] of [
      ['ana.kovac', 'dvd-kastel-novi'],
      ['josip.peric', 'zastita-split'],
    ] as const) {
      expect(synthesizedAddress(username, slug)).toBe(signInAddress(username, slug));
    }
    // RFC 2606: the domain can never resolve, which is the point — these are
    // identifiers, never mailboxes.
    expect(ADDRESS_DOMAIN).toBe('shift.invalid');
    expect(synthesizedAddress('ana.kovac', 'dvd-kastel-novi')).toBe(
      `ana.kovac@dvd-kastel-novi.${ADDRESS_DOMAIN}`,
    );
  });
});

describe('the function and the SPA speak one vocabulary, bound here', () => {
  /**
   * THE ONE FILE THAT CAN IMPORT BOTH TREES, and the only place this contract
   * can be made at all. `apps/web/src/members/wire.ts` is a leaf precisely so
   * this import resolves under pnpm's isolated linker.
   *
   * WRITTEN TWICE AND BOUND BY NOTHING, renaming the VALUE of `MEMBER_CREATED`
   * on the function side reports a successful create as a service failure and
   * discards the generated password — the one unrecoverable value in this
   * system — with both suites green, because each side compares replies to the
   * constant it imported.
   */

  it('agrees on every code that crosses the wire, in both directions', () => {
    // BOTH LISTS, and `TRANSPORT_CODES` is the half that was missing. The seven
    // codes `handler.ts` answers with before any operation runs lived as bare
    // literals, so they escaped this binding entirely and the SPA had a mapping
    // for none of them — every one falling through to "the service is
    // unavailable, try again", including `AUTHORIZATION_MISSING`, which is a
    // session that expired while a form was open and is fixed by signing in
    // again and by nothing else.
    expect([...OPERATION_CODES, ...TRANSPORT_CODES].sort()).toEqual([...WIRE_CODES].sort());
    // Neither list may be empty, or the comparison above holds vacuously.
    expect(TRANSPORT_CODES.length).toBeGreaterThan(0);
    expect(OPERATION_CODES.length).toBeGreaterThan(0);
  });

  it('sends the person to sign in again when the request carried no credential', () => {
    // THE ONE TRANSPORT CODE THAT IS NOT AN OUTAGE. A signed-in screen whose
    // request arrives without an Authorization header has lost its session, and
    // "try again" repeats a request that still carries no credential.
    expect(memberWriteFailureOf(AUTHORIZATION_MISSING)).not.toBe('MEMBER_WRITE_UNAVAILABLE');
  });

  it('answers every transport refusal with a code the SPA can actually read', () => {
    for (const code of TRANSPORT_CODES) {
      expect(WIRE_CODES, `${code} is not in the SPA's vocabulary`).toContain(code);
    }
  });

  it('refuses an allowance one past the ceiling and admits the ceiling itself', () => {
    // BOTH SIDES OF THE BOUND, because a check written `>=` refuses a perfectly
    // legal value and a check dropped altogether refuses nothing at all — and
    // the two are one character apart.
    const accounts = accountsThat();
    const caller = callerThat({ reads: SLUG_READ });

    return Promise.all([
      expect(
        createUser(
          { privileged: accounts.client, caller: caller.client },
          creation({ leaveAllowanceDays: LEAVE_ALLOWANCE_MAX + 1 }),
        ),
      ).resolves.toEqual({ status: 400, body: { code: PAYLOAD_INVALID } }),
      expect(
        createUser(
          { privileged: accountsThat().client, caller: callerThat({ reads: SLUG_READ }).client },
          creation({ leaveAllowanceDays: LEAVE_ALLOWANCE_MAX }),
        ).then((reply) => reply.status),
      ).resolves.toBe(201),
    ]);
  });

  it('bounds the leave allowance at the same number on both sides of the wire', () => {
    // `0002:145` types the column `smallint`. The controls carry this as a
    // `max` and the payload check refuses past it, so the value that would
    // raise `22003` — a refusal about a storage type, naming nothing an admin
    // can act on — is refused as an ordinary bad value instead. Two copies of a
    // bound is one bound that drifts.
    expect(LEAVE_ALLOWANCE_MAX).toBe(CLIENT_LEAVE_ALLOWANCE_MAX);
    // And it is what `smallint` actually holds, not a number somebody liked.
    expect(LEAVE_ALLOWANCE_MAX).toBe(2 ** 15 - 1);
  });

  it.each(['23502', '23514', '22003', '22001', '40001', '08006'])(
    'answers SQLSTATE %s with the same message on both write paths',
    (sqlstate) => {
      // THE TWO FALL-THROUGHS USED TO BE OPPOSITES: `editFailureOf` answered
      // "try again" for anything it had not been taught and `membersRefusal`
      // answered "correct a value", so one admin typing 40000 days got
      // contradictory advice depending only on whether the username happened to
      // change in the same edit — and one of the two invited retrying a write
      // refused every single time. Both map by SQLSTATE CLASS now, and this is
      // what holds them together.
      //
      // `22001` and `40001` are named EXPLICITLY BY NEITHER, which is the point:
      // a list-based mapping agrees on the codes somebody thought of and
      // diverges on the first one they did not.
      const throughTheFunction = membersRefusal({ code: sqlstate }).body.code;
      const throughPostgrest = editFailureOf({ code: sqlstate });

      expect(memberWriteMessageKey(memberWriteFailureOf(throughTheFunction))).toBe(
        memberWriteMessageKey(throughPostgrest),
      );
    },
  );

  it('keeps 23505 different on purpose, because only one path writes the column', () => {
    // THE ONE DELIBERATE DISAGREEMENT, named rather than left to be discovered.
    // `updateUserById` moves `members.username`, so a unique violation there IS
    // a taken username; `saveMember`'s PostgREST update never writes the column,
    // so the same sentence on that path could only misdirect.
    expect(membersRefusal({ code: '23505' }).body.code).toBe(USERNAME_TAKEN);
    expect(editFailureOf({ code: '23505' })).not.toBe(
      memberWriteFailureOf(USERNAME_TAKEN),
    );
  });

  it('refuses a policy violation identically on both paths', () => {
    expect(memberWriteFailureOf(String(membersRefusal({ code: '42501' }).body.code))).toBe(
      editFailureOf({ code: '42501' }),
    );
  });

  it('agrees on the three SUCCESS gates, which are the codes a refusal is not', () => {
    // These are the three the client tests against by VALUE: anything else is a
    // failure. A drift here is not a wrong message — it is a successful create
    // reported as a failure with the password already gone, and on the RESET it
    // is the same loss suffered by somebody who had already lost the first copy.
    expect(MEMBER_CREATED).toBe(CLIENT_MEMBER_CREATED);
    expect(USERNAME_CHANGED).toBe(CLIENT_USERNAME_CHANGED);
    expect(PASSWORD_RESET).toBe(CLIENT_PASSWORD_RESET);
  });

  it('spells the reset operation the way the transport dispatches on it', () => {
    // A DISPATCH KEY, not a label. Misspelt on the SPA side only, every reset a
    // browser sends arrives as `OPERATION_UNKNOWN`, falls through to
    // `MEMBER_WRITE_UNAVAILABLE`, and shows "try again" for ever to an admin
    // whose member has no other recovery route — with both suites green,
    // because each side compares replies to the constant it imported.
    expect(OPERATIONS).toContain(RESET_PASSWORD_OPERATION);
  });

  it('gives the client a mapping for every code the function can emit', () => {
    // Not merely "the lists match": the client's mapping is what turns a code
    // into something a person can act on, and a code it has not been taught
    // renders as "try again" for something that will never succeed.
    for (const code of OPERATION_CODES) {
      expect(typeof memberWriteFailureOf(code), `${code} has no mapping`).toBe('string');
    }
  });

  it.each([
    [USERNAME_TAKEN, 'MEMBER_USERNAME_TAKEN'],
    [USERNAME_INVALID, 'MEMBER_USERNAME_INVALID'],
    [NOT_AN_ADMIN, 'MEMBER_WRITE_REFUSED'],
    [MEMBER_UNKNOWN, 'MEMBER_UNKNOWN'],
    [MEMBER_INVALID, 'MEMBER_WRITE_INVALID'],
    [USERNAME_NOT_APPLIED, 'MEMBER_USERNAME_NOT_APPLIED'],
    [USERNAME_NOT_RESTORED, 'MEMBER_USERNAME_UNSETTLED'],
    [ACCOUNT_NOT_REMOVED, 'MEMBER_ACCOUNT_STRANDED'],
    [PASSWORD_NOT_APPLIED, 'MEMBER_PASSWORD_NOT_APPLIED'],
  ])('does not let %s collapse into the service-failure fallback', (code, failure) => {
    // The seven refusals an admin can act on. Folded into the fallback, each
    // becomes "try again" over something that will never succeed — a username
    // that is taken, a member that does not exist, an account left stranded.
    expect(memberWriteFailureOf(code)).toBe(failure);
    expect(memberWriteFailureOf(code)).not.toBe('MEMBER_WRITE_UNAVAILABLE');
  });

  it('calls the function the repository actually deploys, by the name it has', () => {
    // `functions.invoke('admin-auth')` is a URL path. A typo is a 404, which the
    // client reports as a service failure — indistinguishable from an outage,
    // for ever.
    expect(readFileSync(join(repoRoot, 'supabase', 'config.toml'), 'utf8')).toContain(
      `functions.${MEMBER_WRITE_FUNCTION}`,
    );
  });
});

describe('the password an admin hands over is generated, not typed', () => {
  it('excludes BOTH HALVES of every pair a person confuses', () => {
    // THE HALF THAT IS EASY TO GET WRONG. Dropping `0`, `O`, `1`, `l` and `I`
    // while keeping lowercase `o` and `i` leaves exactly the confusion the
    // exclusion exists to prevent — `o` against `O`, `i` against `1` — on a
    // credential read aloud to somebody who has no mailbox to send it to.
    for (const character of AMBIGUOUS) {
      expect(PASSWORD_ALPHABET, `${character} is still in the alphabet`).not.toContain(character);
    }
    expect([...AMBIGUOUS].sort().join('')).toBe('01IOilo');
  });

  it('pins the alphabet to its ACTUAL size, which every figure below divides by', () => {
    // 26 + 26 + 10 = 62, minus the seven excluded above. Written out rather than
    // computed from the same expression the module uses, because a test that
    // recomputes the implementation asserts nothing about it.
    expect(PASSWORD_ALPHABET.length).toBe(55);
    // No duplicates, which a hand-typed alphabet acquires and a derived one
    // cannot — and a duplicate is a character twice as likely as its neighbours.
    expect(new Set(PASSWORD_ALPHABET).size).toBe(PASSWORD_ALPHABET.length);
  });

  it('computes its entropy and its discard rate from that size rather than beside it', () => {
    // EVERY FIGURE COMPUTED FROM THE LITERAL. 55 × 4 = 220 is the largest
    // multiple of the alphabet that fits in a byte, so 36 of 256 draws are
    // discarded and the remaining mapping is uniform.
    expect(PASSWORD_ACCEPTABLE_BYTES).toBe(220);
    expect(PASSWORD_DISCARD_RATE).toBeCloseTo(36 / 256, 10);
    // log2(55) ≈ 5.7814 bits per character over sixteen characters.
    expect(PASSWORD_BITS_OF_ENTROPY).toBeCloseTo(PASSWORD_LENGTH * Math.log2(55), 10);
    expect(PASSWORD_BITS_OF_ENTROPY).toBeGreaterThan(80);
  });

  it('draws only from the alphabet, at the declared length', () => {
    const generated = generatePassword();

    expect(generated).toHaveLength(PASSWORD_LENGTH);
    for (const character of generated) expect(PASSWORD_ALPHABET).toContain(character);
  });

  it('consumes the byte source it was given, rather than a random of its own', () => {
    // THE PROBE: replace the generator with `Math.random`. Fed a deterministic
    // source, the output is determined — so a generator that ignored its
    // argument answers something else. This is the only thing that can tell a
    // CSPRNG from `Math.random` without statistics.
    const drawn: number[] = [];
    let next = 0;
    const source = (count: number): Uint8Array => {
      const bytes = new Uint8Array(count);
      for (let index = 0; index < count; index += 1) {
        bytes[index] = next % PASSWORD_ACCEPTABLE_BYTES;
        drawn.push(next % PASSWORD_ACCEPTABLE_BYTES);
        next += 1;
      }

      return bytes;
    };

    expect(generatePassword(source)).toBe(
      Array.from({ length: PASSWORD_LENGTH }, (_unused, index) =>
        PASSWORD_ALPHABET[index % PASSWORD_ALPHABET.length],
      ).join(''),
    );
    expect(drawn, 'the generator never asked the source for a byte').toHaveLength(PASSWORD_LENGTH);
  });

  it('DISCARDS a byte in the biased band rather than folding it in', () => {
    // `byte % length` without the discard is biased toward the first
    // `256 mod 55` characters — small, invisible, and exactly why it has to be
    // refused by construction. A source whose first byte is IN the band must
    // produce the same password as one that never yields that byte at all.
    //
    // The probe byte is `PASSWORD_ACCEPTABLE_BYTES + 1` rather than the first
    // byte of the band: 220 % 55 is 0, which is the same character the
    // replacement byte produces, so a generator that folded it in would answer
    // identically and this case would pass having proved nothing. 221 % 55 is
    // 1, which is a different character entirely.
    let index = 0;
    const withDiscard = (count: number): Uint8Array => {
      const bytes = new Uint8Array(count);
      for (let at = 0; at < count; at += 1) {
        bytes[at] = index === 0 ? PASSWORD_ACCEPTABLE_BYTES + 1 : 0;
        index += 1;
      }

      return bytes;
    };

    expect((PASSWORD_ACCEPTABLE_BYTES + 1) % PASSWORD_ALPHABET.length).not.toBe(0);
    expect(generatePassword(withDiscard)).toBe(PASSWORD_ALPHABET[0]?.repeat(PASSWORD_LENGTH));
  });
});

// ---------------------------------------------------------------------------
// The stubs the two operations are driven against. Structural and narrow, the
// shape `members/list.ts`'s `MembersTable` established: a stub does not have to
// impersonate the rest of PostgREST, only the four links these modules use.
// ---------------------------------------------------------------------------

const ORGANIZATION = 'organization-1';
const OTHER_ORGANIZATION = 'organization-2';
const SLUG = 'dvd-kastel-novi';
const ACCOUNT = 'auth-user-1';
const MEMBER = 'member-1';

/** One row of `current_member_access()`, spelled the way the function spells it. */
function accessRow(fields: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    organization_id: ORGANIZATION,
    member_role: ADMIN_ROLE,
    is_active: true,
    ...fields,
  };
}

interface CallerLog {
  readonly rpc: string[];
  readonly reads: { table: string; columns: string; value: string }[];
  readonly inserts: { table: string; values: Readonly<Record<string, unknown>> }[];
  readonly updates: { table: string; values: Readonly<Record<string, unknown>>; id: string }[];
}

interface CallerPlan {
  readonly access?: AccessAnswer | Error;
  /** Answers for `select(...).eq(...).limit(...)`, keyed by table, in order. */
  readonly reads?: Readonly<Record<string, readonly PostgrestAnswer[]>>;
  readonly insert?: PostgrestAnswer | Error;
  readonly updates?: readonly (PostgrestAnswer | Error)[];
}

function callerThat(plan: CallerPlan = {}): { client: CallerClient; log: CallerLog } {
  const log: CallerLog = { rpc: [], reads: [], inserts: [], updates: [] };
  const readIndex: Record<string, number> = {};
  let updateIndex = 0;

  const settle = (answer: PostgrestAnswer | Error | undefined): Promise<PostgrestAnswer> => {
    if (answer instanceof Error) throw answer;

    return Promise.resolve(answer ?? { data: [], error: null });
  };

  return {
    log,
    client: {
      rpc(name) {
        log.rpc.push(name);
        const answer = plan.access ?? { data: [accessRow()], error: null };

        if (answer instanceof Error) throw answer;

        return Promise.resolve(answer);
      },
      from(table) {
        return {
          select(columns) {
            return {
              eq(_column, value) {
                return {
                  limit(_count) {
                    log.reads.push({ table, columns, value });
                    const queued = plan.reads?.[table] ?? [];
                    const at = readIndex[table] ?? 0;
                    readIndex[table] = at + 1;

                    return settle(queued[at] ?? queued[queued.length - 1]);
                  },
                };
              },
            };
          },
          insert(values) {
            return {
              select(_columns) {
                log.inserts.push({ table, values });

                return settle(plan.insert ?? { data: [{ id: MEMBER }], error: null });
              },
            };
          },
          update(values) {
            return {
              eq(_column, id) {
                return {
                  select(_columns) {
                    log.updates.push({ table, values, id });
                    const queued = plan.updates ?? [];
                    const at = updateIndex;
                    updateIndex += 1;

                    return settle(queued[at] ?? queued[queued.length - 1]);
                  },
                };
              },
            };
          },
        };
      },
    },
  };
}

interface AccountLog {
  readonly created: Readonly<Record<string, unknown>>[];
  readonly updated: { id: string; attributes: Readonly<Record<string, unknown>> }[];
  readonly deleted: string[];
}

interface AccountPlan {
  readonly created?: AccountAnswer | Error;
  readonly updated?: AccountAnswer | Error;
  readonly deleted?: { error: { code?: string } | null } | Error;
}

function accountsThat(plan: AccountPlan = {}): { client: PrivilegedAccounts; log: AccountLog } {
  const log: AccountLog = { created: [], updated: [], deleted: [] };

  return {
    log,
    client: {
      auth: {
        admin: {
          createUser(attributes) {
            log.created.push(attributes);
            const answer = plan.created ?? { data: { user: { id: ACCOUNT } }, error: null };

            if (answer instanceof Error) throw answer;

            return Promise.resolve(answer);
          },
          updateUserById(id, attributes) {
            log.updated.push({ id, attributes });
            const answer = plan.updated ?? { data: { user: { id } }, error: null };

            if (answer instanceof Error) throw answer;

            return Promise.resolve(answer);
          },
          deleteUser(id) {
            log.deleted.push(id);
            const answer = plan.deleted ?? { error: null };

            if (answer instanceof Error) throw answer;

            return Promise.resolve(answer);
          },
        },
      },
    },
  };
}

/** A complete, valid create payload. */
function creation(fields: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    organizationId: ORGANIZATION,
    name: 'Marko Novak',
    username: 'marko.novak',
    email: null,
    role: 'member_role',
    leaveAllowanceDays: 20,
    ...fields,
  };
}

/** The `organizations` read every operation makes, answering with the slug. */
const SLUG_READ: Readonly<Record<string, readonly PostgrestAnswer[]>> = {
  organizations: [{ data: [{ slug: SLUG }], error: null }],
};

/** The `members` read `updateUserById` makes before it authorizes anything. */
const MEMBER_READ: Readonly<Record<string, readonly PostgrestAnswer[]>> = {
  members: [
    {
      data: [{ organization_id: ORGANIZATION, auth_user_id: ACCOUNT, username: 'ana.kovac' }],
      error: null,
    },
  ],
  organizations: [{ data: [{ slug: SLUG }], error: null }],
};

describe('AD-16: the caller is authorized against the database, never the request', () => {
  const read = (answer: AccessAnswer | Error): AccessReader => callerThat({ access: answer }).client;

  it('admits an active admin of the target organization', () => {
    // The branch that makes every refusal below worth having: a check that
    // refused unconditionally would satisfy all of them and no account could
    // ever be issued.
    return expect(
      authorizeAdminOf(read({ data: [accessRow()], error: null }), ORGANIZATION),
    ).resolves.toEqual({
      ok: true,
      access: { organizationId: ORGANIZATION, role: ADMIN_ROLE, isActive: true },
    });
  });

  it.each([
    ['a member-role caller', accessRow({ member_role: 'member_role' }), ORGANIZATION],
    ['a deactivated admin', accessRow({ is_active: false }), ORGANIZATION],
    ['an admin of another organization', accessRow(), OTHER_ORGANIZATION],
  ])('refuses %s as NOT_AN_ADMIN and nothing more specific', async (_label, row, target) => {
    // ONE CODE FOR ALL THREE. A caller who can tell them apart learns whether a
    // given organization exists and whether their own account was deactivated
    // or merely demoted — an oracle on the one boundary holding the secret key.
    await expect(authorizeAdminOf(read({ data: [row], error: null }), target)).resolves.toEqual({
      ok: false,
      code: NOT_AN_ADMIN,
    });
  });

  it('refuses a token whose account has no member row', async () => {
    // `custom_access_token_hook` (`0003:181-206`) REMOVES the claim rather than
    // defaulting it, so this is the fail-closed state a deleted member reaches.
    await expect(authorizeAdminOf(read({ data: [], error: null }), ORGANIZATION)).resolves.toEqual({
      ok: false,
      code: NOT_AN_ADMIN,
    });
  });

  it.each([
    ['a transport error', { data: null, error: { message: 'boom' } } as AccessAnswer],
    ['an answer that is not an answer', 'not an object' as unknown as AccessAnswer],
  ])('reports %s as unreadable rather than as a refusal', async (_label, answer) => {
    // AN OUTAGE IS NOT A DECISION ABOUT THE CALLER. Reported as `NOT_AN_ADMIN`
    // it sends an entitled administrator to ask for rights they already hold.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      await expect(authorizeAdminOf(read(answer), ORGANIZATION)).resolves.toEqual({
        ok: false,
        code: ACCESS_UNREADABLE,
      });
    } finally {
      logged.mockRestore();
    }
  });

  it('reports a reader that throws rather than letting it escape', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      await expect(
        authorizeAdminOf(read(new Error('fetch failed')), ORGANIZATION),
      ).resolves.toEqual({ ok: false, code: ACCESS_UNREADABLE });
    } finally {
      logged.mockRestore();
    }
  });

  it('refuses a row that does not carry all three facts', async () => {
    // VALIDATED, NEVER CAST. A missing `is_active` casts to `undefined`, which
    // is falsy — so a cast would refuse every admin rather than report the
    // answer as unusable.
    await expect(
      authorizeAdminOf(read({ data: [{ organization_id: ORGANIZATION }], error: null }), ORGANIZATION),
    ).resolves.toEqual({ ok: false, code: NOT_AN_ADMIN });
  });

  it('asks the database by the name the database actually uses', async () => {
    const { client, log } = callerThat();

    await authorizeAdminOf(client, ORGANIZATION);

    expect(log.rpc).toEqual([CURRENT_MEMBER_ACCESS]);
  });
});

describe('createUser: an account and the row that gives it an organization', () => {
  it('writes both stores, in the order the foreign key forces, and returns the credential once', async () => {
    const accounts = accountsThat();
    const caller = callerThat({ reads: SLUG_READ });

    const reply = await createUser(
      { privileged: accounts.client, caller: caller.client },
      creation(),
    );

    expect(reply.status).toBe(201);
    expect(reply.body).toMatchObject({ code: MEMBER_CREATED, username: 'marko.novak' });
    expect(typeof reply.body['password']).toBe('string');
    expect(String(reply.body['password'])).toHaveLength(PASSWORD_LENGTH);

    // THE ACCOUNT FIRST, because `members.auth_user_id` is
    // `not null references auth.users(id)` (`0002:128`) — that ordering is
    // forced by the schema rather than chosen.
    expect(accounts.log.created).toHaveLength(1);
    expect(accounts.log.created[0]).toMatchObject({
      email: synthesizedAddress('marko.novak', SLUG),
      email_confirm: true,
    });
    // THE ROW THROUGH THE CALLER'S CLIENT. The secret key would bypass
    // `members_insert_by_own_active_admin` and AD-11's attribution default in
    // one stroke — the defect AD-16 exists to prevent.
    expect(caller.log.inserts).toEqual([
      {
        table: MEMBERS_TABLE,
        values: {
          organization_id: ORGANIZATION,
          auth_user_id: ACCOUNT,
          name: 'Marko Novak',
          username: 'marko.novak',
          email: null,
          role: 'member_role',
          leave_allowance_days: 20,
        },
      },
    ]);
    expect(accounts.log.deleted, 'a successful create removed the account').toEqual([]);
  });

  it('reads the slug from organizations AS THE CALLER, never from the payload', async () => {
    // The address namespace is the DATABASE's choice. A slug in the request body
    // is a caller choosing which organization's namespace to issue an account
    // into, and the authorization — which checks the ID — could not contradict
    // it.
    const accounts = accountsThat();
    const caller = callerThat({ reads: SLUG_READ });

    await createUser(
      { privileged: accounts.client, caller: caller.client },
      creation({ slug: 'somewhere-else' }),
    );

    expect(caller.log.reads.map((read) => read.table)).toContain(ORGANIZATIONS_TABLE);
    expect(accounts.log.created[0]).toMatchObject({
      email: synthesizedAddress('marko.novak', SLUG),
    });
  });

  it('authorizes before it writes anything at all', async () => {
    const accounts = accountsThat();
    const caller = callerThat({
      access: { data: [accessRow({ member_role: 'member_role' })], error: null },
      reads: SLUG_READ,
    });

    const reply = await createUser(
      { privileged: accounts.client, caller: caller.client },
      creation(),
    );

    expect(reply).toEqual({ status: 403, body: { code: NOT_AN_ADMIN } });
    expect(accounts.log.created, 'an account was made for a refused caller').toEqual([]);
    expect(caller.log.inserts).toEqual([]);
  });

  it('refuses an admin naming another organization, and writes nothing', async () => {
    const accounts = accountsThat();
    const caller = callerThat({ reads: SLUG_READ });

    const reply = await createUser(
      { privileged: accounts.client, caller: caller.client },
      creation({ organizationId: OTHER_ORGANIZATION }),
    );

    expect(reply).toEqual({ status: 403, body: { code: NOT_AN_ADMIN } });
    expect(accounts.log.created).toEqual([]);
    expect(caller.log.inserts).toEqual([]);
  });

  it('recognises a duplicate address by GoTrue CODE, never by its status alone', async () => {
    // EVERY validation refusal GoTrue makes carries 422 — a weak password, a
    // malformed address, a disabled signup. Mapping the status would tell an
    // admin to change the one field that was correct.
    const accounts = accountsThat({
      created: { data: null, error: { code: EMAIL_EXISTS, status: 422 } },
    });
    const caller = callerThat({ reads: SLUG_READ });

    await expect(
      createUser({ privileged: accounts.client, caller: caller.client }, creation()),
    ).resolves.toEqual({ status: 409, body: { code: USERNAME_TAKEN } });
  });

  it('does not report every 422 as a taken username', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const accounts = accountsThat({
      created: { data: null, error: { code: 'weak_password', status: 422 } },
    });
    const caller = callerThat({ reads: SLUG_READ });

    try {
      await expect(
        createUser({ privileged: accounts.client, caller: caller.client }, creation()),
      ).resolves.toEqual({ status: 502, body: { code: ACCOUNT_NOT_CREATED } });
    } finally {
      logged.mockRestore();
    }
  });

  it('DELETES the account when the members row is refused', async () => {
    // THE COMPENSATION, and the failure it prevents is silent: an account that
    // can sign in, carries no `organization_id` claim, matches no policy
    // anywhere, and therefore sees an empty application with nothing on any
    // screen to say why.
    const accounts = accountsThat();
    const caller = callerThat({
      reads: SLUG_READ,
      insert: { data: null, error: { code: '42501', message: 'row-level security' } },
    });

    const reply = await createUser(
      { privileged: accounts.client, caller: caller.client },
      creation(),
    );

    expect(reply).toEqual({ status: 403, body: { code: NOT_AN_ADMIN } });
    expect(accounts.log.deleted, 'the orphaned account was left able to sign in').toEqual([ACCOUNT]);
  });

  it('maps a duplicate username on the row to the same code the address does', async () => {
    const accounts = accountsThat();
    const caller = callerThat({
      reads: SLUG_READ,
      insert: { data: null, error: { code: '23505' } },
    });

    await expect(
      createUser({ privileged: accounts.client, caller: caller.client }, creation()),
    ).resolves.toEqual({ status: 409, body: { code: USERNAME_TAKEN } });
    expect(accounts.log.deleted).toEqual([ACCOUNT]);
  });

  it('reports a compensation that itself failed with a code of its own, and no id', async () => {
    // Making the disagreement visible rather than tidy: the account exists, the
    // row does not, and nobody can put that right from a screen.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const accounts = accountsThat({ deleted: { error: { code: 'not_found' } } });
    const caller = callerThat({
      reads: SLUG_READ,
      insert: { data: null, error: { code: '23514' } },
    });

    try {
      const reply = await createUser(
        { privileged: accounts.client, caller: caller.client },
        creation(),
      );

      expect(reply.status).toBe(500);
      // THE CODE AND NOTHING ELSE. The browser maps the code and discards every
      // operand, so an `auth.users` primary key in the body buys nothing and
      // ships an internal identifier to a caller that cannot use it. The
      // operator needs it, and the log line is where they read it.
      expect(reply.body).toEqual({ code: ACCOUNT_NOT_REMOVED });
      expect(JSON.stringify(reply.body), 'the reply carries an internal id').not.toContain(ACCOUNT);
      expect(logged).toHaveBeenCalledWith(ACCOUNT_NOT_REMOVED, ACCOUNT);
    } finally {
      logged.mockRestore();
    }
  });

  it('refuses an organization the caller cannot read a slug for', async () => {
    const accounts = accountsThat();
    const caller = callerThat({ reads: { organizations: [{ data: [], error: null }] } });

    await expect(
      createUser({ privileged: accounts.client, caller: caller.client }, creation()),
    ).resolves.toEqual({ status: 404, body: { code: ORGANIZATION_UNKNOWN } });
    expect(accounts.log.created).toEqual([]);
  });

  it('tells an organization read that FAILED apart from one that found nothing', async () => {
    // UNREADABLE IS NOT UNKNOWN, the distinction `authorizeAdminOf` already
    // makes between `ACCESS_UNREADABLE` and `NOT_AN_ADMIN`. Collapsed, a
    // transient read failure answered `404 ORGANIZATION_UNKNOWN` — a 404 about
    // a tenant the caller was authorized against one statement earlier — and
    // logged nothing, so an operator had a 404 and no trace at all.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const accounts = accountsThat();
    const caller = callerThat({
      reads: { organizations: [{ data: null, error: { code: '08006' } }] },
    });

    try {
      await expect(
        createUser({ privileged: accounts.client, caller: caller.client }, creation()),
      ).resolves.toEqual({ status: 503, body: { code: ORGANIZATION_UNREADABLE } });
      expect(logged, 'the read failure left no trace').toHaveBeenCalled();
      expect(accounts.log.created).toEqual([]);
    } finally {
      logged.mockRestore();
    }
  });

  it('compensates when the insert raised nothing and still produced no row', async () => {
    // THE BRANCH NO OTHER CASE REACHES. Every insert-failure case above supplies
    // an `error`; this is the other half of the same guard — PostgREST answering
    // 2xx with an empty body, which a proxy or a `Prefer: return=minimal` that
    // arrived from somewhere else produces. Without the compensation that path
    // leaves an account that can sign in and reach nothing, exactly as a refused
    // insert would, and it is the shape a reviewer cannot see is unhandled.
    const accounts = accountsThat();
    const caller = callerThat({ reads: SLUG_READ, insert: { data: [], error: null } });

    const reply = await createUser(
      { privileged: accounts.client, caller: caller.client },
      creation(),
    );

    expect(reply).toEqual({ status: 409, body: { code: MEMBER_INVALID } });
    expect(accounts.log.deleted, 'no row came back and the account was left behind').toEqual([
      ACCOUNT,
    ]);
  });

  it.each([
    ['no organization', creation({ organizationId: '' })],
    ['a blank name', creation({ name: '   ' })],
    ['a level the check constraint refuses', creation({ role: 'supervisor' })],
    ['an allowance that is not a whole number', creation({ leaveAllowanceDays: 1.5 })],
    ['a negative allowance', creation({ leaveAllowanceDays: -1 })],
    // ABOVE WHAT `smallint` HOLDS. Sent through, the database answers `22003
    // numeric_value_out_of_range` — a refusal about a storage type that names
    // nothing an admin can act on — so the payload check is what turns it into
    // the same "correct a value" every other bad entry is.
    ['an allowance the column cannot hold', creation({ leaveAllowanceDays: 32768 })],
    ['an address that is not text', creation({ email: 7 })],
    ['a body that is not an object', 'createUser'],
  ])('refuses a payload with %s before touching anything', async (_label, payload) => {
    const accounts = accountsThat();
    const caller = callerThat({ reads: SLUG_READ });

    await expect(
      createUser({ privileged: accounts.client, caller: caller.client }, payload),
    ).resolves.toEqual({ status: 400, body: { code: PAYLOAD_INVALID } });
    expect(caller.log.rpc, 'a malformed payload still reached the database').toEqual([]);
  });

  it.each([
    ['nothing at all', ''],
    ['whitespace', 'ana kovac'],
    ['a second @', 'ana@kovac'],
  ])('refuses a username carrying %s, with its own code', async (_label, username) => {
    // ITS OWN CODE rather than `PAYLOAD_INVALID`: the username is the one field
    // on that form an admin is least sure about, and it is the only one they
    // can act on without being told which.
    const accounts = accountsThat();
    const caller = callerThat({ reads: SLUG_READ });

    await expect(
      createUser({ privileged: accounts.client, caller: caller.client }, creation({ username })),
    ).resolves.toEqual({ status: 400, body: { code: USERNAME_INVALID } });
  });

  it('normalizes a username the way the address builder and 0007 both do', async () => {
    // `0007`'s check refuses an uppercase username outright, so normalizing
    // here is what stops a perfectly reasonable entry becoming a constraint
    // violation nobody can act on — and the address builder lowercases too, so
    // anything else authenticates nothing.
    const accounts = accountsThat();
    const caller = callerThat({ reads: SLUG_READ });

    const reply = await createUser(
      { privileged: accounts.client, caller: caller.client },
      creation({ username: '  Marko.Novak  ' }),
    );

    expect(reply.body['username']).toBe('marko.novak');
    expect(caller.log.inserts[0]?.values['username']).toBe('marko.novak');
  });

  it('stores an absent or blank address as null, because the column is nullable', async () => {
    const accounts = accountsThat();
    const caller = callerThat({ reads: SLUG_READ });

    await createUser(
      { privileged: accounts.client, caller: accountsThat() && caller.client },
      creation({ email: '   ' }),
    );

    expect(caller.log.inserts[0]?.values['email']).toBeNull();
  });
});

describe('updateUserById: the row moves first, then the address', () => {
  const rename = { memberId: MEMBER, username: 'ana.kovacic' };

  it('moves both stores and reports the change', async () => {
    const accounts = accountsThat();
    const caller = callerThat({
      reads: MEMBER_READ,
      updates: [{ data: [{ id: MEMBER, username: 'ana.kovacic' }], error: null }],
    });

    const reply = await updateUserById(
      { privileged: accounts.client, caller: caller.client },
      rename,
    );

    expect(reply.status).toBe(200);
    expect(reply.body).toMatchObject({ code: USERNAME_CHANGED, username: 'ana.kovacic' });
    // THE ROW FIRST, because `unique (organization_id, lower(username))` (`0007`)
    // is the real gate: a collision is refused before any auth state moves.
    expect(caller.log.updates).toEqual([
      { table: MEMBERS_TABLE, values: { username: 'ana.kovacic' }, id: MEMBER },
    ]);
    expect(accounts.log.updated).toEqual([
      {
        id: ACCOUNT,
        attributes: { email: synthesizedAddress('ana.kovacic', SLUG), email_confirm: true },
      },
    ]);
  });

  it('RESTORES the row when the address will not follow, and names the failure', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const accounts = accountsThat({ updated: { data: null, error: { code: 'unexpected_failure' } } });
    const caller = callerThat({
      reads: MEMBER_READ,
      updates: [
        { data: [{ id: MEMBER }], error: null },
        { data: [{ id: MEMBER }], error: null },
      ],
    });

    try {
      const reply = await updateUserById(
        { privileged: accounts.client, caller: caller.client },
        rename,
      );

      expect(reply).toEqual({ status: 502, body: { code: USERNAME_NOT_APPLIED } });
      // The SECOND update is the compensation, and it puts back the value the
      // row carried before — read off the row rather than guessed.
      expect(caller.log.updates).toHaveLength(2);
      expect(caller.log.updates[1]?.values).toEqual({ username: 'ana.kovac' });
    } finally {
      logged.mockRestore();
    }
  });

  it('reports a compensation that itself failed with a code of its own', async () => {
    // The two stores now disagree, and only an operator can settle it. A flat
    // "try again" would hide a member whose row says one username and whose
    // account authenticates another.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const accounts = accountsThat({ updated: { data: null, error: { code: 'unexpected_failure' } } });
    const caller = callerThat({
      reads: MEMBER_READ,
      updates: [
        { data: [{ id: MEMBER }], error: null },
        { data: null, error: { code: '42501' } },
      ],
    });

    try {
      const reply = await updateUserById(
        { privileged: accounts.client, caller: caller.client },
        rename,
      );

      expect(reply.status).toBe(500);
      // The code and nothing else — see the note on `ACCOUNT_NOT_REMOVED`.
      expect(reply.body).toEqual({ code: USERNAME_NOT_RESTORED });
      expect(JSON.stringify(reply.body), 'the reply carries an internal id').not.toContain(MEMBER);
      expect(logged).toHaveBeenCalledWith(USERNAME_NOT_RESTORED, MEMBER);
    } finally {
      logged.mockRestore();
    }
  });

  it('maps a duplicate address after the row moved to the taken-username code', async () => {
    const accounts = accountsThat({
      updated: { data: null, error: { code: EMAIL_EXISTS, status: 422 } },
    });
    const caller = callerThat({
      reads: MEMBER_READ,
      updates: [
        { data: [{ id: MEMBER }], error: null },
        { data: [{ id: MEMBER }], error: null },
      ],
    });

    await expect(
      updateUserById({ privileged: accounts.client, caller: caller.client }, rename),
    ).resolves.toEqual({ status: 409, body: { code: USERNAME_TAKEN } });
  });

  it('refuses a duplicate username at the row, before any auth state moves', async () => {
    const accounts = accountsThat();
    const caller = callerThat({
      reads: MEMBER_READ,
      updates: [{ data: null, error: { code: '23505' } }],
    });

    await expect(
      updateUserById({ privileged: accounts.client, caller: caller.client }, rename),
    ).resolves.toEqual({ status: 409, body: { code: USERNAME_TAKEN } });
    expect(accounts.log.updated, 'the address moved for a refused rename').toEqual([]);
  });

  it('reads zero updated rows as the policy refusing silently', async () => {
    const accounts = accountsThat();
    const caller = callerThat({ reads: MEMBER_READ, updates: [{ data: [], error: null }] });

    await expect(
      updateUserById({ privileged: accounts.client, caller: caller.client }, rename),
    ).resolves.toEqual({ status: 403, body: { code: NOT_AN_ADMIN } });
    expect(accounts.log.updated).toEqual([]);
  });

  it('gives a member id that reaches nobody its OWN code', async () => {
    // A cross-tenant id and an id that never existed are indistinguishable —
    // `members_select_own_organization` means the row simply is not there — and
    // neither is the refusal that tells a proven admin to sign in again.
    const accounts = accountsThat();
    const caller = callerThat({ reads: { members: [{ data: [], error: null }] } });

    await expect(
      updateUserById({ privileged: accounts.client, caller: caller.client }, rename),
    ).resolves.toEqual({ status: 404, body: { code: MEMBER_UNKNOWN } });
    expect(caller.log.rpc, 'a missing member still cost an authorization read').toEqual([]);
  });

  it('refuses a member-role caller even over a row they can read', async () => {
    const accounts = accountsThat();
    const caller = callerThat({
      access: { data: [accessRow({ member_role: 'member_role' })], error: null },
      reads: MEMBER_READ,
    });

    await expect(
      updateUserById({ privileged: accounts.client, caller: caller.client }, rename),
    ).resolves.toEqual({ status: 403, body: { code: NOT_AN_ADMIN } });
    expect(caller.log.updates).toEqual([]);
  });

  it.each([
    ['no member id', { username: 'ana.kovacic' }],
    ['a body that is not an object', 7],
  ])('refuses a payload with %s', async (_label, payload) => {
    const accounts = accountsThat();
    const caller = callerThat({ reads: MEMBER_READ });

    await expect(
      updateUserById({ privileged: accounts.client, caller: caller.client }, payload),
    ).resolves.toEqual({ status: 400, body: { code: PAYLOAD_INVALID } });
  });

  it('refuses a username that cannot be a local part, with its own code', async () => {
    const accounts = accountsThat();
    const caller = callerThat({ reads: MEMBER_READ });

    await expect(
      updateUserById(
        { privileged: accounts.client, caller: caller.client },
        { memberId: MEMBER, username: 'ana kovac' },
      ),
    ).resolves.toEqual({ status: 400, body: { code: USERNAME_INVALID } });
  });
});

describe('resetPassword: a new credential, and every session the old one minted', () => {
  const reset = { memberId: MEMBER };

  /** The `members` read the reset makes before it authorizes anything. It needs
   *  no `organizations` answer: a reset touches no address, so no slug is read. */
  const RESET_READ: Readonly<Record<string, readonly PostgrestAnswer[]>> = {
    members: [{ data: [{ organization_id: ORGANIZATION, auth_user_id: ACCOUNT }], error: null }],
  };

  it('authorizes against the ROW’s organization and then sets the password, once', async () => {
    const accounts = accountsThat();
    const caller = callerThat({ reads: RESET_READ });

    const reply = await resetPassword(
      { privileged: accounts.client, caller: caller.client },
      reset,
    );

    expect(reply.status).toBe(200);
    expect(reply.body['code']).toBe(PASSWORD_RESET);
    // THE ORDER, read off the log rather than assumed: the row is read as the
    // caller FIRST, so the organization the authorization is made against comes
    // out of the database and never out of the request body.
    expect(caller.log.reads.map((read) => read.table)).toEqual([MEMBERS_TABLE]);
    expect(caller.log.rpc).toEqual([CURRENT_MEMBER_ACCESS]);
    // ONE auth call, against the account the ROW named.
    expect(accounts.log.updated.map((call) => call.id)).toEqual([ACCOUNT]);
    // AND NOTHING WAS WRITTEN TO `members`. The credential lives in
    // `auth.users`; a row written here would be a column this story adds and
    // `0002:115-158` has none.
    expect(caller.log.updates).toEqual([]);
    expect(caller.log.inserts).toEqual([]);
  });

  it('sends GoTrue the password and nothing else', async () => {
    // `email_confirm` belongs to the address and the rename owns it;
    // `ban_duration` is nobody's, since story 1.6 never bans; and
    // `user_metadata` is the one place a
    // credential must never be written, because every later admin read can see
    // it. Pinned as an exact key list rather than a `toMatchObject`, which
    // would pass over every one of those.
    const accounts = accountsThat();
    const caller = callerThat({ reads: RESET_READ });

    const reply = await resetPassword(
      { privileged: accounts.client, caller: caller.client },
      reset,
    );

    expect(Object.keys(accounts.log.updated[0]?.attributes ?? {})).toEqual(['password']);
    // THE VALUE ON THE WIRE IS THE VALUE IN THE REPLY. Two different strings
    // here is a password shown to an admin that no account ever received.
    expect(accounts.log.updated[0]?.attributes['password']).toBe(reply.body['password']);
    expect(Object.keys(resetAttributes('x'))).toEqual(['password']);
  });

  it('generates the credential with the shared generator, from the injected bytes', async () => {
    // A SECOND GENERATOR IS A DEFECT, and `Math.random` is the shape it takes.
    // The byte source travels with the dependencies precisely so this can be
    // asserted: a generator that ignored it answers a different string.
    const drawn: number[] = [];
    let next = 0;
    const accounts = accountsThat();
    const caller = callerThat({ reads: RESET_READ });

    const reply = await resetPassword(
      {
        privileged: accounts.client,
        caller: caller.client,
        randomBytes: (count) => {
          const bytes = new Uint8Array(count);
          for (let at = 0; at < count; at += 1) {
            bytes[at] = next % PASSWORD_ACCEPTABLE_BYTES;
            drawn.push(bytes[at] ?? 0);
            next += 1;
          }
          return bytes;
        },
      },
      reset,
    );

    const password = String(reply.body['password']);

    expect(password).toHaveLength(PASSWORD_LENGTH);
    expect(drawn.length, 'the injected source was never consulted').toBeGreaterThan(0);
    for (const character of password) {
      expect(PASSWORD_ALPHABET, `${character} is outside the alphabet`).toContain(character);
    }
  });

  it('NEVER generates a credential for a caller it is about to refuse', async () => {
    // The gate comes before the generator, so a refused caller does not cause
    // one more copy of the one value this system cannot recover to exist.
    const accounts = accountsThat();
    const caller = callerThat({
      access: { data: [accessRow({ member_role: 'member_role' })], error: null },
      reads: RESET_READ,
    });

    await expect(
      resetPassword({ privileged: accounts.client, caller: caller.client }, reset),
    ).resolves.toEqual({ status: 403, body: { code: NOT_AN_ADMIN } });
    expect(accounts.log.updated, 'a refused caller reached the auth store').toEqual([]);
  });

  it.each([
    ['an admin of another organization', { organization_id: OTHER_ORGANIZATION }],
    ['a deactivated account', { is_active: false }],
    ['a member-role caller', { member_role: 'member_role' }],
  ])('refuses %s with one indistinguishable code, and writes nothing', async (_label, fields) => {
    // ONE CODE FOR ALL THREE. A caller who can tell them apart learns whether
    // their account was deactivated or merely demoted, and whether a given
    // organization exists — an oracle on the boundary holding the secret key.
    const accounts = accountsThat();
    const caller = callerThat({
      access: { data: [accessRow(fields)], error: null },
      reads: RESET_READ,
    });

    await expect(
      resetPassword({ privileged: accounts.client, caller: caller.client }, reset),
    ).resolves.toEqual({ status: 403, body: { code: NOT_AN_ADMIN } });
    expect(accounts.log.updated).toEqual([]);
  });

  it('authorizes against the ROW’s organization even when the body names another', async () => {
    // THE ORACLE THE OTHER CASES CANNOT BE. Every refusal above is also refused
    // by a version that authorizes against `body.organizationId`, because the
    // reset payload carries no such field and the two values coincide. Here
    // they are made to DISAGREE: the caller administers `ORGANIZATION` and says
    // so in the body, while the row belongs to `OTHER_ORGANIZATION` — so a
    // check pointed at the request answers 200 and replaces a credential in a
    // tenant the caller has no rights in, and a check pointed at the ROW
    // refuses. Nothing else in this file can tell the two apart.
    const accounts = accountsThat();
    const caller = callerThat({
      access: { data: [accessRow()], error: null },
      reads: {
        members: [
          { data: [{ organization_id: OTHER_ORGANIZATION, auth_user_id: ACCOUNT }], error: null },
        ],
      },
    });

    await expect(
      resetPassword(
        { privileged: accounts.client, caller: caller.client },
        { memberId: MEMBER, organizationId: ORGANIZATION },
      ),
    ).resolves.toEqual({ status: 403, body: { code: NOT_AN_ADMIN } });
    expect(accounts.log.updated, 'a credential moved in another tenant').toEqual([]);
  });

  it('IGNORES every field of the payload but the member id', async () => {
    // The other half of the same claim, and the one that keeps it true of
    // fields nobody has thought of: an admin-typed password, a slug, a role.
    // The reset chooses nothing — it reads the row and generates.
    const accounts = accountsThat();
    const caller = callerThat({ reads: RESET_READ });

    const reply = await resetPassword({ privileged: accounts.client, caller: caller.client }, {
      memberId: MEMBER,
      organizationId: OTHER_ORGANIZATION,
      password: 'admin-chose-this',
      role: 'admin',
    });

    expect(reply.status).toBe(200);
    expect(
      accounts.log.updated[0]?.attributes['password'],
      'a password from the request body reached the auth store',
    ).not.toBe('admin-chose-this');
    expect(caller.log.rpc).toEqual([CURRENT_MEMBER_ACCESS]);
  });

  it('gives a member id that reaches no row its OWN code', async () => {
    // Distinct from `NOT_AN_ADMIN`, which tells a proven admin to sign in again
    // over a stale link — an instruction that cannot work. A cross-tenant id and
    // one that never existed are indistinguishable here, because
    // `members_select_own_organization` means the row simply is not there.
    const accounts = accountsThat();
    const caller = callerThat({ reads: { members: [{ data: [], error: null }] } });

    await expect(
      resetPassword({ privileged: accounts.client, caller: caller.client }, reset),
    ).resolves.toEqual({ status: 404, body: { code: MEMBER_UNKNOWN } });
    expect(caller.log.rpc, 'a missing member still cost an authorization read').toEqual([]);
    expect(accounts.log.updated).toEqual([]);
  });

  it('tells a read that could not be PERFORMED apart from one that found nothing', async () => {
    // An outage is never a permanent no. Reported as `MEMBER_UNKNOWN` it is a
    // 404 about a member the admin is looking at, which points them at the
    // wrong thing entirely.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const accounts = accountsThat();
    const caller = callerThat({
      reads: { members: [{ data: null, error: { code: '08006' } }] },
    });

    try {
      await expect(
        resetPassword({ privileged: accounts.client, caller: caller.client }, reset),
      ).resolves.toEqual({ status: 503, body: { code: ACCESS_UNREADABLE } });
      expect(logged, 'the transport failure was swallowed').toHaveBeenCalled();
    } finally {
      logged.mockRestore();
    }
  });

  it('reports an access read that could not be performed as an outage, not a refusal', async () => {
    const accounts = accountsThat();
    const caller = callerThat({
      access: { data: null, error: { code: '08006' } },
      reads: RESET_READ,
    });

    await expect(
      resetPassword({ privileged: accounts.client, caller: caller.client }, reset),
    ).resolves.toEqual({ status: 503, body: { code: ACCESS_UNREADABLE } });
    expect(accounts.log.updated).toEqual([]);
  });

  it('refuses the password set as PASSWORD_NOT_APPLIED, without the cause reaching the reply', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const accounts = accountsThat({
      updated: { data: null, error: { code: 'weak_password', status: 422 } },
    });
    const caller = callerThat({ reads: RESET_READ });

    try {
      const reply = await resetPassword(
        { privileged: accounts.client, caller: caller.client },
        reset,
      );

      expect(reply).toEqual({ status: 502, body: { code: PASSWORD_NOT_APPLIED } });
      // NOTHING TO COMPENSATE: no `members` row was written, so there is no
      // second store to put back and no `saved` half-truth to report.
      expect(caller.log.updates).toEqual([]);
      expect(logged).toHaveBeenCalled();
    } finally {
      logged.mockRestore();
    }
  });

  it('ANSWERS 502 when GoTrue reports no error and no account either', async () => {
    // THE ROW THIS OPERATION EXISTS FOR. `error !== null` alone lets
    // `{ data: { user: null }, error: null }` through as a success carrying a
    // password no account received — and a 200 like that is worse than any
    // refusal: the admin reads the credential out and the member is locked out
    // of the one account with no self-service recovery. `createUser` proves its
    // own write the same way.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const accounts = accountsThat({ updated: { data: { user: null }, error: null } });
    const caller = callerThat({ reads: RESET_READ });

    try {
      const reply = await resetPassword(
        { privileged: accounts.client, caller: caller.client },
        reset,
      );

      expect(reply.status).toBe(502);
      expect(reply.body).toEqual({ code: PASSWORD_NOT_APPLIED });
      // AND NO PASSWORD CAME BACK WITH IT. A refusal carrying the credential
      // anyway is the same defect wearing a 502.
      expect(reply.body['password']).toBeUndefined();
    } finally {
      logged.mockRestore();
    }
  });

  it.each([
    ['no member id', {}],
    ['a member id that is not a string', { memberId: 7 }],
    ['a body that is not an object', 7],
  ])('refuses a payload with %s before it reads anything', async (_label, payload) => {
    const accounts = accountsThat();
    const caller = callerThat({ reads: RESET_READ });

    await expect(
      resetPassword({ privileged: accounts.client, caller: caller.client }, payload),
    ).resolves.toEqual({ status: 400, body: { code: PAYLOAD_INVALID } });
    expect(caller.log.reads, 'a shapeless payload still reached the database').toEqual([]);
  });

  it('lets an admin reset their OWN row, because that is where their own row is served', async () => {
    // `/ljudi/$id` serves the caller's own member row like any other, so the
    // offer stands there. The revocation signs the caller out too, and that is
    // coherent rather than an accident. Human decision 2026-09-22.
    const accounts = accountsThat();
    const caller = callerThat({
      reads: {
        members: [{ data: [{ organization_id: ORGANIZATION, auth_user_id: ACCOUNT }], error: null }],
      },
    });

    const reply = await resetPassword(
      { privileged: accounts.client, caller: caller.client },
      reset,
    );

    expect(reply.status).toBe(200);
    expect(accounts.log.updated.map((call) => call.id)).toEqual([ACCOUNT]);
  });
});

describe('the dispatch is wrapped, so a throw is still a reply the SPA can read', () => {
  function handlerOver(privileged: unknown, caller: unknown) {
    return createHandler(readConfiguration(envFrom()), {
      makePrivilegedClient: () => privileged,
      makeCallerClient: () => caller,
    });
  }

  it('dispatches createUser to the operation rather than falling through', async () => {
    const accounts = accountsThat();
    const caller = callerThat({ reads: SLUG_READ });
    const handle = handlerOver(accounts.client, caller.client);

    const response = await handle(post('createUser', {}, creation()));
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(201);
    expect(body['code']).toBe(MEMBER_CREATED);
  });

  it('dispatches updateUserById to the operation rather than falling through', async () => {
    const accounts = accountsThat();
    const caller = callerThat({
      reads: MEMBER_READ,
      updates: [{ data: [{ id: MEMBER }], error: null }],
    });
    const handle = handlerOver(accounts.client, caller.client);

    const response = await handle(
      post('updateUserById', {}, { memberId: MEMBER, username: 'ana.kovacic' }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ code: USERNAME_CHANGED });
  });

  it('dispatches resetPassword to the operation rather than falling through', async () => {
    // WIRED IN. Undispatched it would reach the handler's final
    // `OPERATION_FAILED`, the SPA would map that to the service fallback, and
    // the one recovery route an account with no address has would be "try
    // again" for ever.
    const accounts = accountsThat();
    const caller = callerThat({
      reads: {
        members: [{ data: [{ organization_id: ORGANIZATION, auth_user_id: ACCOUNT }], error: null }],
      },
    });
    const handle = handlerOver(accounts.client, caller.client);

    const response = await handle(post('resetPassword', {}, { memberId: MEMBER }));
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body['code']).toBe(PASSWORD_RESET);
    expect(typeof body['password']).toBe('string');
  });

  it('carries the CORS headers on an operation REFUSAL, not only on a success', async () => {
    // A refusal the browser cannot read is an opaque network failure with
    // nothing on screen. Every reply the dispatch produces goes through the
    // same `reply`, and this is what notices one that stopped doing so.
    const accounts = accountsThat();
    const caller = callerThat({ reads: SLUG_READ });
    const handle = handlerOver(accounts.client, caller.client);

    const response = await handle(
      post('createUser', { Origin: ALLOWED_ORIGIN }, creation({ leaveAllowanceDays: 'twenty' })),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ code: PAYLOAD_INVALID });
    expect(response.headers.get('access-control-allow-origin')).toBe(ALLOWED_ORIGIN);
    expect(response.headers.get('vary')).toBe('Origin');
  });

  it('turns a THROWN operation into a coded reply that still carries CORS', async () => {
    // A throw escaping `Deno.serve` is a 500 with a body the SPA cannot map to
    // any message AND WITHOUT the `Access-Control-Allow-*` headers every other
    // reply carries — which in a browser is not a 500 at all, but an opaque
    // network failure with nothing on screen to explain it. The client is
    // handed to the operations as an `unknown` cast to a structural interface,
    // so "it is not the shape it was cast to" is the one failure mode the type
    // system cannot rule out.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const caller = {
      rpc: () => Promise.resolve({ data: [accessRow()], error: null }),
      from: () => {
        throw new TypeError('caller.from(...).select is not a function');
      },
    };
    const handle = handlerOver(accountsThat().client, caller);

    try {
      const response = await handle(post('createUser', { Origin: ALLOWED_ORIGIN }, creation()));

      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ code: OPERATION_FAILED, operation: 'createUser' });
      // THE CORS HEADERS ARE THE POINT. Without them the browser reports this
      // as a network failure and the SPA never sees the code at all.
      expect(response.headers.get('access-control-allow-origin')).toBe(ALLOWED_ORIGIN);
      expect(response.headers.get('vary')).toBe('Origin');
      expect(logged, 'the cause was swallowed').toHaveBeenCalled();
    } finally {
      logged.mockRestore();
    }
  });

  it('never leaks the generated credential into a log line', async () => {
    // The one value in the system no later read can recover. It leaves in the
    // reply and nowhere else — `console` would put it somewhere readable long
    // after its one showing.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const accounts = accountsThat();
    const caller = callerThat({ reads: SLUG_READ });

    try {
      const reply = await createUser(
        { privileged: accounts.client, caller: caller.client },
        creation(),
      );
      const password = String(reply.body['password']);

      expect(password.length).toBeGreaterThan(0);
      for (const call of logged.mock.calls) {
        expect(JSON.stringify(call)).not.toContain(password);
      }
      // And it is never written into the account's own metadata, which is
      // readable by any later admin call.
      expect(JSON.stringify(accounts.log.created)).toContain(password);
      expect(Object.keys(accounts.log.created[0] ?? {})).toEqual([
        'email',
        'password',
        'email_confirm',
      ]);
    } finally {
      logged.mockRestore();
    }
  });

  it('never leaks the RESET credential into a log line either', async () => {
    // THE PAIR, and the second half is the one that matters more: a reset is
    // issued precisely when the first copy is already gone, so a console line
    // carrying it is the only remaining copy sitting somewhere anybody with the
    // tab open can read long after the panel is dismissed. It is also never
    // written into the account's metadata, which every later admin call reads.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const accounts = accountsThat();
    const caller = callerThat({
      reads: {
        members: [{ data: [{ organization_id: ORGANIZATION, auth_user_id: ACCOUNT }], error: null }],
      },
    });

    try {
      const reply = await resetPassword(
        { privileged: accounts.client, caller: caller.client },
        { memberId: MEMBER },
      );
      const password = String(reply.body['password']);

      expect(password.length).toBeGreaterThan(0);
      for (const call of logged.mock.calls) {
        expect(JSON.stringify(call)).not.toContain(password);
      }
      expect(JSON.stringify(accounts.log.updated)).toContain(password);
      expect(Object.keys(accounts.log.updated[0]?.attributes ?? {})).toEqual(['password']);
    } finally {
      logged.mockRestore();
    }
  });
});
