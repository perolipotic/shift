import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  DESTINATIONS,
  destinationsFor,
  type Destination,
  type MemberRole,
} from '@/navigation/destinations';

/**
 * The role-to-destination mapping, EXECUTED.
 *
 * This is the whole reason the table is a `.ts` module rather than markup. L2 is
 * an ESLint `no-restricted-syntax` selector over JSX shapes, and
 * `[{ label: 'Danas' }]` is neither JSX nor a `t()` call — so the one L2 gap no
 * syntactic rule can close is exactly the shape a navigation table takes.
 * Keeping the mapping as data moves the guarantee to a test that runs it: the
 * counts below are computed from the shipped table rather than read off a
 * regex, and a label smuggled in where a key belongs fails an assertion instead
 * of passing a lint.
 *
 * The numbers are binding, not illustrative. UX-DR31 gives the member role four
 * destinations and no configuration surface at all; UX-DR32 adds four more for
 * an admin (`epics.md:151-152`). `Sati` appears in both lists and is ONE
 * destination with role-scoped content (human decision, 2026-09-04) — so eight
 * exist, not nine, and "appears once" is asserted per role rather than assumed
 * from the total.
 *
 * `.ts` and not `.tsx`: `apps/web/vitest.config.ts` collects `src/**\/*.test.ts`
 * only, so a `.tsx` test here would be silently uncollected — green while
 * asserting nothing.
 */

const RESOURCE = join(
  fileURLToPath(new URL('..', import.meta.url)),
  'i18n',
  'locales',
  'hr.json',
);

/** Every leaf key path in the resource file, dotted the way i18next resolves. */
function resourceKeys(node: unknown = JSON.parse(readFileSync(RESOURCE, 'utf8')), prefix = ''): string[] {
  if (typeof node !== 'object' || node === null) return [prefix];

  return Object.entries(node).flatMap(([key, value]) =>
    resourceKeys(value, prefix === '' ? key : `${prefix}.${key}`),
  );
}

/** Every message in the resource file, however deeply nested. */
function resourceMessages(node: unknown = JSON.parse(readFileSync(RESOURCE, 'utf8'))): string[] {
  if (typeof node === 'string') return [node];
  if (typeof node !== 'object' || node === null) return [];

  return Object.values(node).flatMap((value) => resourceMessages(value));
}

/** The keys a role reaches, in the order the table binds them. */
function keysFor(role: MemberRole): string[] {
  return destinationsFor(role).map((destination) => destination.key);
}

/** One message by its dotted key path, or `undefined`. */
function messageAt(key: string): unknown {
  return key
    .split('.')
    .reduce<unknown>(
      (node, part) => (node as Record<string, unknown> | undefined)?.[part],
      JSON.parse(readFileSync(RESOURCE, 'utf8')),
    );
}

/**
 * Every string a destination carries, at ANY depth.
 *
 * A denylist of property names would pass for the property nobody thought of,
 * so this walks values instead — and it walks them RECURSIVELY, which the first
 * version did not. Scalars plus one array level left `{ meta: { label: 'Danas' } }`
 * passing both label sweeps below while carrying exactly the string they exist
 * to refuse, which made the sweeps weaker than their own comments claimed.
 */
function stringsOf(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (value === null || typeof value !== 'object') return [];

  return Object.values(value).flatMap((nested: unknown) => stringsOf(nested));
}

describe('the table is read at all, so every count below means something', () => {
  it('holds eight destinations and no more', () => {
    // Vacuous-pass guard, and the story's own total. A table that failed to
    // load, or one narrowed to nothing, would satisfy "no entry carries a
    // label" and "Sati appears once" while proving neither.
    expect(DESTINATIONS).toHaveLength(8);
  });

  it('gives every destination a distinct label, not merely a distinct key', () => {
    // Two keys resolving to the same `hr.json` string is a navigation with two
    // entries a person cannot tell apart, and every assertion about KEYS passes
    // for it — the keys differ, the counts are right, and the labels collide
    // only once i18next resolves them.
    const labels = DESTINATIONS.map((destination) => messageAt(destination.key));

    expect(labels).not.toContain(undefined);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('gives every destination a distinct path and a distinct key', () => {
    // Two entries sharing a path is one destination the router can never
    // reach; two sharing a key is one label rendered twice with no way to tell
    // which screen a person is on.
    const paths = DESTINATIONS.map((destination) => destination.path);
    const keys = DESTINATIONS.map((destination) => destination.key);

    expect(new Set(paths).size).toBe(paths.length);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('each role reaches exactly the destinations its rule names', () => {
  it('gives the member role four, in binding order', () => {
    // UX-DR31, exhaustively and IN ORDER rather than as a set: the order is
    // what a tab bar and a sidebar both render, and a set assertion would let
    // it drift silently.
    expect(keysFor('member_role')).toEqual([
      'nav.danas',
      'nav.kalendar',
      'nav.sati',
      'nav.godisnji',
    ]);
  });

  it('gives the admin role eight, in binding order', () => {
    // UX-DR32: the member's four, then the four grouped configuration
    // destinations. Same first four in the same order, which is what makes the
    // two layouts one architecture.
    expect(keysFor('admin')).toEqual([
      'nav.danas',
      'nav.kalendar',
      'nav.sati',
      'nav.godisnji',
      'nav.raspored',
      'nav.ljudi',
      'nav.postavkeRotacije',
      'nav.organizacija',
    ]);
  });

  it('gives the member role no configuration surface at all', () => {
    // The half of UX-DR31 a count cannot state. Four is also the answer if the
    // four happened to be the wrong four, and the specific fear is a
    // configuration destination leaking into the member's list.
    for (const key of ['nav.raspored', 'nav.ljudi', 'nav.postavkeRotacije', 'nav.organizacija']) {
      expect(keysFor('member_role'), `a member reaches ${key}`).not.toContain(key);
    }
  });

  it.each<MemberRole>(['member_role', 'admin'])('lists Sati exactly once for %s', (role) => {
    // The human decision of 2026-09-04. UX-DR31 and UX-DR32 both name `Sati`,
    // and reading them additively produces nine destinations with two called
    // the same thing — one of which no navigation could distinguish from the
    // other. It is ONE destination whose content is role-scoped.
    expect(keysFor(role).filter((key) => key === 'nav.sati')).toHaveLength(1);
  });

  it('yields a subsequence of the table for every role, never a reordering', () => {
    // `destinationsFor` FILTERS; it must never sort. A sort would make the
    // order a property of some comparator rather than of the table above, and
    // the two orders would then be free to disagree.
    for (const role of ['member_role', 'admin'] as const) {
      const all: string[] = DESTINATIONS.map((destination) => destination.key);
      const positions = keysFor(role).map((key) => all.indexOf(key));

      expect(positions).toEqual([...positions].sort((a, b) => a - b));
    }
  });
});

describe('the table stores keys, never labels', () => {
  it('names a nav key that the resource file actually declares', () => {
    // A key absent from `hr.json` renders `⟦nav.…⟧` — visible degradation
    // rather than a crash (L5), which is exactly why nothing else would notice
    // it. Typing catches it at `pnpm typecheck` too; this is the half that
    // survives a widened type.
    const declared = resourceKeys();

    for (const destination of DESTINATIONS) {
      expect(destination.key, `${destination.key} is not a nav key`).toMatch(/^nav\./);
      expect(declared, `${destination.key} is not declared in hr.json`).toContain(destination.key);
    }
  });

  it('renders every nav key the resource file declares', () => {
    // The other direction: a `nav.*` key in `hr.json` that no destination
    // carries is a label nobody reviewed and nothing shows.
    const navKeys = resourceKeys().filter((key) => key.startsWith('nav.'));
    const carried = DESTINATIONS.map((destination) => destination.key);

    expect(navKeys.length).toBeGreaterThan(0);
    expect([...navKeys].sort()).toEqual([...carried].sort());
  });

  it('carries no user-facing string anywhere in an entry', () => {
    // THE L2 GAP THIS FILE EXISTS FOR. `{ label: 'Danas' }` is not JSX and not
    // a call, so no ESLint selector can reach it. Asserted against the resource
    // file's own messages rather than against a word list: any string a person
    // could read is in `hr.json`, so an entry holding one of them is holding a
    // label.
    const labels = new Set(resourceMessages());

    expect(labels.size).toBeGreaterThan(0);
    for (const destination of DESTINATIONS) {
      for (const value of stringsOf(destination)) {
        expect(labels.has(value), `a destination carries the label ${value}`).toBe(false);
      }
    }
  });

  it('carries nothing but keys, paths and role names', () => {
    // The complement, and the stronger claim: the assertion above only refuses
    // strings that are ALREADY in `hr.json`, so a label authored nowhere else
    // would pass it. This allows three shapes and nothing more.
    const roles: readonly string[] = ['member_role', 'admin'];

    for (const destination of DESTINATIONS) {
      for (const value of stringsOf(destination)) {
        expect(
          value.startsWith('nav.') || value.startsWith('/') || roles.includes(value),
          `a destination carries ${value}, which is neither a key, a path nor a role`,
        ).toBe(true);
      }
    }
  });
});

describe('the readers read what they claim to read', () => {
  // Detector self-tests, the idiom `packages/domain/test/purity.test.ts`
  // established: a `resourceKeys` that returned nothing would make the two
  // key assertions above pass against any table at all.
  it('flattens the resource file the way i18next resolves it', () => {
    expect(resourceKeys({ a: { b: 'x', c: 'y' }, d: 'z' }).sort()).toEqual(['a.b', 'a.c', 'd']);
    expect(resourceKeys()).toContain('nav.danas');
    expect(resourceKeys()).not.toContain('nav.odjava');
  });

  it('collects every message, however deeply nested', () => {
    expect(resourceMessages({ one: { two: 'deep' }, three: 'flat' }).sort()).toEqual([
      'deep',
      'flat',
    ]);
    expect(resourceMessages()).toContain('Danas');
  });

  it('reads every string on an entry, at every depth', () => {
    // Three shapes the label sweeps must see through, and the last two are the
    // ones a scalars-plus-one-array walk missed: a string inside the role list,
    // and a string nested under an object property. `{ meta: { label: 'Danas' } }`
    // is the exact entry the sweeps exist to refuse.
    expect(
      stringsOf({ key: 'nav.danas', path: '/danas', roles: ['admin'] } as Destination).sort(),
    ).toEqual(['/danas', 'admin', 'nav.danas']);
    expect(stringsOf({ meta: { label: 'Danas' } })).toEqual(['Danas']);
    expect(stringsOf({ a: [{ b: ['deep'] }] })).toEqual(['deep']);
    expect(stringsOf({ n: 1, missing: null })).toEqual([]);
  });

  it('resolves a key path to its message and a wrong one to nothing', () => {
    // `messageAt` is what the distinct-label assertion reads through. A version
    // that returned `undefined` for everything would make that assertion
    // compare a set of eight undefineds and fail loudly — but one that returned
    // the same OBJECT for everything would make it fail silently in the other
    // direction, so both polarities are pinned.
    expect(messageAt('nav.danas')).toBe('Danas');
    expect(messageAt('nav.postavkeRotacije')).toBe('Postavke rotacije');
    expect(messageAt('nav.nema')).toBeUndefined();
  });
});
