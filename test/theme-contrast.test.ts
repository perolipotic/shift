import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { differenceCiede2000, displayable, rgb, wcagContrast, type Color, type Rgb } from 'culori';
import { describe, expect, it } from 'vitest';

import { BASE_TOKENS, BRAND_TOKENS, rawToken, readToken, type Theme } from './theme-css.js';

/**
 * Contrast, measured rather than promised (story 1.1b, UX-DR3).
 *
 * DESIGN.md marks ramp slots 3-6 `[ASSUMPTION]` — unexercised by the pilot and
 * never contrast-checked — and converting from hex to OKLCH is exactly where a
 * value drifts unnoticed. So every pair is computed here, in both themes.
 *
 * Both halves of the layer are covered. The first derivation measured only the
 * brand pairs and left the 28 base tokens — the shadcn token NAMES every
 * primitive resolves, filled since visual refresh A with a slate/navy palette —
 * unmeasured.
 *
 * Every measurement assumes the colour renders as declared, which is only true
 * inside sRGB: a browser clips an out-of-gamut OKLCH value, and a ratio or ΔE
 * computed on the unclipped value then describes a colour nobody sees. The
 * gamut block below asserts that premise for every colour token.
 *
 * A failure is a design question, not a value to nudge: the spec gates that on
 * a human.
 */

const AA_BODY = 4.5;
const AA_LARGE = 3;
const THEMES = ['light', 'dark'] as const;

/**
 * The curated accents an organization may choose between (story 1.4c, UX-DR5).
 *
 * Named once and consumed twice below — as measured text pairs, and as the
 * subjects of the separation from `destructive` — so an accent cannot join one
 * sweep without joining the other. `apps/web/src/organization/accent.test.ts`
 * separately pins this list against the SPA's own set and against `0006`'s
 * check constraint, so the three cannot drift apart.
 */
const ACCENT_TOKENS = ['brand-blue', 'brand-green', 'brand-amber', 'brand-violet'] as const;

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
  // STORY 1.4c's four curated accents. They join the BODY threshold rather than
  // the 3:1 one, deliberately: the lockup draws an organization's initial on its
  // own fill at a small size when there is no logo, which is text. An accent
  // that ships without a measured pair is the one thing this curation exists to
  // prevent — a colour column would have moved the measurement to runtime.
  ...ACCENT_TOKENS,
] as const;

/** Base surfaces that carry text. */
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

/**
 * The shorter way round the OKLCH hue wheel, in degrees.
 *
 * ONE FALLBACK FOR A MISSING HUE, and it is `NaN` — which fails every
 * comparison below, which is the direction a missing hue has to fail in. The
 * version this replaces had two: a colour object with no `h` KEY yielded `NaN`
 * while an achromatic OKLCH whose `h` is `undefined` yielded `0` through a
 * `?? 0`, and 0° is red's own hue — so a grey token compared against
 * `destructive` would have measured as maximally CLOSE to it and failed for a
 * reason that was not true. An accent with no hue is not an accent, and every
 * value this file measures has one; a token that stops having one is a fault,
 * and a fault should look like one.
 */
function hueGap(one: Color, other: Color): number {
  const angle = (colour: Color): number =>
    'h' in colour && colour.h !== undefined ? colour.h : Number.NaN;
  const raw = Math.abs(angle(one) - angle(other)) % 360;

  return Math.min(raw, 360 - raw);
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

describe('base text pairs clear WCAG 2.1 AA', () => {
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

describe('every colour token renders as declared, inside sRGB', () => {
  /**
   * THE PREMISE OF THIS WHOLE FILE. OKLCH can name colours no sRGB display can
   * show, and a browser clips them — so a value outside the gamut would pass
   * every ratio and ΔE here while rendering as some other, nearer colour. The
   * accents are where this bites: visual refresh A pushed `--brand-blue` to
   * chroma 0.255 to hold it away from `primary`, which is close to the edge.
   *
   * Every colour token in both themes, alpha tokens included (their colour is
   * checked, their alpha is not a gamut question).
   */
  const cases = THEMES.flatMap((theme) =>
    [...BASE_TOKENS, ...BRAND_TOKENS].map((name) => ({ theme, name })),
  );

  it.each(cases)('--$name is inside sRGB in $theme', ({ theme, name }) => {
    const value = colour(theme, name);
    const channels = rgb(value);

    expect(
      displayable(value),
      `--${name} (${theme}) is out of sRGB: r ${channels.r.toFixed(4)} g ${channels.g.toFixed(4)} b ${channels.b.toFixed(4)}`,
    ).toBe(true);
  });

  it('would refuse an out-of-gamut value, so the sweep is not vacuous', () => {
    expect(displayable({ mode: 'oklch', l: 0.545, c: 0.32, h: 280 } as Color)).toBe(false);
  });
});

describe('the navy sidebar carries readable text and visible controls', () => {
  /**
   * The sidebar's own pairs (visual refresh A), owed since story 1.1b: the
   * base sweep measures `sidebar-foreground` on `sidebar` and nothing else, so
   * the active destination's label, the hovered row, the sign-in brand
   * panel's headline and the section label were measured by nothing.
   *
   * The section label is drawn at 70% of `sidebar-foreground`, so it is
   * composited over the sidebar first — the raw token flatters it.
   */
  const SIDEBAR_PAIRS: { label: string; text: (theme: Theme) => Rgb | Color; surface: string }[] = [
    {
      label: 'sidebar-primary-foreground on sidebar-primary (the active destination)',
      text: (theme) => colour(theme, 'sidebar-primary-foreground'),
      surface: 'sidebar-primary',
    },
    {
      label: 'sidebar-accent-foreground on sidebar-accent (a hovered row)',
      text: (theme) => colour(theme, 'sidebar-accent-foreground'),
      surface: 'sidebar-accent',
    },
    {
      label: 'sidebar-accent-foreground on sidebar (the brand panel)',
      text: (theme) => colour(theme, 'sidebar-accent-foreground'),
      surface: 'sidebar',
    },
    {
      label: 'sidebar-foreground at 70% on sidebar (the section label)',
      text: (theme) =>
        composite({ ...rgb(colour(theme, 'sidebar-foreground')), alpha: 0.7 }, colour(theme, 'sidebar')),
      surface: 'sidebar',
    },
  ];
  const cases = THEMES.flatMap((theme) => SIDEBAR_PAIRS.map((pair) => ({ theme, ...pair })));

  it.each(cases)('$label reads in $theme', ({ theme, text, surface }) => {
    const measured = ratio(text(theme), colour(theme, surface));

    expect(measured, `measured ${measured.toFixed(2)}:1 (${theme})`).toBeGreaterThanOrEqual(AA_BODY);
  });

  /**
   * The `sidebar` Button variant's boundary: `sidebar-foreground` at 50%, the
   * value `components/ui/button.tsx` spells as `border-sidebar-foreground/50`.
   * The collapse and the exit are bordered controls on navy, and
   * `--sidebar-border` measures about 1.2:1 there — a divider, not a control's
   * edge. Floored at 3:1 and pinned, the `--input` bargain: the floor is the
   * requirement, the pin is the drift alarm.
   */
  const SIDEBAR_CONTROL_ALPHA = 0.5;
  const SIDEBAR_CONTROL_RATIO: Record<Theme, number> = { light: 3.91, dark: 3.67 };

  it('reads the alpha from the primitive itself, so the two cannot drift apart', () => {
    const button = readFileSync(
      join(fileURLToPath(new URL('..', import.meta.url)), 'apps', 'web', 'src', 'components', 'ui', 'button.tsx'),
      'utf8',
    );

    expect(button).toContain(`border-sidebar-foreground/${SIDEBAR_CONTROL_ALPHA * 100}`);
  });

  it.each(THEMES)('the sidebar button boundary clears 3:1 on --sidebar in %s', (theme) => {
    const surface = colour(theme, 'sidebar');
    const edge = composite({ ...rgb(colour(theme, 'sidebar-foreground')), alpha: SIDEBAR_CONTROL_ALPHA }, surface);
    const measured = ratio(edge, surface);

    expect(measured, `sidebar button boundary (${theme}) measured ${measured.toFixed(2)}:1`).toBeGreaterThanOrEqual(
      AA_LARGE,
    );
    expect(measured, `expected ~${SIDEBAR_CONTROL_RATIO[theme]}:1`).toBeCloseTo(SIDEBAR_CONTROL_RATIO[theme], 2);
  });
});

describe('badges and stat cards are text, and read on the card and on a hovered row', () => {
  /**
   * Visual refresh B's badges carry their meaning in words (a level, an
   * inactive marker), so each is small text and the body threshold applies.
   * They sit on the card, the member list's surface, AND on a hovered table
   * row, which is `muted` at the row primitive's alpha composited over the
   * card. The `default` variant is a primary TINT, `bg-primary/N`, composited
   * over whichever surface it sits on. Both alphas are read from the primitives,
   * as the sidebar button's is.
   *
   * ITS TEXT IS `foreground`, NOT `primary`. Dark `primary` does not reach the
   * body threshold on the dark card even with no tint, and every tint only
   * lowers it, so no alpha could fix it and a new colour token is a
   * design-owner decision. The assertion below keeps that reason measured
   * rather than remembered: if it ever stops being true, `text-primary` is
   * back on the table.
   *
   * The stat card's label is `muted-foreground` on the card; its value is
   * `card-foreground` on the card, which the base sweep already measures.
   */
  const BADGE_TINT_ALPHA = 0.15;
  const ROW_HOVER_ALPHA = 0.6;
  const webSrc = join(fileURLToPath(new URL('..', import.meta.url)), 'apps', 'web', 'src', 'components', 'ui');

  it('reads the variants and the row hover from the primitives, so they cannot drift apart', () => {
    const badge = readFileSync(join(webSrc, 'badge.tsx'), 'utf8');
    const table = readFileSync(join(webSrc, 'table.tsx'), 'utf8');

    expect(badge).toContain(`default: "bg-primary/${Math.round(BADGE_TINT_ALPHA * 100)} text-foreground",`);
    expect(badge).toContain('secondary: "bg-secondary text-secondary-foreground",');
    expect(badge).toContain('outline: "border border-input text-muted-foreground",');
    expect(table).toContain(`hover:bg-muted/${Math.round(ROW_HOVER_ALPHA * 100)}`);
  });

  it('keeps the reason the tint takes foreground text: dark primary misses 4.5:1 on the card untinted', () => {
    expect(ratio(colour('dark', 'primary'), colour('dark', 'card'))).toBeLessThan(AA_BODY);
  });

  const card = (theme: Theme): Color => colour(theme, 'card');
  const hoveredRow = (theme: Theme): Rgb =>
    composite({ ...rgb(colour(theme, 'muted')), alpha: ROW_HOVER_ALPHA }, card(theme));
  const tintOver = (theme: Theme, under: Color | Rgb): Rgb =>
    composite({ ...rgb(colour(theme, 'primary')), alpha: BADGE_TINT_ALPHA }, under as Color);

  const BADGE_PAIRS: { label: string; text: string; surface: (theme: Theme) => Rgb | Color }[] = [
    {
      label: 'foreground on the primary tint over the card (the default badge)',
      text: 'foreground',
      surface: (theme) => tintOver(theme, card(theme)),
    },
    {
      label: 'foreground on the primary tint over a hovered row (the default badge)',
      text: 'foreground',
      surface: (theme) => tintOver(theme, hoveredRow(theme)),
    },
    {
      label: 'secondary-foreground on secondary (the secondary badge, the avatar chip, on any row)',
      text: 'secondary-foreground',
      surface: (theme) => colour(theme, 'secondary'),
    },
    {
      label: 'muted-foreground on the card (the outline badge, the stat label)',
      text: 'muted-foreground',
      surface: card,
    },
    {
      label: 'muted-foreground on a hovered row (the outline badge)',
      text: 'muted-foreground',
      surface: hoveredRow,
    },
  ];
  const cases = THEMES.flatMap((theme) => BADGE_PAIRS.map((pair) => ({ theme, ...pair })));

  it.each(cases)('$label reads in $theme', ({ theme, text, surface }) => {
    const measured = ratio(colour(theme, text), surface(theme));

    expect(measured, `measured ${measured.toFixed(2)}:1 (${theme})`).toBeGreaterThanOrEqual(AA_BODY);
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

  /**
   * The same two measurements ON A CARD. Since visual refresh A the Input
   * primitive is filled with `--card`, and every form in the application sits
   * inside a Card — so the page is not the surface a field or its ring is
   * actually drawn on. Dark `--input` is alpha, so it composites differently
   * over navy-2 than over the page.
   */
  it.each(THEMES)('--ring is distinguishable from --card in %s', (theme) => {
    const measured = ratio(colour(theme, 'ring'), colour(theme, 'card'));

    expect(measured, `ring on card (${theme}) measured ${measured.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA_LARGE);
  });

  it.each(THEMES)('--ring is distinguishable from the --input border on a card in %s', (theme) => {
    const border = composite(colour(theme, 'input'), colour(theme, 'card'));
    const measured = ratio(colour(theme, 'ring'), border);

    expect(
      measured,
      `ring against the input border on a card (${theme}) measured ${measured.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(AA_LARGE);
  });
});

describe('the base deviations stay shifted, not reverted to stock shadcn', () => {
  /**
   * Each failed a threshold at its stock shadcn lightness and was moved to
   * clear it — see the spec change log. Since visual refresh A the base is a
   * slate/navy palette rather than stock shadcn, and `stock` below is kept as
   * the value a careless re-vendoring of shadcn's registry would restore. The blocks above already fail if any
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
   *
   * RE-PINNED BY VISUAL REFRESH A, to newly measured values; the thresholds
   * above did not move. The slate/navy palette replaced the neutral greys, so
   * each `shifted` value is the new palette's, recorded with its reason in
   * `apps/web/src/index.css`'s header comment:
   *
   *   muted-foreground  0.542 -> 0.4924  slate-500 is 4.34:1 on slate-100
   *   ring              0.37  -> 0.3418  primary's hue, 3:1 from the border
   *   sidebar-ring      0.654 -> 0.8091  the sidebar is navy, so it goes light
   *   input             0.65  -> 0.6291  slate-toned, still 3:1 on the page
   */
  const DEVIATIONS: Record<string, { shifted: number; stock: number }> = {
    'muted-foreground': { shifted: 0.4924, stock: 0.556 },
    ring: { shifted: 0.3418, stock: 0.708 },
    'sidebar-ring': { shifted: 0.8091, stock: 0.708 },
    input: { shifted: 0.6291, stock: 0.922 },
  };

  it.each(Object.keys(DEVIATIONS))('--%s (light) holds its measured lightness, not shadcn’s stock one', (name) => {
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
 * `--border` and `--input` shipped as one stock shadcn value and are two
 * different requirements, which is why this is two blocks (story 1.1d; both
 * slate-toned since visual refresh A).
 *
 * Both composited, never raw: dark declares them with alpha, and a raw reading
 * of dark `--border` reports a meaningless 19.79:1 against a surface it is in
 * fact barely visible on.
 */
describe('the input boundary clears the UI-component threshold', () => {
  // WCAG 1.4.11 requires 3:1 where a boundary is a component's SOLE visual
  // affordance, which is exactly a text input: its fill is the surface it
  // sits on, so the border is the whole control. The sign-in form is the first
  // surface where that is true, so the requirement replaces the pin that stood
  // while the question was open (deferred-work.md, story 1.1b review).
  //
  // Pinned AS WELL AS floored, the same reasoning `--border` carries below: a
  // bare `>= 3` passes for anything in [3, ∞), so an edit landing at 3.02:1 —
  // or at 8:1, which would be a heavy black box round every field — reads as
  // compliance. The floor is the requirement; the pin is the drift alarm.
  //
  // RE-PINNED BY VISUAL REFRESH A: 3.23 -> 3.35 light (a slate-toned input on
  // a slate-50 page), 3.26 -> 3.32 dark (the same 36% white, now over navy).
  const EXPECTED_RATIO: Record<Theme, number> = { light: 3.35, dark: 3.32 };

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

  it.each(THEMES)('--input is discernible against a card in %s', (theme) => {
    // The Input primitive is filled with `--card` since visual refresh A, and
    // forms sit in cards, so this is the surface the boundary is actually on.
    const surface = colour(theme, 'card');
    const measured = ratio(composite(colour(theme, 'input'), surface), surface);

    expect(measured, `input on card (${theme}) measured ${measured.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA_LARGE);
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

describe('the decorative border contrast is pinned, not merely floored', () => {
  /**
   * `--border` composites to 1.18-1.32:1 against its surface — decorative,
   * and deliberately below AA.
   *
   * WCAG 1.4.11 wants 3:1 only where a border is a control's sole visual
   * affordance. `--border` edges cards and separators and `@layer base` hands
   * it to every element as a default border colour; none of that is a control,
   * so the criterion does not apply and raising it would visibly heavy every
   * surface in the interface for no accessibility gain. `--input`, which IS a
   * control's whole affordance, moved instead — see the block above.
   *
   * The measurement is therefore pinned rather than the requirement, so the
   * value cannot drift unnoticed. Same pattern as the state-glyph deferral in
   * typography-coverage.test.ts.
   */
  // Pinned to the specific measured ratio, not merely `1 < x < AA_LARGE` — that
  // band would pass silently for any accidental edit landing inside 1-3:1,
  // which is exactly the drift this block exists to catch.
  //
  // RE-PINNED BY VISUAL REFRESH A: 1.26 -> 1.18 light (slate-200 on slate-50),
  // 1.25 -> 1.32 dark (10% white over the navy page). Still below 3:1 on
  // purpose — the reasoning above is unchanged.
  const EXPECTED_RATIO: Record<string, number> = {
    light: 1.18,
    dark: 1.32,
  };

  it.each(THEMES)('--border against its surface in %s holds its pinned ratio', (theme) => {
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

describe('no curated accent sits in the signal reserved for a conflict', () => {
  /**
   * UX-DR4 reserves `destructive` exclusively for an unresolved conflict — not
   * delete buttons, not validation errors, and explicitly not a brand accent.
   * The epic names the case this rule exists for: the pilot is a fire
   * department whose obvious accent is red, and an organization that chose it
   * would paint its shell in the one colour the application uses to mean "two
   * shifts claim the same person".
   *
   * The curated set excludes red BY CONSTRUCTION — there is no `red` key in
   * `0006`'s check constraint and no `--brand-red` token to render one — so
   * this block is not what enforces the absence. What it enforces is that the
   * four that DO exist stay far enough away, which is the thing a value edit
   * can break silently: nudging `--brand-amber`'s hue toward the warm end is
   * one character, breaks no ratio, and ends with an accent a person cannot
   * tell from a conflict marker.
   *
   * MEASURED TWO WAYS, because either alone is satisfiable while the other
   * fails. Hue distance is the shorter way round the OKLCH wheel, which is what
   * "in `destructive`'s hue" actually means and what a bare ΔE would let past
   * for a desaturated or very light red. CIEDE2000 is whether the eye can tell
   * the two apart at all, which is what a bare hue angle would let past for a
   * red-adjacent hue matched in lightness and chroma. The tightest accent today
   * is amber at 73°/ΔE 38.9 in light and 49°/ΔE 32.5 in dark, so both
   * thresholds sit well below what ships rather than on top of it.
   */
  const HUE_SEPARATION_DEGREES = 45;
  const PERCEPTIBLY_DIFFERENT = 25;
  const difference = differenceCiede2000();
  const cases = THEMES.flatMap((theme) => ACCENT_TOKENS.map((accent) => ({ theme, accent })));

  it.each(cases)('$accent is not in destructive’s hue in $theme', ({ theme, accent }) => {
    const measured = hueGap(colour(theme, accent), colour(theme, 'destructive'));

    expect(
      measured,
      `${accent} sits ${measured.toFixed(1)}° from destructive (${theme})`,
    ).toBeGreaterThanOrEqual(HUE_SEPARATION_DEGREES);
  });

  it.each(cases)('$accent is perceptibly not destructive in $theme', ({ theme, accent }) => {
    const measured = difference(colour(theme, accent), colour(theme, 'destructive'));

    expect(
      measured,
      `${accent} measured ΔE ${measured.toFixed(2)} against destructive (${theme})`,
    ).toBeGreaterThanOrEqual(PERCEPTIBLY_DIFFERENT);
  });

  it('measures a red accent as too close, so the thresholds are not vacuous', () => {
    // NON-VACUITY, and the only way to have it: every accent that ships passes,
    // so a broken predicate — a hue gap that always returned 180, a ΔE that
    // always returned 100 — would read as coverage on four passing cases. This
    // is the accent the rule exists to refuse, measured through the same two
    // predicates the sweeps above use.
    const red = { mode: 'oklch', l: 0.5908, c: 0.1949, h: 24.5 } as Color;

    expect(hueGap(red, colour('light', 'destructive'))).toBeLessThan(HUE_SEPARATION_DEGREES);
    expect(difference(red, colour('light', 'destructive'))).toBeLessThan(PERCEPTIBLY_DIFFERENT);
  });
});

describe('no curated accent is mistakable for any other signal either', () => {
  /**
   * THE SEPARATION RULE, EXTENDED PAST `destructive` — found in the 1.4c review,
   * and the finding was concrete: dark `--brand-amber` measured **ΔE 1.5** from
   * `--modifier-uncovered-foreground`, which is the same colour by any useful
   * definition, and dark `--brand-violet` ΔE 5.8 from `--modifier-overridden`.
   * An organization on amber was tinting its shell in the uncovered-shift
   * colour. The values moved; this is what keeps them moved.
   *
   * THE THRESHOLD IS DELIBERATELY WEAKER THAN `destructive`'S, AND IT IS A
   * DISTANCE RATHER THAN AN ANGLE. Stating why, because the omission would
   * otherwise read as an oversight and the asymmetry as an accident:
   *
   *   - A HUE RULE IS NOT SATISFIABLE HERE, arithmetically. The five signals sit
   *     at roughly 19°, 76°, 158°, 245° and 290°, which leaves exactly two
   *     windows on the whole circle that are 45° from all of them — about 202°
   *     and about 335°. A curated set of four named `blue`, `green`, `amber` and
   *     `violet` (the story's frozen Boundaries) cannot live in two windows, and
   *     an accent called `Jantarna` cannot be 45° from an amber modifier. The
   *     modifier palette and the accent palette are drawn from the same everyday
   *     colour vocabulary on purpose.
   *
   *   - `destructive` IS DIFFERENT IN KIND, not merely in degree. UX-DR4 makes
   *     it the one signal that must never be missed, the epic names a brand-red
   *     accent as the case the rule exists for, and red is therefore ABSENT from
   *     the curated set rather than merely held at a distance. Nothing is absent
   *     for the other four.
   *
   *   - WHAT ACTUALLY KEEPS THEM UNCONFUSABLE IS ROLE, and it is asserted
   *     elsewhere rather than assumed. The accent is a 1px border on the shell
   *     chrome and a fill behind one letter in the lockup;
   *     `apps/web/src/organization/accent.test.ts` asserts its class literals
   *     name no ramp slot, no modifier and no reserved token at all, so the two
   *     never appear in the same visual role. And the modifiers are never colour
   *     alone: UX-DR8 pairs each with a hatch AND a glyph, and UX-DR37/Q21 make
   *     the glyph the carrier of the meaning.
   *
   * So what is asserted is that no accent is ever the SAME COLOUR as a signal —
   * ΔE 10, against a just-noticeable bound of about 2.3 — which is a real
   * property a value edit can break and the one the review's finding actually
   * violated.
   */
  const NOT_THE_SAME_COLOUR = 10;
  const difference = differenceCiede2000();

  /**
   * Every signal an accent could be mistaken for, `destructive` excluded — it
   * has the stricter block above.
   *
   * The two overlays are measured through their FOREGROUNDS as well as their
   * fills, and the foreground is the one that matters: `--modifier-leave` and
   * `--modifier-uncovered` are alpha tokens whose raw values are read by nobody,
   * while their foregrounds are the opaque colours the glyph is actually drawn
   * in. Measuring only the fills is how dark amber passed at ΔE 1.5 from the
   * colour a person sees.
   */
  const SIGNALS = [
    'primary',
    'modifier-overridden',
    'modifier-leave',
    'modifier-leave-foreground',
    'modifier-uncovered',
    'modifier-uncovered-foreground',
  ] as const;

  const cases = THEMES.flatMap((theme) =>
    ACCENT_TOKENS.flatMap((accent) => SIGNALS.map((signal) => ({ theme, accent, signal }))),
  );

  it.each(cases)('$accent is not $signal in $theme', ({ theme, accent, signal }) => {
    const measured = difference(colour(theme, accent), colour(theme, signal));

    expect(
      measured,
      `${accent} measured ΔE ${measured.toFixed(2)} against ${signal} (${theme}) — the two are the same colour`,
    ).toBeGreaterThanOrEqual(NOT_THE_SAME_COLOUR);
  });

  it('would have failed the value this rule was written for', () => {
    // NON-VACUITY, and it is the actual regression rather than an invented one:
    // `oklch(0.7827 0.1249 79.1)` is what dark `--brand-amber` shipped as before
    // the 1.4c review, and it measures ΔE 1.5 from the glyph colour of an
    // uncovered shift. A threshold that cannot fail on that is not a threshold.
    const shipped = { mode: 'oklch', l: 0.7827, c: 0.1249, h: 79.1 } as Color;

    expect(
      difference(shipped, colour('dark', 'modifier-uncovered-foreground')),
    ).toBeLessThan(NOT_THE_SAME_COLOUR);
  });
});

describe('the accent is discernible on the surfaces it is drawn on', () => {
  /**
   * THE MEASUREMENT THE PAIRS DO NOT MAKE. `BRAND_PAIRS` measures each accent
   * against its own FOREGROUND, which is the right question for the mark — text
   * on a fill. It is the wrong question for everything else the accent does: the
   * sidebar's `border-r`, the phone bar's `border-t` and the lockup's own frame
   * are 1px borders drawn against a surface, with no foreground involved at all.
   * A value that read perfectly under its own letter could be invisible as a
   * line on the page, and nothing measured it.
   *
   * WCAG 1.4.11's 3:1, because a border is a non-text element. Held to the
   * floor rather than pinned: unlike `--border`, which is deliberately below AA
   * and pinned so it cannot drift, this one has no ceiling worth defending — an
   * accent that is MORE visible as an edge is doing its job.
   */
  const SURFACES = ['background', 'card', 'sidebar'] as const;
  const cases = THEMES.flatMap((theme) =>
    ACCENT_TOKENS.flatMap((accent) => SURFACES.map((surface) => ({ theme, accent, surface }))),
  );

  it.each(cases)('$accent draws a visible edge on $surface in $theme', ({ theme, accent, surface }) => {
    const measured = ratio(colour(theme, accent), colour(theme, surface));

    expect(
      measured,
      `${accent} on ${surface} (${theme}) measured ${measured.toFixed(2)}:1`,
    ).toBeGreaterThanOrEqual(AA_LARGE);
  });
});
