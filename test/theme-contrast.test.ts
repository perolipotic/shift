import { differenceCiede2000, rgb, wcagContrast, type Color, type Rgb } from 'culori';
import { describe, expect, it } from 'vitest';

import { rawToken, readToken, type Theme } from './theme-css.js';

/**
 * Contrast, measured rather than promised (story 1.1b, UX-DR3).
 *
 * DESIGN.md marks ramp slots 3-6 `[ASSUMPTION]` — unexercised by the pilot and
 * never contrast-checked — and converting from hex to OKLCH is exactly where a
 * value drifts unnoticed. So every pair is computed here, in both themes.
 *
 * Both halves of the layer are covered. The first derivation measured only the
 * brand pairs; the 28 shadcn base tokens went unmeasured, and two of them ship
 * below the thresholds this file enforces elsewhere.
 *
 * A failure is a design question, not a value to nudge: the spec gates that on
 * a human.
 */

const AA_BODY = 4.5;
const AA_LARGE = 3;
const THEMES = ['light', 'dark'] as const;

/** Brand fills whose foreground is a shift-cell label — small text, so the
 *  body threshold applies. */
const BRAND_PAIRS = [
  'primary',
  'destructive',
  'shift-slot-1',
  'shift-slot-2',
  'shift-slot-3',
  'shift-slot-4',
  'shift-slot-5',
  'shift-slot-6',
  'shift-nonworking',
] as const;

/** shadcn base surfaces that carry text. */
const BASE_PAIRS = ['card', 'popover', 'secondary', 'muted', 'accent', 'sidebar'] as const;

/** Every fill a shift cell can actually have. */
const FILLS = [
  'shift-slot-1',
  'shift-slot-2',
  'shift-slot-3',
  'shift-slot-4',
  'shift-slot-5',
  'shift-slot-6',
  'shift-nonworking',
] as const;

/**
 * `shift-slot-2` is excluded from the alpha-overlay sweep, deliberately.
 *
 * It is the one inverted slot: in the LIGHT theme its fill is a dark navy, so a
 * fixed dark modifier foreground lands dark-on-dark (1.84:1 and 1.78:1). No
 * token value fixes that — the resolution is that `shift-cell` draws its hatch
 * and glyph in the underlying slot's own foreground (9.49:1 for leave, 8.30:1
 * for uncovered). That is a composition rule for a component built in Epic 3,
 * recorded in deferred-work.md rather than asserted here against code that does
 * not exist. `modifier-overridden` is opaque, so the exclusion does not apply
 * to it.
 */
const OVERLAY_FILLS = FILLS.filter((name) => name !== 'shift-slot-2');
const OVERLAYS = ['modifier-leave', 'modifier-uncovered'] as const;

/**
 * The exclusion above is exactly as wide as the finding behind it.
 *
 * It is argued from one measurement: a fixed dark modifier foreground over
 * slot-2's inverted LIGHT fill. That covers the light-theme glyph cases and
 * nothing else. Slot-2 is not inverted in dark (glyph measures 6.43 and 6.04),
 * and the hatch metric does not involve the foreground at all (ΔE 7.50-15.52).
 * Applying it to all four sweeps dropped six passing cases of live coverage.
 */
const GLYPH_FILLS = (theme: Theme): readonly string[] =>
  theme === 'light' ? OVERLAY_FILLS : FILLS;

function colour(theme: Theme, name: string): Color {
  const found = readToken(theme, name);
  expect(found, `--${name} is missing or unparseable in ${theme}`).not.toBeNull();

  return found as Color;
}

/** Source-over compositing, so an alpha overlay is measured against the fill it
 *  actually sits on rather than against nothing. */
function composite(over: Color, under: Color): Rgb {
  const top = rgb(over);
  const bottom = rgb(under);
  const alpha = top.alpha ?? 1;
  const mix = (a: number, b: number): number => a * alpha + b * (1 - alpha);

  return { mode: 'rgb', r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b) };
}

function ratio(foreground: Color, background: Color): number {
  return wcagContrast(foreground, background);
}

describe('brand text pairs clear WCAG 2.1 AA', () => {
  const cases = THEMES.flatMap((theme) => BRAND_PAIRS.map((name) => ({ theme, name })));

  it.each(cases)('$name reads on its own fill in $theme', ({ theme, name }) => {
    const measured = ratio(colour(theme, `${name}-foreground`), colour(theme, name));

    expect(
      measured,
      `${name}-foreground on ${name} (${theme}) measured ${measured.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(AA_BODY);
  });
});

describe('shadcn base text pairs clear WCAG 2.1 AA', () => {
  // The half every primitive resolves first. Untested in the first derivation.
  const cases = THEMES.flatMap((theme) => BASE_PAIRS.map((name) => ({ theme, name })));

  it.each(cases)('$name-foreground reads on $name in $theme', ({ theme, name }) => {
    const measured = ratio(colour(theme, `${name}-foreground`), colour(theme, name));

    expect(
      measured,
      `${name}-foreground on ${name} (${theme}) measured ${measured.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(AA_BODY);
  });

  it.each(THEMES)('body text reads on the page background in %s', (theme) => {
    const measured = ratio(colour(theme, 'foreground'), colour(theme, 'background'));

    expect(measured, `foreground on background (${theme}) measured ${measured.toFixed(2)}:1`).toBeGreaterThanOrEqual(
      AA_BODY,
    );
  });
});

describe('every focus indicator is perceivable', () => {
  // A focus ring is the archetypal non-text UI component the 3:1 bar exists for.
  // Enumerated as pairs so a new ring token has to join the list to exist:
  // `sidebar-ring` originally shipped the identical stock value that was
  // rejected for `ring`, in the same block, measured by nothing.
  const RINGS = [
    { ring: 'ring', surface: 'background' },
    { ring: 'sidebar-ring', surface: 'sidebar' },
  ];
  const cases = THEMES.flatMap((theme) => RINGS.map((pair) => ({ theme, ...pair })));

  it.each(cases)('--$ring is distinguishable from --$surface in $theme', ({ theme, ring, surface }) => {
    const measured = ratio(colour(theme, ring), colour(theme, surface));

    expect(
      measured,
      `${ring} on ${surface} (${theme}) measured ${measured.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(AA_LARGE);
  });

  /**
   * The ring against the BORDER it abuts, not only against the page.
   *
   * Found in review, and it is the shape of defect a per-token threshold
   * cannot see: raising `--input` to clear WCAG 1.4.11 (3.23:1 on the page)
   * put it at L 0.65 next to a ring at L 0.665, which measures **1.06:1**
   * between them. Both tokens passed their own assertion; the focus indicator
   * had become invisible against the one control it indicates. `ring-1` draws
   * immediately outside the input's own 1px border, so the two are adjacent by
   * construction and 1.4.11's "adjacent colours" clause applies between them.
   *
   * `--input` is composited first: dark declares it with alpha, and the raw
   * value is a near-white that flatters the measurement.
   */
  it.each(THEMES)('--ring is distinguishable from the --input border it abuts in %s', (theme) => {
    const surface = colour(theme, 'background');
    const border = composite(colour(theme, 'input'), surface);
    const measured = ratio(colour(theme, 'ring'), border);

    expect(
      measured,
      `ring against the composited input border (${theme}) measured ${measured.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(AA_LARGE);
  });
});

describe('the shadcn-sourced deviations stay shifted, not reverted to stock', () => {
  /**
   * Each failed a threshold at its stock shadcn lightness and was moved to
   * clear it — see the spec change log. The blocks above already fail if any
   * of them revert, but only with a bare ratio; this names the regression the
   * way `theme-fidelity.test.ts`'s `APPROVED` map does for DESIGN.md-sourced
   * deviations (none of these has a DESIGN.md entry, so that map cannot cover
   * them).
   *
   *   muted-foreground  4.34:1 on --muted
   *   ring              2.59:1 on --background at stock, then 1.06:1 against
   *                     the raised --input at 1.1b's own 0.665 — two separate
   *                     defects, and the second is why the value moved twice
   *   sidebar-ring      2.48:1 on --sidebar
   *   input             1.26:1 on --background, where WCAG 1.4.11 wants 3:1
   *                     because the border is the control's whole affordance
   *
   * Light-theme L only, deliberately: dark `--input` is an alpha token rather
   * than a lightness, so there is no stock L to compare against. Its dark
   * value is held by the ratio assertions instead, in both themes.
   */
  const DEVIATIONS: Record<string, { shifted: number; stock: number }> = {
    'muted-foreground': { shifted: 0.542, stock: 0.556 },
    ring: { shifted: 0.37, stock: 0.708 },
    'sidebar-ring': { shifted: 0.654, stock: 0.708 },
    input: { shifted: 0.65, stock: 0.922 },
  };

  it.each(Object.keys(DEVIATIONS))('--%s (light) is still lightness-shifted off its stock shadcn value', (name) => {
    const token = colour('light', name);
    const { shifted, stock } = DEVIATIONS[name] as { shifted: number; stock: number };
    const l = 'l' in token ? token.l : Number.NaN;

    expect(l, `--${name} is not an OKLCH colour`).toBeCloseTo(shifted, 3);
    expect(
      l,
      `--${name} (light) reverted to the stock shadcn value ${stock} — see the spec change log`,
    ).not.toBeCloseTo(stock, 3);
  });
});

/**
 * `--border` and `--input` shipped as one stock shadcn value and are now two
 * different requirements, which is why this is two blocks (story 1.1d).
 *
 * Both composited, never raw: dark declares them with alpha, and a raw reading
 * of dark `--border` reports a meaningless 19.79:1 against a surface it is in
 * fact barely visible on.
 */
describe('the input boundary clears the UI-component threshold', () => {
  // WCAG 1.4.11 requires 3:1 where a boundary is a component's SOLE visual
  // affordance, which is exactly a shadcn text input: its fill is the page
  // colour, so the border is the whole control. The sign-in form is the first
  // surface where that is true, so the requirement replaces the pin that stood
  // while the question was open (deferred-work.md, story 1.1b review).
  //
  // Pinned AS WELL AS floored, the same reasoning `--border` carries below: a
  // bare `>= 3` passes for anything in [3, ∞), so an edit landing at 3.02:1 —
  // or at 8:1, which would be a heavy black box round every field — reads as
  // compliance. The floor is the requirement; the pin is the drift alarm.
  const EXPECTED_RATIO: Record<Theme, number> = { light: 3.23, dark: 3.26 };

  it.each(THEMES)('--input is discernible against the page in %s', (theme) => {
    const surface = colour(theme, 'background');
    const measured = ratio(composite(colour(theme, 'input'), surface), surface);

    expect(
      measured,
      `input on background (${theme}) measured ${measured.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(AA_LARGE);
  });

  it.each(THEMES)('--input has not drifted off its chosen value in %s', (theme) => {
    const surface = colour(theme, 'background');
    const measured = ratio(composite(colour(theme, 'input'), surface), surface);
    const expected = EXPECTED_RATIO[theme];

    expect(
      measured,
      `input on background (${theme}) measured ${measured.toFixed(2)}:1, expected ~${expected}:1`,
    ).toBeCloseTo(expected, 2);
  });

  it('keeps dark --input an alpha token, so it composites over whatever it sits on', () => {
    // Scoped to DARK, and stated rather than folded into a both-themes loop:
    // light `--input` is opaque, so composited and raw are the same number and
    // the assertion would be vacuous by construction there.
    //
    // The mistake it forbids: dark `--input` is `oklch(1 0 0 / 36%)`, which
    // reads as near-white — 19.79:1 — until it is composited onto the surface
    // it actually sits on. Swapping the alpha for an opaque grey of the same
    // composited lightness would satisfy every ratio above and then be wrong
    // the moment a field sits on a card rather than the page.
    const surface = colour('dark', 'background');
    const composited = ratio(composite(colour('dark', 'input'), surface), surface);
    const raw = ratio(colour('dark', 'input'), surface);

    expect(raw, 'dark --input no longer carries alpha').toBeGreaterThan(composited);
    expect(rawToken('dark', 'input')).toContain('%');
  });
});

describe('the inherited border contrast is pinned, not merely inherited', () => {
  /**
   * `--border` composites to 1.25-1.26:1 against its surface — stock shadcn,
   * unchanged here and deliberately below AA.
   *
   * WCAG 1.4.11 wants 3:1 only where a border is a control's sole visual
   * affordance. `--border` edges cards and separators and `@layer base` hands
   * it to every element as a default border colour; none of that is a control,
   * so the criterion does not apply and raising it would visibly heavy every
   * surface in the interface for no accessibility gain. `--input`, which IS a
   * control's whole affordance, moved instead — see the block above.
   *
   * The measurement is therefore pinned rather than the requirement, so the
   * value cannot drift while it stays stock. Same pattern as the state-glyph
   * deferral in typography-coverage.test.ts.
   */
  // Pinned to the specific stock ratio, not merely `1 < x < AA_LARGE` — that
  // band would pass silently for any accidental edit landing inside 1-3:1,
  // which is exactly the drift this block exists to catch.
  const EXPECTED_RATIO: Record<string, number> = {
    light: 1.26,
    dark: 1.25,
  };

  it.each(THEMES)('--border against its surface in %s is unchanged', (theme) => {
    const surface = colour(theme, 'background');
    const measured = ratio(composite(colour(theme, 'border'), surface), surface);
    const expected = EXPECTED_RATIO[theme] as number;

    expect(measured, `border (${theme}) measured ${measured.toFixed(2)}:1, expected ~${expected}:1`).toBeCloseTo(
      expected,
      2,
    );
    expect(measured, `border (${theme}) measured ${measured.toFixed(2)}:1`).toBeLessThan(AA_LARGE);
    expect(measured).toBeGreaterThan(1);
  });

  it('is not the same value as --input any more, in either theme', () => {
    // The two tokens shipped identical in light and are now different
    // requirements. A merge that restored one from the other would leave both
    // blocks above passing in one theme and failing in the other, which is a
    // confusing way to learn this; naming it here says what happened.
    for (const theme of THEMES) {
      expect(readToken(theme, 'input')).not.toEqual(readToken(theme, 'border'));
    }
  });
});

describe('overlay glyphs clear the UI-component threshold over every fill', () => {
  // UX-DR8 makes leave and uncovered a hatch plus a glyph — `◷` and `◌` — not
  // body text. WCAG holds graphical objects needed to understand content to
  // 3:1, and UX-DR37/Q21 make the glyph the non-colour carrier of meaning.
  const cases = THEMES.flatMap((theme) =>
    OVERLAYS.flatMap((overlay) => GLYPH_FILLS(theme).map((fill) => ({ theme, overlay, fill }))),
  );

  it.each(cases)('$overlay glyph over $fill in $theme', ({ theme, overlay, fill }) => {
    const composited = composite(colour(theme, overlay), colour(theme, fill));
    const measured = ratio(colour(theme, `${overlay}-foreground`), composited);

    expect(
      measured,
      `${overlay}-foreground over ${overlay} on ${fill} (${theme}) measured ${measured.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(AA_LARGE);
  });
});

describe('the hatch itself is perceivable, not only the glyph on it', () => {
  /**
   * UX-DR8 pairs a hatch WITH a glyph, and the first derivation measured only
   * the glyph — the stripe against the fill around it went unasserted.
   *
   * Measured as perceptual difference, not contrast ratio. A 16-22% alpha tint
   * over its own base cannot reach 3:1 by construction: the arithmetic ceiling
   * across every fill here is 1.26:1, so a WCAG threshold would demand the
   * impossible rather than describe the requirement. WCAG's 3:1 governs the
   * signal that *identifies* the state, which UX-DR8 assigns to the glyph; the
   * hatch is the redundant texture beside it, and the question for a texture is
   * whether the eye can see it at all. CIEDE2000 answers that: ~2.3 is the
   * just-noticeable bound and 3 is comfortably perceptible.
   */
  const PERCEPTIBLE = 3;
  const difference = differenceCiede2000();
  const cases = THEMES.flatMap((theme) =>
    OVERLAYS.flatMap((overlay) => FILLS.map((fill) => ({ theme, overlay, fill }))),
  );

  it.each(cases)('$overlay stripe against $fill in $theme', ({ theme, overlay, fill }) => {
    const under = colour(theme, fill);
    const measured = difference(composite(colour(theme, overlay), under), under);

    expect(
      measured,
      `${overlay} stripe against ${fill} (${theme}) measured ΔE ${measured.toFixed(2)}`,
    ).toBeGreaterThanOrEqual(PERCEPTIBLE);
  });
});

describe('the override marker is perceivable on the cells it marks', () => {
  // DESIGN.md specifies modifier-overridden as a 2px inset border on a shift
  // cell, so the adjacent colour is a ramp fill — never the page background.
  // Measuring it against `background` let a value that improved the assertion
  // (5.30:1) simultaneously become invisible on slot-2 (2.85:1).
  const cases = THEMES.flatMap((theme) => FILLS.map((fill) => ({ theme, fill })));

  it.each(cases)('modifier-overridden borders $fill in $theme', ({ theme, fill }) => {
    const measured = ratio(colour(theme, 'modifier-overridden'), colour(theme, fill));

    expect(
      measured,
      `modifier-overridden on ${fill} (${theme}) measured ${measured.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(AA_LARGE);
  });
});

describe('the conflict marker is perceivable on the cells it marks', () => {
  // UX-DR4 reserves `destructive` exclusively for an unresolved conflict, drawn
  // as the same 2px inset border. It is the one signal the design says must
  // never be missed, and it had no assertion at all.
  const cases = THEMES.flatMap((theme) => FILLS.map((fill) => ({ theme, fill })));

  it.each(cases)('destructive borders $fill in $theme', ({ theme, fill }) => {
    const measured = ratio(colour(theme, 'destructive'), colour(theme, fill));

    expect(
      measured,
      `destructive on ${fill} (${theme}) measured ${measured.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(AA_LARGE);
  });
});
