import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { TODAY_SCREEN_PARTS } from '@/features/today/today-screen.fixture';

import {
  ariaCurrentValues,
  ariaHaspopupValues,
  CHROME,
  jsxTextWithContent,
  MEMBER_LIST,
  occurrences,
  SCREENS,
  SHARED_FILTER_BAR,
  SHARED_MONTH_NAV,
  source,
  srcRoot,
  unsanctionedLiterals,
} from './source-guards.fixture';
import { KEY_SOURCES } from './key-sources.fixture';

// The literal sweep: every user-facing string on a screen goes through a key, the
// structural attributes it exempts keep their promise, and no screen uses a reserved signal.

/** SINCE STORY 6.3: *Treba tebe*, the one Danas part sanctioned to draw `destructive`. */
const NEEDS_YOU_CARD = join(srcRoot, ...TODAY_SCREEN_PARTS.needsYouCard);

/**
 * Every LITERAL value an `aria-invalid` attribute is given, on any screen.
 *
 * The twin of `ariaSortValues` below, and it exists for the identical reason:
 * `aria-invalid` is on `STRUCTURAL_ATTRIBUTES`, which exempts it from the
 * literal sweep everywhere, and the argument that earned the exemption is only
 * true while it is enforced.
 *
 * Only the QUOTED form is collected. Both member forms write the expression
 * form — `aria-invalid={invalidField === 'member-leave'}` — whose value is a
 * boolean and whose inner literal is an element id, not a word anybody reads;
 * a sweep over the expression form would report that id as user-facing text.
 * What must never appear is a quoted value outside the ARIA vocabulary.
 */
function ariaInvalidValues(text: string): string[] {
  return [...text.matchAll(/aria-invalid="([^"]*)"/g)].map((found) => found[1] ?? '');
}

/**
 * Every value an `aria-sort` attribute can take, in either syntax.
 *
 * The twin of `ariaCurrentValues` above, and it exists for the identical
 * reason: `aria-sort` is on `STRUCTURAL_ATTRIBUTES`, which EXEMPTS it from the
 * literal sweep on every screen in the application, and the argument that earned
 * the exemption was that its vocabulary is closed and non-textual. That argument
 * is only true while it is enforced — `aria-sort="Ime"` is a user-facing literal
 * sitting in the one attribute nothing else now looks at. This is what looks at
 * it, and it looks on every screen rather than on the one that introduced it.
 */
function ariaSortValues(text: string): string[] {
  return [...text.matchAll(/aria-sort=(?:"([^"]*)"|\{([^}]*)\})/g)].flatMap((found) => {
    const literal = found[1];

    if (literal !== undefined) return [literal];

    return [...(found[2] ?? '').matchAll(/'([^']*)'/g)].map((quoted) => quoted[1] ?? '');
  });
}

describe('every user-facing string on the screen resolves through a key', () => {
  it.each(SCREENS)('leaves no bare JSX text in $name', ({ file }) => {
    expect(jsxTextWithContent(source(file))).toEqual([]);
  });

  it.each(SCREENS)('leaves no string or template literal off a structural attribute in $name', ({ file }) => {
    expect(unsanctionedLiterals(source(file))).toEqual([]);
  });

  it.each(KEY_SOURCES)('renders $strings strings on $name', ({ file, keys, strings }) => {
    // A count per source, so a string that stopped being rendered fails rather
    // than quietly disappearing from the screen. TWO on the mapping and no
    // more: a third message would mean a third code, and the three upstream
    // refusals share one on purpose.
    expect(keys(source(file))).toHaveLength(strings);
  });
});

/** The closed set `aria-current` admits (WAI-ARIA 1.2). Nothing else is a
 *  state; everything else is text, and text is what the allowlist exempted this
 *  attribute on the promise of never carrying. */
const ARIA_CURRENT_VOCABULARY = new Set(['page', 'step', 'location', 'date', 'time', 'true', 'false']);

describe('the exempted attribute keeps the promise that exempted it', () => {
  /**
   * `aria-current` went onto the GLOBAL `STRUCTURAL_ATTRIBUTES` allowlist, which
   * excuses it from the literal sweep on EVERY screen in the application — and
   * the argument that earned the exemption was that its vocabulary is closed and
   * non-textual. An argument is not an enforcement: `aria-current="Danas"` is a
   * user-facing Croatian literal sitting in the one attribute nothing else now
   * looks at, and it would render to a screen reader as the element's current
   * state. This is the enforcement.
   */
  it('admits only ARIA state values wherever aria-current appears', () => {
    const found = SCREENS.flatMap(({ file }) => ariaCurrentValues(source(file)));

    // NON-VACUITY. With no `aria-current` anywhere the loop asserts nothing while
    // reading as coverage — which is the state every screen but the chrome is in,
    // so the count has to come from the sweep rather than be assumed.
    expect(found.length, 'no aria-current anywhere, so this sweep proves nothing').toBeGreaterThan(
      0,
    );
    for (const value of found) {
      expect(
        ARIA_CURRENT_VOCABULARY.has(value),
        `aria-current="${value}" is not an ARIA state — it is text in an attribute the allowlist exempted`,
      ).toBe(true);
    }
  });

  /**
   * `aria-sort` joined the same global allowlist in story 1.5a, on the same
   * argument, and it is held to the same enforcement — GLOBALLY, over every
   * swept screen, rather than over the one screen that introduced it. That
   * scoping is the finding: the allowlist applies to all fourteen, so a
   * justification drawn from one of them buys an exemption on the other
   * thirteen, and `aria-sort="Ime"` on any of them would be a Croatian literal
   * in an attribute nothing else looks at.
   */
  const ARIA_SORT_VOCABULARY = new Set(['ascending', 'descending', 'other', 'none']);

  it.each(SCREENS)('admits only ARIA validity states wherever aria-invalid is quoted in $name', ({ file }) => {
    // What pays for `aria-invalid`'s place on the global allowlist. The member
    // forms write it as an expression, so this finds nothing on them today —
    // which is exactly the state `aria-current` and `aria-sort` are in on
    // fifteen of the sixteen screens, and the sweep is about the attribute
    // rather than about the screen that introduced it.
    for (const value of ariaInvalidValues(source(file))) {
      expect(['true', 'false', 'grammar', 'spelling'], `aria-invalid="${value}"`).toContain(value);
    }
  });

  it.each(SCREENS)('admits only ARIA popup kinds wherever aria-haspopup is quoted in $name', ({ file }) => {
    // What pays for `aria-haspopup`'s place on the global allowlist (story 7.3).
    for (const value of ariaHaspopupValues(source(file))) {
      expect(['true', 'false', 'menu', 'listbox', 'tree', 'grid', 'dialog'], `aria-haspopup="${value}"`).toContain(
        value,
      );
    }
  });

  it('reads aria-haspopup in the quoted syntax, and the chrome carries one', () => {
    // BOTH POLARITIES, and non-vacuity on the one screen that uses it.
    expect(ariaHaspopupValues('<Button aria-haspopup="dialog" />')).toEqual(['dialog']);
    expect(ariaHaspopupValues('<Button aria-haspopup="Više" />')).toEqual(['Više']);
    expect(ariaHaspopupValues('<Button aria-expanded={open} />')).toEqual([]);
    expect(ariaHaspopupValues(source(CHROME))).toEqual(['dialog']);
    // Story 7.4: the month toolbar's trigger, on both Kalendar and Sati.
    expect(ariaHaspopupValues(source(SHARED_MONTH_NAV))).toEqual(['dialog']);
    // Story 7.5: `Filtri`, which opens the sheet, and a chip, which opens its picker.
    expect(ariaHaspopupValues(source(SHARED_FILTER_BAR))).toEqual(['dialog', 'dialog']);
  });

  it('reads aria-invalid in the quoted syntax, and finds none where there is none', () => {
    // BOTH POLARITIES. A reader that matched nothing would make the sweep above
    // pass on a screen carrying a Croatian sentence in that attribute.
    expect(ariaInvalidValues('<input aria-invalid="true" />')).toEqual(['true']);
    expect(ariaInvalidValues('<input aria-invalid="Dani godišnjeg odmora" />')).toEqual([
      'Dani godišnjeg odmora',
    ]);
    expect(ariaInvalidValues('<input aria-invalid={flag} />')).toEqual([]);
    expect(ariaInvalidValues('<input />')).toEqual([]);
  });

  it('admits only ARIA sort states wherever aria-sort is written as a literal', () => {
    const found = SCREENS.flatMap(({ file }) => ariaSortValues(source(file)));

    for (const value of found) {
      expect(
        ARIA_SORT_VOCABULARY.has(value),
        `aria-sort="${value}" is not an ARIA sort state — it is text in an attribute the allowlist exempted`,
      ).toBe(true);
    }
    // NO NON-VACUITY GUARD ON `found`, deliberately, and the case below is why:
    // the one screen that uses the attribute COMPUTES its value rather than
    // writing one, so an empty result here is the correct state of the world
    // rather than a sweep that has gone quiet. The reader's own reach is proved
    // on synthetic sources below, and what the computed value can be is pinned
    // by the case that follows.
    expect(found, 'a screen writes an aria-sort literal — see the case below').toEqual([]);
  });

  it('computes every aria-sort value through the function pinned to that vocabulary', () => {
    // WHERE THE ENFORCEMENT ACTUALLY LIVES for the one screen that uses it.
    // `aria-sort={sortStateOf(sort, column.key)}` cannot carry a Croatian word,
    // because `sortStateOf` returns one of three ARIA states and
    // `features/members/services/list.test.ts` pins it against those three literally. A screen
    // that started computing the attribute some other way would escape both this
    // and the literal sweep above, so the route is pinned rather than assumed.
    const uses = [...source(MEMBER_LIST).matchAll(/aria-sort=\{([^}]*)\}/g)].map(
      (found) => found[1] ?? '',
    );

    expect(uses.length, 'the member list no longer reports a sort state at all').toBe(1);
    for (const use of uses) {
      expect(use, 'aria-sort is computed by something other than sortStateOf').toContain(
        'sortStateOf(',
      );
    }
  });

  it('reads aria-sort in both syntaxes, and finds none where there is none', () => {
    // Detector self-test, both polarities: a reader that returned nothing would
    // make the sweep above pass on a screen carrying a literal in it.
    expect(ariaSortValues('<th aria-sort="ascending">')).toEqual(['ascending']);
    expect(ariaSortValues("<th aria-sort={sorted ? 'descending' : 'none'}>")).toEqual([
      'descending',
      'none',
    ]);
    expect(ariaSortValues('<th className="x">')).toEqual([]);
  });
});

describe('the screen uses no reserved signal', () => {
  /** SINCE STORY 6.3: *Treba tebe*'s edge, drawn only while unresolved conflicts wait. */
  const NEEDS_YOU_EDGE = "waiting && 'border-l-4 border-l-destructive'";

  it.each(SCREENS)('names no destructive utility in $name', ({ name, file }) => {
    // UX-DR4: `destructive` is reserved exclusively for an unresolved conflict.
    // Comment-blind, so the screen's own explanation of the rule does not trip
    // it — which is what makes the assertion about the markup.
    // SINCE STORY 6.3: on Danas, *Treba tebe*'s left edge is exactly that —
    // drawn only while the count of unresolved conflicts is above zero — and
    // is taken out here, once, and pinned by the case below.
    const screen = name === 'the Danas destination' ? source(file).replace(NEEDS_YOU_EDGE, '') : source(file);

    expect(screen).not.toContain('destructive');
  });

  it("draws destructive on Danas only as Treba tebe's edge, and only while conflicts wait", () => {
    const card = source(NEEDS_YOU_CARD);

    expect(occurrences(card, 'destructive')).toBe(1);
    expect(card).toContain(NEEDS_YOU_EDGE);
    expect(card).toContain('const waiting = needsYou.count !== 0;');
  });
});
