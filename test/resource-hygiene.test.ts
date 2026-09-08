import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * `hr.json` is the artifact story 1.1d multiplies, and nothing guarded it.
 *
 * Story 1.1c's own frozen boundary says: "No screen, navigation, nav label or
 * terminology string in the resource file — 1.1d owns every screen literal so
 * it reviews them in one place." That is a rule about a file whose whole
 * purpose is to grow, written at the one moment the file is small enough to
 * state it precisely. Nothing enforced it, and nothing enforced UX-DR34's or
 * UX-DR36's constraints on what the strings may say either — so the first
 * screen literal added out of turn, or the first `smjena` used for a shift
 * type, would land with no assertion in its way.
 *
 * Shaped after `test/key-hygiene.test.ts`: a small number of specific fears,
 * each with its own sweep, and a vacuous-pass guard so an unreadable or
 * restructured file cannot look compliant.
 *
 * When a story legitimately adds screen strings, the SANCTIONED_KEYS list is
 * what it updates — deliberately, in the same commit, which is the review
 * moment this exists to create. Story 1.1d did exactly that, and in doing so
 * had to split the list: the three-form ICU assertion below is a rule about
 * PLURALS, and appending `auth.heading` to a single list would have failed it
 * as a non-plural rather than checked it as a screen string.
 */

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const RESOURCE = join(repoRoot, 'apps', 'web', 'src', 'i18n', 'locales', 'hr.json');

/** The two plural messages story 1.1c is permitted to ship (`EXPERIENCE.md:81`).
 *  Only these carry an ICU `plural` argument, so only these are checked for the
 *  three Croatian categories. */
const SANCTIONED_PLURAL_KEYS = ['count.days', 'count.conflicts'];

/** The flat screen strings the sign-in path is permitted to ship: 1.1d's
 *  seven, plus the six story 1.3b adds — two refusal messages, the three-string
 *  organization prompt, and the signed-in placeholder heading. Nothing else in
 *  the tree may add a key without editing this list, which is the point. */
const SANCTIONED_SCREEN_KEYS = [
  'auth.heading',
  'auth.username',
  'auth.password',
  'auth.submit',
  'auth.passwordReset',
  // Two, not three. A wrong password, an unknown username and a deactivated
  // account share `auth.error.credentials`: a third message would tell an
  // anonymous caller which usernames exist in an organization, which is the
  // enumeration oracle story 1.3b refused a resolution RPC for.
  'auth.error.credentials',
  'auth.error.unavailable',
  'auth.organization.heading',
  'auth.organization.label',
  'auth.organization.submit',
  // Explicitly temporary: the navigation shell replaces the signed-in
  // placeholder wholesale.
  'home.heading',
  'notFound.heading',
  'notFound.back',
];

/** Everything the resource file is permitted to hold, together. */
const SANCTIONED_KEYS = [...SANCTIONED_PLURAL_KEYS, ...SANCTIONED_SCREEN_KEYS];

function resource(): Record<string, unknown> {
  return JSON.parse(readFileSync(RESOURCE, 'utf8')) as Record<string, unknown>;
}

/** Every leaf key path, dotted the way i18next resolves them. */
function leafKeys(node: unknown, prefix = ''): string[] {
  if (typeof node !== 'object' || node === null) return [prefix];

  return Object.entries(node).flatMap(([key, value]) =>
    leafKeys(value, prefix === '' ? key : `${prefix}.${key}`),
  );
}

/** One message by its dotted key path. */
function messageAt(key: string): unknown {
  return key
    .split('.')
    .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], resource());
}

function messages(): string[] {
  const found: string[] = [];
  const walk = (node: unknown): void => {
    if (typeof node === 'string') {
      found.push(node);
      return;
    }
    if (typeof node === 'object' && node !== null) Object.values(node).forEach(walk);
  };
  walk(resource());

  return found;
}

describe('the resource file holds only what this story sanctions', () => {
  it('parses as an object with keys, so every sweep below means something', () => {
    // Vacuous-pass guard: an empty or restructured file would satisfy every
    // "does not contain" assertion while proving nothing.
    expect(Object.keys(resource()).length).toBeGreaterThan(0);
    expect(messages().length).toBeGreaterThan(0);
  });

  it('holds exactly the sanctioned keys and nothing else', () => {
    // The frozen boundary: 1.1d owns every screen literal so it can review them
    // in one place. A key added outside that review bypasses it.
    expect([...leafKeys(resource())].sort()).toEqual([...SANCTIONED_KEYS].sort());
  });

  it('keeps the two lists disjoint, so neither sweep can go vacuous', () => {
    // A key listed twice would shrink the key-set assertion above without
    // shrinking the file, and a plural key copied into the screen list would
    // escape the three-form check below.
    expect(new Set(SANCTIONED_KEYS).size).toBe(SANCTIONED_KEYS.length);
    expect(SANCTIONED_PLURAL_KEYS.length).toBeGreaterThan(0);
    expect(SANCTIONED_SCREEN_KEYS.length).toBeGreaterThan(0);
  });

  it.each(SANCTIONED_SCREEN_KEYS)('declares %s as a plain string, not an ICU argument', (key) => {
    // The other half of the partition. A screen string that quietly grew a
    // `{count, plural, …}` body would need the three-form check the block below
    // runs only over the plural list, so this is what notices it happening.
    const message = String(messageAt(key));

    expect(message.length).toBeGreaterThan(0);
    // Every ICU argument type, not only `plural` — `select` and
    // `selectordinal` are the same shape of smuggled argument and the bare
    // substring check would miss either.
    expect(
      message,
      `${key} carries an ICU argument and belongs in the plural list`,
    ).not.toMatch(/\{[^,}]+,\s*(plural|select|selectordinal)\s*,/);
  });

  it.each(SANCTIONED_PLURAL_KEYS)('declares %s as an ICU plural with all three Croatian forms', (key) => {
    const message = messageAt(key);

    expect(typeof message).toBe('string');
    // one/few/other, and `other` is not optional: Croatian needs all three, and
    // a message missing one silently renders the wrong noun (L7).
    for (const category of ['one', 'few', 'other']) {
      expect(String(message), `${key} declares no ${category} form`).toContain(`${category} {`);
    }
    expect(String(message)).toContain('plural');
  });
});

describe('the messages obey the voice rules that bind every string', () => {
  it('uses no exclamation mark anywhere', () => {
    // UX-DR34: no exclamation marks, no encouragement, no personality where a
    // fact will do. Cheap to assert now, and the assertion is what makes it
    // true of the hundred strings 1.1d and Epic 3 add.
    for (const message of messages()) {
      expect(message, `${message} carries an exclamation mark`).not.toContain('!');
    }
  });

  it('never says smjena for a shift type', () => {
    // UX-DR36 and the terminology contract: `Smjena` is the Team, `Tip smjene`
    // is the Shift Type, and using the former for the latter is a contract
    // violation however natural it reads. Neither message should mention a team
    // or a shift type at all yet, so any occurrence is out of turn.
    for (const message of messages()) {
      expect(message.toLowerCase(), `${message} mentions a shift or team`).not.toContain('smjen');
    }
  });

  it('uses an en dash rather than a hyphen for any range', () => {
    // UX-DR34: `19:00–07:00` with U+2013, never a hyphen. No message carries a
    // range today; this is what keeps the first one that does honest.
    for (const message of messages()) {
      expect(message, `${message} appears to use a hyphen as a range separator`).not.toMatch(
        /\d\s*-\s*\d/,
      );
    }
  });

  it('carries no navigation or terminology vocabulary', () => {
    // The other half of the frozen boundary, by content rather than by key
    // count: a screen string smuggled in under a plural-looking key.
    //
    // `prijava` and `lozinka` were on this list and are gone from it: story
    // 1.1d authors the sign-in screen, so those two words are now legitimately
    // this file's. `organizacija` left the same way and for the same reason —
    // story 1.3b authors the organization prompt at bare `/prijava`, whose
    // heading IS the word, so it is now this file's too. The seven that remain
    // are the navigation shell's and the terminology contract's, and they stay
    // banned until the spec that owns them lands.
    //
    // Only the heading needed the removal. This sweep is a plain lowercase
    // substring match, and `organizacije` does not contain `organizacija`, so
    // the field label `Kratica organizacije` cleared the old list on its own —
    // which is precisely why the removal has to be deliberate rather than
    // discovered: an inflected form would have shipped the vocabulary without
    // ever reaching this review moment.
    const reserved = [
      'danas',
      'kalendar',
      'godišnji',
      'raspored',
      'ljudi',
      'postavke',
      'odjava',
    ];

    for (const message of messages()) {
      for (const word of reserved) {
        expect(message.toLowerCase(), `${message} contains the reserved word ${word}`).not.toContain(
          word,
        );
      }
    }
  });
});

describe('the detector reads the file it thinks it does', () => {
  // Guards the helpers themselves: a `leafKeys` that returned nothing would
  // make the key-set assertion pass against any file at all.
  it('flattens nested keys the way i18next resolves them', () => {
    expect(leafKeys({ a: { b: 'x', c: 'y' }, d: 'z' }).sort()).toEqual(['a.b', 'a.c', 'd']);
  });

  it('collects every message, however deeply nested', () => {
    const walked = leafKeys({ one: { two: { three: 'deep' } } });

    expect(walked).toEqual(['one.two.three']);
  });

  it('would notice an exclamation mark, a hyphen range and smjena', () => {
    // The sweeps above are only as good as their patterns; these are the
    // shapes they must catch.
    expect('Spremljeno!').toContain('!');
    expect('19:00-07:00').toMatch(/\d\s*-\s*\d/);
    expect('Tip smjene'.toLowerCase()).toContain('smjen');
  });

  it('resolves a nested key path to its message and a wrong one to nothing', () => {
    // `messageAt` is what both key-shape assertions read through. A version
    // that returned `undefined` for everything would make the ICU check pass
    // vacuously on a typo'd key name.
    expect(String(messageAt('count.days'))).toContain('plural');
    expect(typeof messageAt('auth.heading')).toBe('string');
    expect(messageAt('auth.headng')).toBeUndefined();
  });
});
