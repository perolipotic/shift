import type { Session } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  SESSION_UNREADABLE,
  SUPABASE_ENVIRONMENT_MISSING,
  SUPABASE_PUBLISHABLE_KEY_VARIABLE,
  SUPABASE_URL_VARIABLE,
  buildEnvironment,
  currentSession,
  readSupabaseEnvironment,
  sessionReader,
  supabaseClient,
} from '@/supabase/client';

/**
 * The environment contract, executed rather than declared (story 1.3b).
 *
 * `vite-env.d.ts` types both variables as `string`, which is a promise the type
 * system cannot keep: Vite replaces an undeclared `VITE_*` member access with
 * `undefined`, so a build run without an environment type-checks clean and
 * ships a client that fails every call with a transport error. That failure is
 * indistinguishable from a real outage, which is why the absence has to be a
 * throw and why the throw has to be asserted.
 *
 * `buildEnvironment` is exercised here too, through `vi.stubEnv`, and that is
 * not ceremony: it is the only place the two exported NAMES are tied to the two
 * `import.meta.env` MEMBERS. Swapping the two members, or misspelling one,
 * leaves every assertion about `readSupabaseEnvironment` true and throws
 * `SUPABASE_ENVIRONMENT_MISSING` in a deployment that is configured perfectly —
 * a defect that can only be found by reading the file or by shipping it.
 *
 * `sessionReader` is the other thing here that nothing used to run.
 * `router.ts` held it as an inline arrow, so mutating it to `async () => null`
 * kept the whole suite green while every signed-in visitor bounced endlessly
 * between `/` and `/prijava`.
 */

const missing = (): string | undefined => undefined;

describe('a missing environment fails fast and loudly', () => {
  it.each([
    { row: 'both variables absent', url: undefined, key: undefined },
    { row: 'the URL absent', url: undefined, key: 'sb_publishable_local' },
    { row: 'the publishable key absent', url: 'http://127.0.0.1:54321', key: undefined },
  ])('throws the stable code when $row', ({ url, key }) => {
    expect(() =>
      readSupabaseEnvironment((name) => (name === SUPABASE_URL_VARIABLE ? url : key)),
    ).toThrow(SUPABASE_ENVIRONMENT_MISSING);
  });

  it.each([
    { row: 'an empty string', value: '' },
    { row: 'whitespace only', value: '   ' },
    { row: 'a bare newline, as a dashboard paste leaves', value: '\n' },
  ])('treats $row as absent rather than as a value', ({ value }) => {
    expect(() => readSupabaseEnvironment(() => value)).toThrow(SUPABASE_ENVIRONMENT_MISSING);
  });

  it.each([
    { row: 'a JWT, as the older local stack issued', value: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9' },
    { row: 'a project ref pasted into the key slot', value: 'abcdefghijklmnopqrst' },
    { row: 'an unsubstituted placeholder', value: '${SUPABASE_KEY}' },
    { row: 'a key for the wrong side of AD-17', value: 'sb_sec' + 'ret_deliberately_split' },
  ])('refuses $row, because only a publishable key belongs in this bundle', ({ value }) => {
    // AD-17 is the application's central invariant and the URL's shape was
    // checked while the key's was not. `vite-env.d.ts` says the value "must
    // match `sb_publishable_*`" and `.env.example` calls the wrong one "a
    // security defect", but both were prose: a secret key pasted here built a
    // working client and Vite inlined it into every chunk served to every
    // browser. The only thing in the way was `key-hygiene.test.ts`'s bundle
    // scan, which is `skipIf(notBuilt)` and which `pnpm test` does not build
    // for — so on a fresh checkout nothing checked it at all.
    //
    // The last row is SPLIT across a concatenation deliberately. That prefix
    // may not appear as a literal anywhere under `apps/`, which
    // `key-hygiene.test.ts`'s naming scan enforces — so the one shape this
    // guard most needs to refuse is the one shape this file may not spell.
    expect(() =>
      readSupabaseEnvironment((name) =>
        name === SUPABASE_URL_VARIABLE ? 'http://127.0.0.1:54321' : value,
      ),
    ).toThrow(SUPABASE_ENVIRONMENT_MISSING);
  });

  it('names a stable SCREAMING_SNAKE code, not a user-facing message', () => {
    // The convention `ROOT_ELEMENT_MISSING` and `LOCALIZATION_INIT_FAILED`
    // established: this throw happens before anything is mounted, so there is
    // no translation layer to route it through and no screen to put it on.
    expect(SUPABASE_ENVIRONMENT_MISSING).toMatch(/^[A-Z][A-Z_]+$/);
  });
});

describe('a present environment is passed through unchanged', () => {
  it('returns both values, trimmed', () => {
    const environment = readSupabaseEnvironment((name) =>
      name === SUPABASE_URL_VARIABLE ? '  http://127.0.0.1:54321 ' : ' sb_publishable_local\n',
    );

    expect(environment).toEqual({
      url: 'http://127.0.0.1:54321',
      publishableKey: 'sb_publishable_local',
    });
  });

  it('reads exactly the two variables AD-17 permits, by name', () => {
    // A third input would be a third thing to configure per environment, and
    // the only remaining candidate is the secret key.
    const asked: string[] = [];

    readSupabaseEnvironment((name) => {
      asked.push(name);

      // A real URL for the URL, since the reader now checks its shape too and
      // this assertion is about WHICH names are asked for, not about values.
      return name === SUPABASE_URL_VARIABLE ? 'http://127.0.0.1:54321' : 'sb_publishable_local';
    });

    expect(asked.sort()).toEqual(
      [SUPABASE_PUBLISHABLE_KEY_VARIABLE, SUPABASE_URL_VARIABLE].sort(),
    );
    expect(asked).toHaveLength(2);
  });

  it('names the publishable key and never the secret one', () => {
    expect(SUPABASE_PUBLISHABLE_KEY_VARIABLE).toContain('PUBLISHABLE');
    expect(SUPABASE_URL_VARIABLE.startsWith('VITE_')).toBe(true);
    expect(SUPABASE_PUBLISHABLE_KEY_VARIABLE.startsWith('VITE_')).toBe(true);
  });

  it('would not accept a reader that answers nothing, so the guard is real', () => {
    // Vacuous-pass guard: a `readSupabaseEnvironment` that never threw would
    // make every assertion in the first block pass on any input.
    expect(() => readSupabaseEnvironment(missing)).toThrow();
  });
});

describe('a value that is present but not a URL is absent too', () => {
  // NARROWED-IN by review. `createClient('dvdkastelnovi', key)` constructs
  // happily and then resolves every call against a relative path, so the first
  // symptom of a project REF pasted where its URL belongs is a 404 that reads
  // exactly like an outage — and the screen says "try again" forever.
  it.each([
    ['a bare project ref', 'abcdefghijklmnop'],
    ['a host with no scheme', '127.0.0.1:54321'],
    ['an unsubstituted template', '${SUPABASE_URL}'],
    ['a scheme that is not HTTP', 'ftp://127.0.0.1:54321'],
    ['a lone slash', '/'],
  ])('throws the same stable code for %s', (_case, url) => {
    expect(() =>
      readSupabaseEnvironment((name) =>
        name === SUPABASE_URL_VARIABLE ? url : 'sb_publishable_local',
      ),
    ).toThrow(SUPABASE_ENVIRONMENT_MISSING);
  });

  it.each([
    ['the local stack', 'http://127.0.0.1:54321'],
    ['a deployed project', 'https://abcdefghijklmnop.supabase.co'],
  ])('accepts %s, so the check is not simply refusing everything', (_case, url) => {
    expect(
      readSupabaseEnvironment((name) =>
        name === SUPABASE_URL_VARIABLE ? url : 'sb_publishable_local',
      ).url,
    ).toBe(url);
  });
});

describe('the two names are wired to the two build-time members', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([
    { name: 'the project URL', variable: SUPABASE_URL_VARIABLE, value: 'http://127.0.0.1:54321' },
    {
      name: 'the publishable key',
      variable: SUPABASE_PUBLISHABLE_KEY_VARIABLE,
      value: 'sb_publishable_local',
    },
  ])('reads $name from the member its constant names', ({ variable, value }) => {
    vi.stubEnv(variable, value);

    expect(
      buildEnvironment(variable),
      `${variable} is not the import.meta.env member buildEnvironment reads for it`,
    ).toBe(value);
  });

  it('does not answer for a name it was never given', () => {
    // The reader is a fixed two-entry map, not a passthrough: a third variable
    // would be a third thing to configure per environment, and the only
    // remaining candidate is the secret key.
    vi.stubEnv('VITE_SUPABASE_SOMETHING_ELSE', 'value');

    expect(buildEnvironment('VITE_SUPABASE_SOMETHING_ELSE')).toBeUndefined();
  });

  it('carries the stubbed environment all the way through the reader', () => {
    // End to end across the two functions, which is the pairing that actually
    // ships: a swap between the two members passes every assertion above taken
    // singly and fails this one.
    vi.stubEnv(SUPABASE_URL_VARIABLE, 'http://127.0.0.1:54321');
    vi.stubEnv(SUPABASE_PUBLISHABLE_KEY_VARIABLE, 'sb_publishable_local');

    expect(readSupabaseEnvironment(buildEnvironment)).toEqual({
      url: 'http://127.0.0.1:54321',
      publishableKey: 'sb_publishable_local',
    });
  });
});

describe('there is exactly one construction path', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('exposes a single client accessor and no exported instance', () => {
    // Two clients would keep two session stores and disagree about who is
    // signed in. The module exports a function, so there is one place the
    // instance can come from and one place it can be memoized.
    expect(supabaseClient).toBeTypeOf('function');
  });

  it('returns the same instance every time, which was documented and unasserted', () => {
    // IDENTITY. `supabaseClient()` constructing a fresh client per call would
    // satisfy every other assertion in this file while each caller got its own
    // session storage — so `signIn` would establish a session in one client and
    // `sessionReader` would read `null` from another.
    vi.stubEnv(SUPABASE_URL_VARIABLE, 'http://127.0.0.1:54321');
    vi.stubEnv(SUPABASE_PUBLISHABLE_KEY_VARIABLE, 'sb_publishable_local');

    expect(supabaseClient()).toBe(supabaseClient());
  });

  it('hands createClient the url first and the key second', async () => {
    // MUTATION-PROVEN GAP. This module's own doc block argues that swapping the
    // two `import.meta.env` members is "a defect that can only be found by
    // reading the file or by shipping it", and builds a whole `buildEnvironment`
    // block to close that — while the call the two values actually flow into
    // was asserted only by identity. `createClient(publishableKey, url)`
    // type-checks (both are `string`), passes every other test here, and
    // produces exactly the "fails every call like an outage" symptom the module
    // exists to prevent.
    //
    // Module isolation, because the client is memoized: an instance built by an
    // earlier test in this file would be returned before the mock is ever
    // reached.
    vi.resetModules();
    vi.stubEnv(SUPABASE_URL_VARIABLE, 'http://127.0.0.1:54321');
    vi.stubEnv(SUPABASE_PUBLISHABLE_KEY_VARIABLE, 'sb_publishable_local');

    const createClient = vi.fn(() => ({ auth: {} }));

    vi.doMock('@supabase/supabase-js', () => ({ createClient }));

    const isolated = await import('@/supabase/client');

    isolated.supabaseClient();

    expect(createClient).toHaveBeenCalledTimes(1);
    expect(createClient).toHaveBeenCalledWith('http://127.0.0.1:54321', 'sb_publishable_local');

    vi.doUnmock('@supabase/supabase-js');
    vi.resetModules();
  });
});

describe('the session reader is a function, not a line in the router', () => {
  /** Enough of a session to be distinguishable from `null`. */
  const SESSION = { access_token: 'token', user: { id: 'member' } } as unknown as Session;

  const answering = (answer: {
    session: Session | null;
    error: { message?: string } | null;
  }) => ({
    getSession: () => Promise.resolve({ data: { session: answer.session }, error: answer.error }),
  });

  it('delegates to getSession on the source it is handed', async () => {
    let asked = 0;
    const read = sessionReader(() => {
      asked += 1;

      return answering({ session: SESSION, error: null });
    });

    expect(await read()).toBe(SESSION);
    expect(asked, 'the reader never asked its source').toBe(1);
  });

  it('asks again on every call rather than caching an answer', async () => {
    // `/` resolves this on every navigation, and the whole reason it is a
    // reader rather than a value is that a snapshot is stale at exactly the
    // moment sign-in navigates to `/`.
    const answers = [null, SESSION];
    const read = sessionReader(() => ({
      getSession: () =>
        Promise.resolve({ data: { session: answers.shift() ?? null }, error: null }),
    }));

    expect(await read()).toBeNull();
    expect(await read()).toBe(SESSION);
  });

  it('returns null when there is no session', async () => {
    expect(await sessionReader(() => answering({ session: null, error: null }))()).toBeNull();
  });

  it('does not sign anybody out over an error that came with a session', async () => {
    // The decision review asked for. `getSession` reports a problem alongside
    // whatever it managed to read — a refresh that failed against a session
    // still held in memory is exactly that shape — and returning `null` for it
    // would evict a signed-in person on a transient fault.
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      const read = sessionReader(() =>
        answering({ session: SESSION, error: { message: 'refresh failed' } }),
      );

      expect(await read()).toBe(SESSION);
      // Not silent, which is the other half of the requirement.
      expect(logged).toHaveBeenCalledWith(SESSION_UNREADABLE, { message: 'refresh failed' });
    } finally {
      logged.mockRestore();
    }
  });

  it('reports an error that came with no session, and still answers null', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    try {
      const read = sessionReader(() => answering({ session: null, error: { message: 'blocked' } }));

      expect(await read()).toBeNull();
      expect(logged, 'an unreadable session was swallowed').toHaveBeenCalled();
    } finally {
      logged.mockRestore();
    }
  });

  it('lets a rejecting source reject, because the caller fails closed', async () => {
    // Storage blocked (Safari private mode) or a client that cannot be built at
    // all. The reader does not decide what that means — `/`'s `beforeLoad`
    // does, and it redirects. Swallowing it here would hide a misconfiguration
    // behind a perfectly ordinary signed-out screen.
    const read = sessionReader(() => ({
      getSession: () => Promise.reject(new Error('SecurityError')),
    }));

    await expect(read()).rejects.toThrow('SecurityError');
  });

  it('binds one reader for the router to name', () => {
    // `currentSession` is what `router.ts` imports and `router.test.ts` pins by
    // identity. Built at module scope from a THUNK, so no client is
    // constructed and no environment is needed to import it — which this
    // assertion proves by existing in a suite that configures neither.
    expect(currentSession).toBeTypeOf('function');
  });
});
