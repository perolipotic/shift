import { describe, expect, it } from 'vitest';

import {
  knownPathOf,
  returnSearchFor,
  returnSearchOf,
  RETURN_TARGET_MAX_LENGTH,
  returnTargetOf,
  SIGNED_IN_HOME,
} from '@/features/auth/services/return-target';

/**
 * The return target a successful sign-in follows. Every rejected shape is its
 * own row, because each is a different way the parameter could point off this
 * application, and a validator that refuses four of them still redirects on the
 * fifth. The route tree comes in as a stub here; `router.test.ts` runs
 * `knownPathOf` against the real one.
 */

const KNOWN = new Set(['/', '/kalendar', '/danas', '/ljudi/abc']);
const isKnown = (pathname: string): boolean => KNOWN.has(pathname);

describe('returnTargetOf', () => {
  it.each([
    ['a bare destination', '/kalendar', '/kalendar'],
    ['a destination with a search', '/kalendar?mjesec=2031-02', '/kalendar?mjesec=2031-02'],
    ['a destination with a search and a hash', '/kalendar?tim=2#tjedan', '/kalendar?tim=2#tjedan'],
    ['a parameterized route', '/ljudi/abc', '/ljudi/abc'],
    ['the root with its search', '/?invite=abc#section', '/?invite=abc#section'],
    ['a path with dot segments, normalized', '/ljudi/../kalendar?x=1', '/kalendar?x=1'],
  ])('follows %s', (_name, candidate, expected) => {
    expect(returnTargetOf(candidate, isKnown)).toBe(expected);
  });

  it.each([
    ['no target at all', undefined],
    ['an empty string', ''],
    ['an absolute URL', 'https://evil.example/kalendar'],
    ['an absolute URL to this path shape', 'http://return-target.invalid/kalendar'],
    ['a protocol-relative URL', '//evil.example/kalendar'],
    ['a backslash after the slash', '/\\evil.example/kalendar'],
    ['a backslash anywhere', '/kalendar\\x'],
    ['a javascript: URL', 'javascript:alert(1)'],
    ['a javascript: URL behind a slash', '/javascript:alert(1)'],
    ['a data: URL', 'data:text/html,<script>alert(1)</script>'],
    ['a bare word', 'kalendar'],
    ['a tab smuggled into the scheme', '/\t/evil.example'],
    ['a newline', '/kalendar\n'],
    ['an unknown path', '/does-not-exist'],
    ['an unknown path below a known one', '/kalendar/2026-09/does-not-exist'],
  ])('refuses %s and falls back to /', (_name, candidate) => {
    expect(returnTargetOf(candidate, isKnown)).toBe(SIGNED_IN_HOME);
  });

  // DEFENCE IN DEPTH, with a tree that knows EVERY path: these rows pass only
  // because the resolved pathname is checked, not because the route tree
  // happens to refuse them.
  it.each([
    ['a dot segment before a double slash', '/.//evil.example/kalendar'],
    ['a parent segment before a double slash', '/kalendar/..//evil.example'],
    ['an encoded parent segment before a double slash', '/%2e%2e//evil.example'],
  ])('refuses %s even when every path is known', (_name, candidate) => {
    expect(returnTargetOf(candidate, () => true)).toBe(SIGNED_IN_HOME);
  });

  it('refuses a candidate longer than the bound, and follows one at it', () => {
    const atBound = `/kalendar?x=${'a'.repeat(RETURN_TARGET_MAX_LENGTH - '/kalendar?x='.length)}`;

    expect(atBound).toHaveLength(RETURN_TARGET_MAX_LENGTH);
    expect(returnTargetOf(atBound, isKnown)).toBe(atBound);
    expect(returnTargetOf(`${atBound}a`, isKnown)).toBe(SIGNED_IN_HOME);
  });

  it('asks the tree about the resolved pathname, never the raw candidate', () => {
    const asked: string[] = [];

    returnTargetOf('/ljudi/../kalendar?x=1#y', (pathname) => {
      asked.push(pathname);

      return true;
    });

    expect(asked).toEqual(['/kalendar']);
  });
});

describe('returnSearchOf', () => {
  it('keeps a string target and nothing else', () => {
    expect(returnSearchOf({ povratak: '/kalendar', tim: 2 })).toEqual({ povratak: '/kalendar' });
  });

  it('drops a target that is not a string', () => {
    expect(returnSearchOf({ povratak: 2 })).toEqual({});
    expect(returnSearchOf({})).toEqual({});
  });
});

describe('returnSearchFor', () => {
  it('carries the whole href of the location the redirect was raised at', () => {
    expect(returnSearchFor('/kalendar?tim=2#tjedan')).toEqual({ povratak: '/kalendar?tim=2#tjedan' });
  });

  it('carries nothing for the bare root, where a sign-in lands anyway', () => {
    expect(returnSearchFor('/')).toEqual({});
  });
});

describe('knownPathOf', () => {
  it('knows a path whose match chain has no not-found, and refuses one that has', () => {
    const known = knownPathOf({
      matchRoutes: (pathname) =>
        pathname === '/kalendar' ? [{}, { _notFound: false }] : [{ _notFound: true }, {}],
    });

    expect(known('/kalendar')).toBe(true);
    expect(known('/nowhere')).toBe(false);
  });
});
