/**
 * The curated brand accents, as data (story 1.4c, UX-DR5).
 *
 * ONE MODULE, THREE CONSUMERS THAT MUST AGREE. The database enumerates the
 * accents in a `check` constraint (`0006`), the theme layer authors a measured
 * fill/foreground pair for each of them (`index.css`), and `hr.json` names each
 * of them in Croatian. Those are three files that would otherwise drift, and
 * the drift is silent in every direction: a key the constraint admits and the
 * stylesheet has no token for renders nothing; a token nobody can choose is
 * dead CSS; a key with no label renders `⟦…⟧`. This list is the single thing
 * `accent.test.ts` compares all three against.
 *
 * A KEY, NEVER A COLOUR — the decision `0006` argues at length. Every colour in
 * this application has its contrast measured at BUILD time; an admin-entered
 * colour would move that to runtime and need a contrast function in
 * `apps/web/src`, which today contains none — no `setProperty`, no OKLCH
 * parsing, no ratio arithmetic anywhere. Storing which curated accent was
 * chosen keeps the measurement where it already is.
 *
 * THE CLASS LITERALS LIVE HERE rather than in the components, and that is two
 * decisions rather than one. Tailwind resolves utilities by scanning source
 * text, so `bg-brand-${key}` produces no CSS at all — the classes have to exist
 * as whole literals somewhere. And `apps/web/src/routes/prijava.test.ts`
 * refuses every string literal in a `.tsx` that is not a structural attribute,
 * so the somewhere is a `.ts` module. It is the same shape
 * `ORGANIZATION_LOGO_ACCEPT` takes for the file picker's `accept` hint.
 *
 * NOTHING HERE IS A GATE. The database refuses a key outside the set; this
 * module's job when handed one is to render something rather than to throw —
 * see {@link brandAccentAppearance}. A surface that crashed on an unknown
 * accent would turn a value nobody can enter through the interface into a blank
 * application for everybody who shares the organization.
 */

/**
 * The accents an organization may choose between.
 *
 * FOUR, AND NO RED. UX-DR4 reserves `destructive` exclusively for an unresolved
 * conflict — not delete buttons, not validation errors, and explicitly not a
 * brand accent — and the epic names the case: the pilot is a fire department
 * whose obvious accent is red. The exclusion is by construction here and by
 * measurement in `test/theme-contrast.test.ts`, which holds every one of these
 * at least 45° of hue and ΔE 25 away from `destructive` in both themes.
 *
 * Four is a starting set rather than a ceiling. Adding one is a token pair in
 * `index.css`, a contrast pair, a value in `0006`'s constraint, an entry here
 * and a label in `hr.json` — five edits in one commit, and `accent.test.ts`
 * fails until all of them have happened.
 */
export const BRAND_ACCENT_KEYS = ['blue', 'green', 'amber', 'violet'] as const;

export type BrandAccentKey = (typeof BRAND_ACCENT_KEYS)[number];

/**
 * The value the accent control carries for "no accent".
 *
 * A CONSTANT rather than an inline `''`, for the reason `NO_FILE_CHOSEN` is one:
 * the screen that renders the control may hold no string literal at all
 * (`prijava.test.ts`), so the empty string lives in the module that owns the
 * vocabulary. It maps to SQL `null`, which is what "no accent" actually is on
 * the row — there is no `'none'` key and there must not be one, because the
 * absence of an accent is not a fifth accent.
 */
export const NO_BRAND_ACCENT = '';

/**
 * The Tailwind classes one accent paints with.
 *
 * THREE FIELDS, AND THE SCOPE IS THE POINT. UX-DR5 tints the application shell
 * and the logo lockup — nothing else — so this type names exactly the three
 * places the tint may land and there is no fourth for a later surface to reach
 * for by accident. Every value below is a `brand-*` utility or one of the
 * neutral tokens the untinted shell already uses; `accent.test.ts` asserts that
 * none of them names `primary`, `destructive`, a ramp slot or a modifier.
 */
export interface BrandAccentAppearance {
  /** The neutral mark's fill and the text on it, when there is no logo. */
  readonly mark: string;
  /**
   * The lockup's own border, logo or mark.
   *
   * SEPARATE FROM {@link BrandAccentAppearance.edge}, AND THE SEAM IS THE
   * NEUTRAL CASE — which is exactly where it matters, because that is the state
   * every organization starts in. The two are byte-identical for all four
   * accents and diverge only in {@link NEUTRAL}: the lockup's untinted boundary
   * is `border-input`, the shell's is `border-border`, and those are the
   * classes each element already carried before this story existed. UX-DR5's
   * "no accent renders the untinted shell it has today" is a claim about
   * BYTES, so collapsing the two into one field would have to pick one neutral
   * and change the other — `--input` measures 3.35:1 against the page and
   * `--border` 1.18:1, so it is the difference between a boundary that is a
   * control's whole affordance and a decorative divider.
   *
   * Nor can the element carry its own neutral and let the accent override it:
   * a neutral border utility and an accent one are single-class rules of equal
   * specificity, so which one wins is decided by their order in the GENERATED
   * stylesheet and not by the order they are written in. Emitting exactly one
   * of the two is the only version of this that is deterministic.
   *
   * `accent.test.ts` asserts the identity and the divergence rather than
   * leaving either to be noticed.
   */
  readonly frame: string;
  /** The edge the sidebar and the phone bar draw against the content. */
  readonly edge: string;
}

/**
 * The lockup's two sizes and their type scale, as whole Tailwind literals.
 *
 * HERE RATHER THAN IN THE COMPONENT, for the two reasons the class literals
 * above are: Tailwind resolves utilities by scanning source text, so a class
 * assembled from a variable produces no CSS at all, and
 * `apps/web/src/routes/prijava.test.ts` refuses every string literal in a
 * `.tsx` that is not sitting on a structural attribute.
 *
 * THE TYPE SCALE TRAVELS WITH THE BOX, which is the whole reason this is a pair
 * rather than a size. The mark is a single code point drawn inside the frame,
 * and a scale fixed at `text-lg` for both sizes overflows the 32 px box the
 * moment the code point is a wide one — which for this application is not
 * hypothetical: a mark is the first character of an admin-entered name, and
 * `Đ` and `Ž` are wider than `A`.
 *
 * 64 px on the settings surface, where the logo is the thing being looked at
 * and replaced; 32 px in the navigation chrome, where it sits inside a 44 px
 * bar beside nine other targets. Neither is a control — nothing about the
 * lockup is pressable — so UX-DR40's 44 px floor does not apply to either.
 */
export interface LockupScale {
  /** The box. */
  readonly box: string;
  /** The mark's type scale inside it. */
  readonly type: string;
}

export const LOCKUP_FULL: LockupScale = { box: 'h-16 w-16', type: 'text-lg leading-none' };
export const LOCKUP_COMPACT: LockupScale = { box: 'h-8 w-8', type: 'text-xs leading-none' };

/**
 * What an organization with no accent renders, which is what ships today.
 *
 * `border-border` on the chrome's edges and `border-input`/`bg-muted` on the
 * lockup are the classes those elements already carry, so "no accent" is
 * byte-identically the shell the navigation chrome shipped with rather than a
 * second, subtly different neutral. The absence is a neutral default and never
 * an error (the story's I/O matrix), which is also why this is what an
 * UNRECOGNISED key resolves to.
 *
 * `text-foreground` ON THE MARK SINCE VISUAL REFRESH A, and it is the one
 * neutral class that is not inherited from before. The chrome's sidebar is navy
 * now and its text is light, so a mark that inherited its letter colour drew a
 * light letter on the light `bg-muted` fill — illegible in exactly the state
 * every organization starts in. Every accent's mark already names its own
 * foreground; the neutral one now does too, which is also what the settings
 * card was rendering by inheritance all along.
 */
const NEUTRAL: BrandAccentAppearance = {
  mark: 'bg-muted text-foreground',
  frame: 'border-input',
  edge: 'border-border',
};

/**
 * Each accent's classes, written out per key.
 *
 * WHOLE LITERALS, never interpolated. Tailwind builds its stylesheet by
 * scanning source text for class names, so `bg-brand-${key}` is a class that
 * exists in the DOM and in no stylesheet — the accent would simply not paint,
 * with nothing failing anywhere. That is also why this is a record rather than
 * something derived from {@link BRAND_ACCENT_KEYS}.
 */
const APPEARANCES: Record<BrandAccentKey, BrandAccentAppearance> = {
  blue: {
    mark: 'bg-brand-blue text-brand-blue-foreground',
    frame: 'border-brand-blue',
    edge: 'border-brand-blue',
  },
  green: {
    mark: 'bg-brand-green text-brand-green-foreground',
    frame: 'border-brand-green',
    edge: 'border-brand-green',
  },
  amber: {
    mark: 'bg-brand-amber text-brand-amber-foreground',
    frame: 'border-brand-amber',
    edge: 'border-brand-amber',
  },
  violet: {
    mark: 'bg-brand-violet text-brand-violet-foreground',
    frame: 'border-brand-violet',
    edge: 'border-brand-violet',
  },
};

/** Whether a stored value is an accent this build can actually render. */
export function isBrandAccentKey(value: string | null): value is BrandAccentKey {
  return value !== null && (BRAND_ACCENT_KEYS as readonly string[]).includes(value);
}

/**
 * How the shell and the lockup paint for one stored accent.
 *
 * FAILS TO NEUTRAL, never throws, and the unknown key is a real case rather
 * than a defensive one. `0006`'s constraint makes an unrenderable accent
 * unrepresentable TODAY, but a row written by a build that knew a fifth accent
 * and read by one that does not is exactly what a forward-only migration stream
 * plus a static SPA on a CDN produces during a deploy — the two are not
 * promoted at the same instant. The honest answer there is the untinted shell,
 * which is a thing to look at; the alternative is a thrown render on every
 * screen in the application for everybody in that organization.
 */
export function brandAccentAppearance(accent: string | null): BrandAccentAppearance {
  return isBrandAccentKey(accent) ? APPEARANCES[accent] : NEUTRAL;
}

/**
 * The message key one accent renders as — the edge, and the only place an
 * accent key becomes Croatian.
 *
 * Here rather than as a lookup written in the screen, and the placement is the
 * shape `signInMessageKey`, `organizationMessageKey` and `navigationMessageKey`
 * established: a `.tsx` is collected by nothing (AD-15), so a mapping written
 * there can only be read as source text, and swapping two entries would leave
 * an organization that chose green reading `Plava` with every assertion in the
 * repository green.
 *
 * `null` IS A CASE and not a missing one: "no accent" is an option the control
 * offers, so it needs a name, and the name states the fact (`Neutralna`) rather
 * than the absence — `Nema` is banned outright from every built chunk by
 * `test/localization-applied.test.ts`.
 *
 * The return type is the literal union rather than `string`, so `t()` still
 * type-checks the key against `hr.json` (`i18n/index.ts`) and a key deleted
 * from the resource file is a `pnpm typecheck` failure rather than a `⟦…⟧` on
 * screen. It is also what `prijava.test.ts` reads to count this module's keys.
 */
export function accentMessageKey(
  accent: string | null,
):
  | 'organization.accentNone'
  | 'organization.accentBlue'
  | 'organization.accentGreen'
  | 'organization.accentAmber'
  | 'organization.accentViolet' {
  if (accent === 'blue') return 'organization.accentBlue';
  if (accent === 'green') return 'organization.accentGreen';
  if (accent === 'amber') return 'organization.accentAmber';
  if (accent === 'violet') return 'organization.accentViolet';

  // EVERYTHING ELSE IS "no accent", including a key this build does not know —
  // the same fail-to-neutral `brandAccentAppearance` takes, and for the same
  // reason. An exhaustive `never` would be wrong here: the argument is the
  // column's type (`string | null`) rather than a union this module owns, so
  // there is no closed set for the compiler to check and the runtime case is
  // real. What the two functions must never do is disagree, which is why
  // `accent.test.ts` runs both over the same unknown value.
  return 'organization.accentNone';
}

/**
 * The options the accent control offers, in the order it offers them.
 *
 * "NO ACCENT" IS FIRST because it is the state every organization starts in,
 * and it is `null` rather than a fifth key because that is what the column
 * holds. The four follow in the order {@link BRAND_ACCENT_KEYS} declares, so
 * the control cannot present a different set from the one the database admits.
 */
export const BRAND_ACCENT_OPTIONS: readonly (BrandAccentKey | null)[] = [
  null,
  ...BRAND_ACCENT_KEYS,
];

/**
 * One option's value as the control carries it, and back again.
 *
 * A `<select>` speaks strings and the column speaks `text | null`, so the empty
 * string is the crossing point. Both directions live here rather than in the
 * screen because they have to agree: a screen that read the value back with a
 * different rule would write `''` into a column whose constraint admits four
 * words and null, and be refused for a reason nobody could see.
 */
export function brandAccentValue(accent: BrandAccentKey | null): string {
  return accent ?? NO_BRAND_ACCENT;
}

export function brandAccentOf(value: string | null): BrandAccentKey | null {
  return isBrandAccentKey(value) ? value : null;
}
