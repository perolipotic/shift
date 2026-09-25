import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  accentMessageKey,
  brandAccentAppearance,
  brandAccentOf,
  brandAccentValue,
  isBrandAccentKey,
  BRAND_ACCENT_KEYS,
  BRAND_ACCENT_OPTIONS,
  LOCKUP_COMPACT,
  LOCKUP_FULL,
  NO_BRAND_ACCENT,
} from '@/organization/accent';

/**
 * The curated accent set, held together across the four files it lives in
 * (story 1.4c).
 *
 * ONE ACCENT IS FOUR FACTS: a value in `0006`'s check constraint, a fill and
 * foreground pair in `index.css`, an entry in `@/organization/accent`, and a
 * Croatian label in `hr.json`. Every pairing of those can drift, and every
 * drift is silent in its own way — a key the database admits with no token
 * renders an untinted shell and reports nothing, a token nobody can choose is
 * dead CSS, and a key with no label renders `⟦organization.accentTeal⟧` on a
 * screen no test opens. So the comparison is made here, against the actual
 * files, rather than trusted to four lists that look alike.
 *
 * READ FROM THE MIGRATION AND THE STYLESHEET rather than restated. A second
 * hand-written copy of the four keys in this file would agree with itself
 * forever; what makes the assertions below mean anything is that each side is
 * PARSED out of the artifact that ships.
 */

const srcRoot = fileURLToPath(new URL('..', import.meta.url));
const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url));

const MIGRATION = join(repoRoot, 'supabase', 'migrations', '0006_organization_accent.sql');
const STYLESHEET = join(srcRoot, 'index.css');
const RESOURCE = join(srcRoot, 'i18n', 'locales', 'hr.json');

/** Comment-blind, the two-pass idiom `test/theme-css.ts` uses: this migration
 *  explains the curated set in prose and names every key while doing so. */
function migrationStatements(): string {
  return readFileSync(MIGRATION, 'utf8')
    .split('\n')
    .filter((line) => !line.trimStart().startsWith('--'))
    .join('\n');
}

/** The keys `0006`'s check constraint admits, parsed out of the statement. */
function constrainedKeys(): string[] {
  const list = /check\s*\(\s*brand_accent\s+in\s*\(([^)]*)\)/i.exec(migrationStatements())?.[1];

  return [...(list ?? '').matchAll(/'([^']*)'/g)].map((found) => found[1] ?? '');
}

function stylesheet(): string {
  return readFileSync(STYLESHEET, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
}

function resourceKeys(): string[] {
  const walk = (node: unknown, prefix: string): string[] => {
    if (typeof node !== 'object' || node === null) return [prefix];

    return Object.entries(node).flatMap(([key, value]) =>
      walk(value, prefix === '' ? key : `${prefix}.${key}`),
    );
  };

  return walk(JSON.parse(readFileSync(RESOURCE, 'utf8')), '');
}

/** Every class name any accent — or the neutral default — can paint with. */
function everyClass(): string[] {
  return [null, ...BRAND_ACCENT_KEYS, 'teal']
    .map((accent) => brandAccentAppearance(accent))
    .flatMap((appearance) => [appearance.mark, appearance.frame, appearance.edge])
    .flatMap((classes) => classes.split(' '))
    .filter((name) => name !== '');
}

describe('the curated set is one set, not four that resemble each other', () => {
  it('is read from files that actually exist, so every comparison below means something', () => {
    // Vacuous-pass guard. A moved migration or a renamed constraint would make
    // the set comparisons hold against an empty list.
    expect(BRAND_ACCENT_KEYS.length).toBeGreaterThan(0);
    expect(constrainedKeys().length, 'no check constraint parsed out of 0006').toBeGreaterThan(0);
    expect(stylesheet().length).toBeGreaterThan(1000);
  });

  it('agrees with the check constraint in 0006, in both directions', () => {
    // THE FAILURE THIS CLOSES, in both directions. A key in the constraint and
    // not here is an accent an admin can write by API and no build can render;
    // a key here and not in the constraint is an option the control offers and
    // the database refuses with 23514 the moment somebody picks it.
    expect([...BRAND_ACCENT_KEYS].sort()).toEqual([...constrainedKeys()].sort());
  });

  it('has a measured token pair for every key, in both themes', () => {
    // Read off the stylesheet rather than off a list, so an accent added to the
    // constraint and to this module without tokens fails HERE — where the
    // person adding it is looking — rather than as an untinted shell nobody
    // reports. The VALUES are measured in `test/theme-contrast.test.ts`; what
    // is asserted here is that the declarations exist at all, once per theme.
    const css = stylesheet();

    for (const key of BRAND_ACCENT_KEYS) {
      for (const token of [`brand-${key}`, `brand-${key}-foreground`]) {
        expect(
          [...css.matchAll(new RegExp(`(?<![\\w-])--${token}:`, 'g'))],
          `--${token} is not declared exactly once per theme`,
        ).toHaveLength(2);
        // THE MAPPING FOR *THIS* TOKEN, not for the fill twice. Both loop
        // iterations asserted the fill's `@theme inline` line while the message
        // interpolated the token being checked — so a missing
        // `--color-brand-X-foreground` shipped green, `text-brand-X-foreground`
        // painted nothing, and the one pair `theme-contrast.test.ts` measures
        // was the pair that did not reach a utility.
        expect(css, `--${token} reaches no Tailwind utility`).toContain(
          `--color-${token}: var(--${token});`,
        );
      }
    }
  });

  it('has a Croatian label for every key and for no accent', () => {
    const declared = resourceKeys();

    for (const accent of BRAND_ACCENT_OPTIONS) {
      expect(declared, `${String(accent)} has no label`).toContain(accentMessageKey(accent));
    }
  });

  it('declares the labels in the order the control offers them', () => {
    // GROUPING, AS A PROPERTY RATHER THAN A HABIT. `hr.json` has no comments, so
    // the only structure it can carry is order — and six accent keys dropped
    // between the field labels and the actions is six keys a reader has to
    // reconstruct the grouping of. Asserted rather than tidied once: the option
    // names sit together, after the control's own label, in exactly the order
    // `BRAND_ACCENT_OPTIONS` renders them, so the file reads the way the screen
    // does and a seventh key cannot land in the middle of them.
    const declared = resourceKeys();
    const positions = BRAND_ACCENT_OPTIONS.map((option) =>
      declared.indexOf(accentMessageKey(option)),
    );

    expect(positions, 'an accent label is missing from hr.json').not.toContain(-1);
    expect(positions, 'the accent labels are not declared in the order they are offered').toEqual(
      [...positions].sort((one, other) => one - other),
    );
    expect(
      (positions[positions.length - 1] ?? 0) - (positions[0] ?? 0),
      'the accent labels are not contiguous in hr.json',
    ).toBe(positions.length - 1);
    expect(
      declared.indexOf('organization.accent'),
      'the accent control’s own label does not precede its options',
    ).toBe((positions[0] ?? 0) - 1);
  });

  it('offers exactly the curated set plus no accent, in that order', () => {
    // The control's options are the database's set plus one, and the one is
    // FIRST because it is the state every organization starts in. A fifth
    // option that was not an accent — "custom", say — would arrive here.
    expect(BRAND_ACCENT_OPTIONS).toEqual([null, ...BRAND_ACCENT_KEYS]);
  });

  it('excludes red, permanently and by construction', () => {
    // UX-DR4 reserves `destructive` exclusively for an unresolved conflict, and
    // the epic names the case: the pilot is a fire department whose obvious
    // accent is red. There is no key to choose and no token to render, so the
    // exclusion is not a rule anybody has to apply. `test/theme-contrast.test.ts`
    // measures the separation of the four that do exist.
    expect(BRAND_ACCENT_KEYS as readonly string[]).not.toContain('red');
    expect(constrainedKeys()).not.toContain('red');
    expect(stylesheet(), 'a red accent token exists for a key nobody can choose').not.toContain(
      '--brand-red',
    );
  });
});

describe('the accent classes exist in exactly one place, and it is this module', () => {
  /**
   * TAILWIND'S SCANNER READS COMMENTS, and that is a real hazard rather than a
   * curiosity. It builds the stylesheet by extracting candidate class names
   * from source TEXT, so a whole class name written in prose anywhere under
   * `apps/web/src` emits that rule into the built sheet whether or not anything
   * renders it.
   *
   * Found by mutation: replacing this module's hand-written table with
   * `` `bg-brand-${key}` `` — the obvious simplification, and the exact mistake
   * this module's own header warns against — left two of the accent's own
   * rules in the built sheet anyway, because two COMMENTS elsewhere happened to
   * spell those class names out in prose. `test/theme-applied.test.ts`'s loopback guard
   * passed on evidence the prose had manufactured.
   *
   * So the rule is that a whole accent class name appears in exactly one file.
   * Prose refers to them as `bg-brand-<key>` or through an interpolation, both
   * of which the scanner correctly ignores.
   */
  const ACCENT_CLASS = /(?:bg|text|border)-brand-(?:blue|green|amber|violet)/;

  /** Every file Tailwind scans, which is every file under `src`. */
  function scanned(directory: string): string[] {
    return readdirSync(directory).flatMap((entry) => {
      const path = join(directory, entry);

      return statSync(path).isDirectory() ? scanned(path) : [path];
    });
  }

  it('is the only file under src that spells an accent class out', () => {
    const offenders = scanned(srcRoot)
      .filter((path) => !path.endsWith(`${'accent'}.ts`))
      .filter((path) => ACCENT_CLASS.test(readFileSync(path, 'utf8')));

    // NON-VACUITY: the sweep must find the module it exempts, or the exemption
    // is the whole of what it is measuring.
    expect(ACCENT_CLASS.test(readFileSync(join(srcRoot, 'organization', 'accent.ts'), 'utf8'))).toBe(
      true,
    );
    expect(
      offenders,
      'a whole accent class name is written outside the module that owns it — Tailwind will emit it from the text alone, and the build-time loopback guard will pass on it',
    ).toEqual([]);
  });
});

describe('the tint reaches the lockup and the shell chrome, and nothing else', () => {
  it('names only brand accent tokens and the neutral defaults', () => {
    // THE SCOPE OF UX-DR5, asserted rather than described. Every class any
    // accent can paint with is either a `brand-*` utility this story authored
    // or one of the three neutral tokens the untinted shell already used, so
    // there is nowhere for a fourth to hide.
    const allowed = new Set([
      'bg-muted',
      // The neutral mark's own letter colour (visual refresh A): the navy
      // sidebar no longer lends it a legible one by inheritance.
      'text-foreground',
      'border-input',
      'border-border',
      ...BRAND_ACCENT_KEYS.flatMap((key) => [
        `bg-brand-${key}`,
        `text-brand-${key}-foreground`,
        `border-brand-${key}`,
      ]),
    ]);

    const found = everyClass();

    expect(found.length, 'no classes to sweep at all').toBeGreaterThan(0);
    expect(
      found.filter((name) => !allowed.has(name)),
      'an accent paints with a class outside the lockup-and-chrome scope',
    ).toEqual([]);
  });

  it('names no reserved or ramp token anywhere', () => {
    // The same claim from the other side, and not redundant: the allowlist
    // above would have to be edited to admit `bg-destructive`, and this fails
    // even if somebody edits it. `destructive` is the one that matters —
    // UX-DR4 reserves it for an unresolved conflict — and the ramp and the
    // modifiers are the fills the acceptance criterion says stay byte-identical
    // whichever accent an organization chose.
    for (const name of everyClass()) {
      for (const forbidden of ['destructive', 'primary', 'shift-', 'modifier-']) {
        expect(name, `an accent class names ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it('paints the lockup and the shell with one value, and diverges only when untinted', () => {
    // THE SEAM, asserted rather than left to be noticed. `frame` and `edge` are
    // byte-identical for every accent — there is one tint, not two — and they
    // diverge ONLY in the neutral case, where the lockup's untinted boundary is
    // `border-input` and the shell's is `border-border`. Those are the classes
    // each element already carried, and UX-DR5's "no accent renders the
    // untinted shell it has today" is a claim about bytes: collapsing the two
    // fields would have to pick one neutral and change the other, and `--input`
    // measures 3.35:1 against the page where `--border` measures 1.18:1.
    for (const key of BRAND_ACCENT_KEYS) {
      const appearance = brandAccentAppearance(key);

      expect(appearance.frame, `${key} tints the lockup and the shell differently`).toBe(
        appearance.edge,
      );
    }

    const neutral = brandAccentAppearance(null);

    expect(
      neutral.frame,
      'the untinted lockup and the untinted shell collapsed onto one neutral',
    ).not.toBe(neutral.edge);
  });

  it('carries a type scale with each lockup size, so a wide mark cannot clip', () => {
    // The mark is the first CODE POINT of an admin-entered name, and Croatian
    // diacritic coverage is an explicit requirement of this project — `Đ` and
    // `Ž` are wider than `A`. One type scale fixed for both boxes overflows the
    // 32 px one, so the scale travels with the box rather than being written
    // into the component beside it.
    for (const scale of [LOCKUP_FULL, LOCKUP_COMPACT]) {
      expect(scale.box, 'a lockup size declares no box').not.toBe('');
      expect(scale.type, 'a lockup size declares no type scale').not.toBe('');
      expect(scale.type, 'the mark can grow taller than its own box').toContain('leading-none');
    }
    expect(LOCKUP_FULL.box, 'the two lockup sizes are the same size').not.toBe(LOCKUP_COMPACT.box);
    expect(
      LOCKUP_FULL.type,
      'the smaller lockup draws its mark at the larger one’s type scale',
    ).not.toBe(LOCKUP_COMPACT.type);
  });

  it('gives a chosen accent a different appearance from no accent at all', () => {
    // NON-VACUITY for the two sweeps above, and a claim in its own right: an
    // `APPEARANCES` table that had quietly become the neutral one everywhere
    // would satisfy every allowlist here while shipping an application no
    // accent can tint.
    const neutral = brandAccentAppearance(null);

    for (const key of BRAND_ACCENT_KEYS) {
      expect(brandAccentAppearance(key), `${key} paints the untinted shell`).not.toEqual(neutral);
    }
  });
});

describe('an accent this build cannot render degrades rather than throwing', () => {
  /**
   * The case that is not hypothetical. `0006`'s constraint makes an
   * unrenderable key unrepresentable in the database TODAY, but a forward-only
   * migration stream and a static SPA on a CDN are not promoted at the same
   * instant — so a row written by a build that knows a fifth accent, read by
   * one that does not, is an ordinary state during a deploy. A thrown render
   * there would be a blank application for everybody in that organization; the
   * untinted shell is a thing to look at.
   */
  it('resolves an unknown key to the neutral default', () => {
    expect(brandAccentAppearance('teal')).toEqual(brandAccentAppearance(null));
    expect(brandAccentAppearance('')).toEqual(brandAccentAppearance(null));
    expect(brandAccentAppearance('BLUE')).toEqual(brandAccentAppearance(null));
  });

  it('names an unknown key as no accent rather than as a missing key', () => {
    // The two fail-to-neutral paths must agree. A version of `accentMessageKey`
    // that returned the unknown value itself would render `⟦teal⟧` beside a
    // perfectly untinted shell — a visible defect for a row that is merely from
    // the future.
    expect(accentMessageKey('teal')).toBe(accentMessageKey(null));
    expect(accentMessageKey('BLUE')).toBe(accentMessageKey(null));
  });

  it('maps every known key to its own label and never to another accent’s', () => {
    // MUTATION-PROVEN SHAPE. Two swapped branches in `accentMessageKey` leave
    // an organization that chose green reading `Plava`, with every source-level
    // assertion in the repository green — which is exactly why the mapping is a
    // function in a `.ts` module rather than a lookup written in the screen.
    const rendered = BRAND_ACCENT_KEYS.map((key) => accentMessageKey(key));

    expect(new Set(rendered).size, 'two accents share a label').toBe(BRAND_ACCENT_KEYS.length);
    expect(rendered, 'an accent renders as the no-accent label').not.toContain(
      accentMessageKey(null),
    );
    for (const key of BRAND_ACCENT_KEYS) {
      expect(
        accentMessageKey(key).toLowerCase(),
        `${key} does not render as its own label`,
      ).toContain(key);
    }
  });

  it('recognises exactly the curated keys and nothing else', () => {
    for (const key of BRAND_ACCENT_KEYS) expect(isBrandAccentKey(key)).toBe(true);
    for (const other of ['red', 'teal', '', 'Blue', null]) {
      expect(isBrandAccentKey(other), `${String(other)} passes as an accent`).toBe(false);
    }
  });
});

describe('the control’s value and the column’s value are one crossing', () => {
  /**
   * A `<select>` speaks strings and the column speaks `text | null`, so the
   * empty string is the crossing point — and it has to round-trip, or the
   * screen writes `''` into a column whose constraint admits four words and
   * null and is refused for a reason nobody can see.
   */
  it('round-trips every option through the control’s value and back', () => {
    for (const option of BRAND_ACCENT_OPTIONS) {
      expect(brandAccentOf(brandAccentValue(option)), `${String(option)} did not round-trip`).toBe(
        option,
      );
    }
  });

  it('carries no accent as the empty string and never as a fifth key', () => {
    // `null` is the column's own value for "no accent" and there is deliberately
    // no `'none'` key: the absence of an accent is not a fifth accent, and a
    // key spelled that way would need a token, a constraint value and a
    // contrast pair it can never have.
    expect(brandAccentValue(null)).toBe(NO_BRAND_ACCENT);
    expect(brandAccentOf(NO_BRAND_ACCENT)).toBeNull();
    expect(constrainedKeys(), 'the constraint admits a key for the absence').not.toContain('none');
  });

  it('reads an unknown stored value back as no accent', () => {
    // The write side of the same fail-to-neutral the appearance takes: a row
    // from a newer build renders untinted and, if the admin then saves, writes
    // a value this build can name rather than one it merely echoed.
    expect(brandAccentOf('teal')).toBeNull();
    expect(brandAccentOf(null)).toBeNull();
  });
});
