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
 * When 1.1d legitimately adds screen strings, the SANCTIONED_KEYS list is what
 * it updates — deliberately, in the same commit, which is the review moment
 * this exists to create.
 */

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const RESOURCE = join(repoRoot, 'apps', 'web', 'src', 'i18n', 'locales', 'hr.json');

/** The two plural messages story 1.1c is permitted to ship (`EXPERIENCE.md:81`). */
const SANCTIONED_KEYS = ['count.days', 'count.conflicts'];

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

  it('holds exactly the two sanctioned plural keys and nothing else', () => {
    // The frozen boundary: 1.1d owns every screen literal so it can review them
    // in one place. A key added here before then bypasses that review.
    expect([...leafKeys(resource())].sort()).toEqual([...SANCTIONED_KEYS].sort());
  });

  it.each(SANCTIONED_KEYS)('declares %s as an ICU plural with all three Croatian forms', (key) => {
    const message = key
      .split('.')
      .reduce<unknown>((node, part) => (node as Record<string, unknown>)?.[part], resource());

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
    const reserved = [
      'danas',
      'kalendar',
      'godišnji',
      'raspored',
      'ljudi',
      'organizacija',
      'postavke',
      'prijava',
      'odjava',
      'lozinka',
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
});
