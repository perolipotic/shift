import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { DESTINATIONS } from '@/navigation/destinations';

/**
 * The sign-in path's screens, asserted at source level (story 1.1d, extended by
 * story 1.3b).
 *
 * AD-15 bans jsdom and `apps/web/vitest.config.ts` collects `src/**\/*.test.ts`
 * only, so a `.tsx` test here would be silently NOT COLLECTED — green, and
 * asserting nothing. That rules out rendering the screen, which means the
 * properties worth guarding have to be read off the source instead:
 *
 *   - every user-facing string reaches `t()`. `eslint.config.js`'s L2 block is
 *     the merge gate and it fires on JSX shapes; this is the complementary
 *     claim, that the only string literals left in the file sit on structural
 *     attributes nobody reads.
 *   - the keys used and the keys declared are the same set, in both
 *     directions. A typo is a `tsc` error (`CustomTypeOptions` types keys off
 *     `hr.json`), but a key declared and never rendered is not — and an
 *     unrendered string is a string nobody reviewed.
 *   - 44 px tap targets. MUTATION-PROVEN GAP: deleting all four
 *     `className="h-11"` reverted every control on the one screen nobody can
 *     skip to the inherited 36 px, with 900 tests green.
 *   - the boundary the theme layer raised is the boundary the control draws.
 *     MUTATION-PROVEN GAP too: `border-input` → `border-border` in `input.tsx`
 *     left `--input`'s measured 3.23:1 true of a token nothing consumed.
 *   - both fields carry an accessible name, and the reset guidance is bound to
 *     the password field. `htmlFor`/`id` is the only thing that ties a
 *     `<Label>` to its `<Input>`, and getting it wrong leaves a screen reader
 *     announcing "edit text, blank" on a password field.
 *   - the screen REACHES the authentication seam. This was the inverse claim
 *     until story 1.3b — the screen was inert, and the block asserted it named
 *     no `supabase`, no `fetch(`, no `useState`, no `localStorage`. That is now
 *     false of a screen that signs people in, so the block is narrowed to the
 *     new truth rather than deleted: the handler is real, it goes through the
 *     `@/supabase` modules rather than assembling a request inline, and it
 *     still stops the browser's own submission.
 *   - `destructive` appears nowhere. UX-DR4 reserves it exclusively for an
 *     unresolved conflict, and a refused sign-in is not one — it is the error
 *     surface this story ships, and it may not use it.
 *
 * Every read is lazy and every detector is self-tested on synthetic sources at
 * the bottom, the idiom `packages/domain/test/purity.test.ts` established: a
 * regex that stopped matching would make each sweep pass having proved nothing.
 */

const srcRoot = fileURLToPath(new URL('..', import.meta.url));
const SCREEN = join(srcRoot, 'routes', 'prijava.tsx');
const NOT_FOUND = join(srcRoot, 'routes', 'not-found.tsx');
const ORGANIZATION = join(srcRoot, 'routes', 'prijava-organizacija.tsx');
const HOME = join(srcRoot, 'routes', 'index.tsx');
const LAYOUT = join(srcRoot, 'routes', '_app.tsx');
const INPUT_PRIMITIVE = join(srcRoot, 'components', 'ui', 'input.tsx');
const RESOURCE = join(srcRoot, 'i18n', 'locales', 'hr.json');
/** Story 1.4a's settings surface: the first destination that is not a placeholder. */
const SETTINGS = join(srcRoot, 'routes', 'organizacija.tsx');
/**
 * The navigation chrome, part B: a `.tsx` that is not a route at all.
 *
 * It is swept by everything in this file anyway, and that is the point rather
 * than an accident of where it sits. Every claim below — no bare text, no
 * unsanctioned literal, a 44 px floor on every control, no `destructive` — is a
 * property of a file that RENDERS, not of a file that is registered as a route.
 * The chrome renders on every one of the eight destinations, so a literal
 * smuggled in here reaches more screens than one in any route module could.
 */
const CHROME = join(srcRoot, 'navigation', 'chrome.tsx');

/**
 * The seven titled placeholders still standing after story 1.4a.
 *
 * EIGHT UNTIL THIS COMMIT. `/organizacija` is a real screen now — a form with
 * five fields, two buttons and a refusal message — so it is named separately
 * below rather than inheriting the placeholder's counts, which are what make
 * these entries tight: exactly one string, exactly zero controls. Leaving it in
 * this list would have meant loosening those counts for all eight, which is the
 * shape that lets the next destination grow a control nobody reviewed.
 *
 * The split is CROSS-CHECKED against the destination table below, so a
 * destination can be in neither list only by failing a test.
 *
 * They are screens by this file's definition — a `.tsx` that renders a string —
 * so they join every sweep below rather than a subset chosen by hand. Each
 * renders exactly one `nav.*` heading and nothing else, which is what makes the
 * counts in `SCREENS` and `KEY_SOURCES` the tight numbers they are: a control
 * added to any of them, or a second string, fails here until somebody says why.
 *
 * Derived from the slug list rather than written out eight times, because the
 * three facts per entry are the same three facts and a hand-copied block is
 * where the ninth destination gets added to one list and not the other.
 *
 * The slug list is itself a hand-copied fourth copy of the eight — after the
 * router, the destination table and `hr.json` — so it is CROSS-CHECKED against
 * the table below rather than trusted. Without that, a ninth destination added
 * everywhere but here would silently escape the control count, the tap-target
 * floor, the literal sweeps and the per-file key count, all of which read only
 * what this list names. `router.test.ts` pins the same table against the
 * registered router, so the four copies are held together end to end.
 */
const PLACEHOLDER_SLUGS = [
  'danas',
  'kalendar',
  'sati',
  'godisnji',
  'raspored',
  'ljudi',
  'postavke-rotacije',
];

/** The destination that is a built screen rather than a placeholder. */
const BUILT_SLUGS = ['organizacija'];

/** Every registered destination, however much of it is built. */
const DESTINATION_SLUGS = [...PLACEHOLDER_SLUGS, ...BUILT_SLUGS];

const DESTINATION_SCREENS = PLACEHOLDER_SLUGS.map((slug) => ({
  name: `the ${slug} destination`,
  file: join(srcRoot, 'routes', `${slug}.tsx`),
}));

/**
 * Every screen that renders a string, so each sweep runs over all of them.
 *
 * A `.tsx` carrying a string and missing from this list is swept by NOTHING —
 * the ESLint block is the only other guard, and it cannot see a key that is
 * declared and never rendered, a literal on an unguarded attribute, or a
 * control below the tap-target floor. Story 1.3b adds two: the organization
 * prompt at bare `/prijava`, and `/`, which stopped being a bare redirect and
 * now renders a heading of its own.
 */
const SCREENS = [
  // `expectedControls` is what stops the general tap-target sweep passing on an
  // empty set: two of these screens carry no control at all today, so a loop
  // with no count behind it read as coverage while asserting nothing on half
  // its cases. A screen that gains a control fails here until the number moves,
  // which is the moment somebody confirms the new control is measured.
  { name: 'the sign-in screen', file: SCREEN, expectedControls: 3 },
  { name: 'the not-found component', file: NOT_FOUND, expectedControls: 1 },
  { name: 'the organization prompt', file: ORGANIZATION, expectedControls: 2 },
  { name: 'the signed-in placeholder', file: HOME, expectedControls: 0 },
  // EIGHT, and it was seven until story 1.4b: the settings surface carries five
  // fields — name, type, timezone and the leave year's month and day — plus a
  // save, a cancel, and now the logo's choose action. The number is what notices
  // a sixth FIELD, which on this screen is how the slug or the locale would
  // arrive: both are ordinary-looking controls and both are forbidden for
  // reasons that are invisible in a diff.
  //
  // The file input itself is a bare `<input type="file" className="sr-only">`
  // and so is counted by neither detector, which is deliberate rather than a
  // gap: what a pointer meets is the `<Button>`, that is what has to clear the
  // 44 px floor, and a native file input renders its own chrome in the
  // BROWSER's language — the one string on this screen that could never come
  // from `hr.json`. Its accessible name and its label binding are asserted by
  // name in the settings block below, since the general sweeps cannot see it.
  { name: 'the organization settings surface', file: SETTINGS, expectedControls: 8 },
  // ZERO on all seven, and asserted rather than assumed: a destination is a
  // heading and nothing else in this story, so the first control any of them
  // grows is a later story's work arriving without that story's review. The
  // count is also what keeps the tap-target sweep from reading as coverage on
  // eight screens it finds nothing to measure.
  ...DESTINATION_SCREENS.map((destination) => ({ ...destination, expectedControls: 0 })),
  // The layout renders no string of its own, and is swept anyway: it is a
  // `.tsx` under `routes/`, so the literal, bare-text and `destructive` sweeps
  // all apply to it, and being outside this list is exactly how a file becomes
  // guarded by nothing. Its own `<Outlet />` claim is asserted separately
  // below, because no sweep here can see a component that renders the wrong
  // thing.
  //
  // STILL ZERO, and that is a claim rather than a leftover: the layout wraps the
  // chrome around the outlet and owns no control of its own. Every control the
  // signed-in application offers lives in the entry below, which is where the
  // count moved to — the layout gaining one would mean the chrome had started
  // leaking back into the route module the guard lives in.
  { name: 'the signed-in layout', file: LAYOUT, expectedControls: 0 },
  // THREE on the chrome: the sidebar's collapse, the exit, and the retry that
  // makes the role read's failure something a person can act on. The
  // destinations are `<Link>`s, which neither detector matches by construction —
  // they are swept by name in the chrome block below, with their own count — so
  // this number is the three BUTTONS and nothing else. It is what notices a
  // fourth arriving: on a component that renders above every destination in the
  // application, a control nobody reviewed is a control on eight screens.
  { name: 'the navigation chrome', file: CHROME, expectedControls: 3 },
];

/**
 * The screens that own a form, an uncontrolled field and a submit handler.
 *
 * Named separately because the wiring sweeps below apply to exactly these and
 * are meaningless on the other two — and because running them over `SCREEN`
 * alone is how the organization prompt shipped with the identical shape and
 * none of the coverage. The missing-`ref` mutation that reached a browser was
 * caught on one screen and stayed live on the other.
 */
const FORM_SCREENS = [
  // `inFlight` is the name of the ref that guards a second concurrent submit,
  // or `null` for a screen that starts nothing to be in flight. It is carried
  // per entry for the same reason `effect` is: the in-flight sweeps were pinned
  // to the sign-in screen by name — `exchanging.current` written out as a
  // literal — so deleting `setPending(false)` from the settings surface's
  // `finally` left the whole suite green while the identically shaped sign-in
  // screen was protected against exactly that.
  { name: 'the sign-in screen', file: SCREEN, effect: 'signIn(', inFlight: 'exchanging' },
  // The prompt awaits nothing and holds no failure state — it validates what was
  // typed and navigates — so there is no in-flight flag to clear and no refusal
  // to surface. `null` rather than a name, and the derived list below asserts it
  // is not empty, so "every screen opted out" cannot read as coverage.
  {
    name: 'the organization prompt',
    file: ORGANIZATION,
    effect: 'organizationDestination(',
    inFlight: null,
  },
  // Story 1.4a. The settings surface is the third screen with a form, and it is
  // the one with the most to lose from getting the uncontrolled-ref shape wrong:
  // five fields rather than two, so a refusal that re-rendered them away would
  // discard five entered values instead of a password.
  {
    name: 'the organization settings surface',
    file: SETTINGS,
    effect: 'updateOrganization(',
    inFlight: 'saving',
  },
];

/** The form screens that await something, so something can be in flight. */
const IN_FLIGHT_SCREENS = FORM_SCREENS.filter(
  (screen): screen is typeof screen & { inFlight: string } => screen.inFlight !== null,
);

/**
 * A `.ts` module that renders no JSX but holds `t()` keys.
 *
 * `signInMessageKey` moved the two refusal keys out of the screen and into
 * `@/supabase/sign-in`, where a node test can EXECUTE the pairing — swapping
 * the branches of the ternary it replaced passed every assertion in this file.
 * The keys have to stay in scope for the set comparison below, or every key
 * this application renders would no longer equal every key it declares.
 */
const MESSAGE_KEYS = join(srcRoot, 'supabase', 'sign-in.ts');

/** The same shape, for story 1.4a's four organization failures. */
const ORGANIZATION_MESSAGE_KEYS = join(srcRoot, 'organization', 'messages.ts');

/** The same shape again, for the chrome's role and sign-out failures. */
const NAVIGATION_MESSAGE_KEYS = join(srcRoot, 'navigation', 'messages.ts');

/** UX-DR40's tap-target floor, in CSS pixels. */
const TARGET_FLOOR_PX = 44;
/** Tailwind's spacing scale: `h-11` is 11 × 0.25rem at a 16px root. */
const SPACING_STEP_PX = 4;
const ROOT_FONT_PX = 16;

const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;
/** `//` to end of line. The leading class keeps `https://` inside a string
 *  intact — the two-pass idiom from `test/key-hygiene.test.ts`. */
const LINE_SLASH = /(^|[\s;,{}()[\]])\/\/[^\n]*/g;

/**
 * Comment-blind source, and load-bearing here rather than merely tidy: the
 * screen's own header explains why `destructive` is absent and quotes the
 * Croatian copy, both of which a comment-aware scan would report as offences.
 */
function stripComments(source: string): string {
  return source.replace(BLOCK_COMMENT, '').replace(LINE_SLASH, '$1');
}

function source(file: string): string {
  return stripComments(readFileSync(file, 'utf8'));
}

/**
 * A screen's `submit` handler, from its signature to its closing brace.
 *
 * SCOPED extraction rather than a file-wide match, and that is the whole point
 * of it: the assertions built on it claim things about what the handler DOES,
 * and a file-wide regex would find the same tokens in an import, a comment that
 * survived stripping, or a second function. The closing brace is matched at the
 * handler's own indentation, which is two spaces inside the component.
 */
function submitHandler(screen: string): string {
  return /(?:async )?function submit\([\s\S]*?\n {2}\}/.exec(screen)?.[0] ?? '';
}

/**
 * One helper function declared inside a component, from its signature to its
 * closing brace at the component's own two-space indentation.
 *
 * Added by the 1.4a review. The settings surface renders its form from
 * `renderSettings()`, which returns early when there is no snapshot — so
 * anything written INSIDE it is reachable only once a row has been read, and
 * the refusal message was. Scoped extraction rather than a file-wide match, for
 * the reason `submitHandler` is: the claim is about what is inside this
 * function, and a file-wide search answers a different question.
 */
function componentFunction(screen: string, name: string): string {
  return (
    new RegExp(`function ${name}\\([^)]*\\)[^{]*\\{[\\s\\S]*?\\n {2}\\}`).exec(screen)?.[0] ?? ''
  );
}

/** The body of the handler's `finally`, matched at its own indentation. */
function finallyBlock(screen: string): string {
  return /\}\s*finally\s*\{([\s\S]*?)\n {4}\}/.exec(screen)?.[1] ?? '';
}

/** Every key handed to `t()`, in source order. */
function translationKeys(text: string): string[] {
  return [...text.matchAll(/\bt\(\s*'([^']+)'/g)].map((found) => found[1] ?? '');
}

/**
 * The keys `signInMessageKey` can return, read off its RETURN TYPE.
 *
 * `@/supabase/sign-in` renders no JSX and calls no `t()`, so `translationKeys`
 * finds nothing in it — and the two refusal keys would drop out of the
 * rendered set entirely, taking the "every key declared is rendered" claim with
 * them.
 *
 * The union is the right place to read them from rather than a second-best one:
 * it is what makes `t(signInMessageKey(failure))` type-check against `hr.json`
 * (`i18n/index.ts`), so a key that is not in the resource file is already a
 * `pnpm typecheck` failure, and a key added to the function body without being
 * added to the union is too.
 */
function messageKeyUnion(text: string): string[] {
  // `\w*MessageKey` rather than `signInMessageKey`, because story 1.4a writes
  // the second instance of this shape (`organizationMessageKey`) and a reader
  // pinned to the first one would return nothing for it — silently dropping four
  // keys out of the rendered set and weakening the set comparison below by four.
  const signature = /function \w*MessageKey\([\s\S]*?\):([^{]*)\{/.exec(text)?.[1] ?? '';

  return [...signature.matchAll(/'([^']+)'/g)].map((found) => found[1] ?? '');
}

/**
 * Attributes and properties whose string value is structure, not content.
 *
 * An allowlist, not a denylist of the guarded seven: a denylist passes for the
 * attribute nobody thought of, and `label` on a component is user-facing while
 * `name` on an input is not — which is exactly the distinction the ESLint guard
 * cannot make without type information. Here there is a handful of files to
 * read, so naming the permitted set outright is both possible and honest — and
 * every addition to it is a deliberate widening, made in the commit that needs
 * it and proved on both polarities in the detector block below.
 */
const STRUCTURAL_ATTRIBUTES = new Set([
  'className',
  'id',
  'name',
  'type',
  'method',
  'autoComplete',
  'autoCapitalize',
  'autoCorrect',
  'aria-describedby',
  'htmlFor',
  'path',
  'to',
  // ADDED by story 1.3b, and it is a loosening, so it is named rather than
  // waved through: `role` takes a value from a fixed ARIA vocabulary — `alert`,
  // `status`, `dialog` — and never renders. Nothing user-facing can hide in it,
  // which is the test every entry on this list has to pass.
  'role',
  // ADDED by story 1.4a, and it is a loosening, so it is named rather than waved
  // through: `variant` takes a value from `buttonVariants`' own closed set —
  // `default`, `outline`, `secondary`, `ghost`, `link` — and selects a class
  // list, never text. It passes the same test `role` passes: nothing
  // user-facing can hide in it, because a value outside the set is a `tsc`
  // error. Note the sixth member of that set is `destructive`, which is banned
  // separately and by name in every screen, so widening here does not widen
  // that.
  'variant',
  // ADDED by the navigation chrome, and it is a loosening of a GLOBAL
  // allowlist — this set applies to every screen in the application, so it is
  // named and justified rather than waved through, exactly as `role` and
  // `variant` were.
  //
  // `aria-current` takes its value from a CLOSED, NON-TEXTUAL vocabulary the
  // ARIA specification fixes — `page`, `step`, `location`, `date`, `time`,
  // `true`, `false` — and nothing outside it means anything to a screen reader.
  // Nothing user-facing can hide in it, which is the test every entry on this
  // list has to pass. It is also the one attribute the active-destination
  // treatment cannot do without: UX-DR37 wants the current entry signalled
  // without relying on colour, and `aria-current="page"` is the half of that
  // signal a person who cannot see the styling receives.
  //
  // The widening is narrower than it looks in one respect worth naming: the
  // guarded-attribute half of `eslint.config.js`'s L2 block does not include
  // `aria-current` either, and for the same reason — it is a state, not a name.
  // `aria-label` remains guarded in both places.
  'aria-current',
  // ADDED with it, and the argument is one this list already accepted once:
  // `aria-controls` is an ID REFERENCE LIST, exactly like `aria-describedby`
  // three entries up. Its value names elements on the page and renders nowhere,
  // so nothing user-facing can hide in it — and the chrome's collapse needs it,
  // because a disclosure that names no region leaves a screen-reader user with
  // `aria-expanded` and no way to reach what it expanded.
  //
  // The exemption is paid for twice over: the block below resolves every id this
  // attribute names against an element the file actually renders, so an
  // exempted value that points at nothing is still a failure.
  'aria-controls',
]);

/** Content inside a template literal, with every `${…}` removed. */
function templateStaticText(raw: string): string {
  return raw.replace(/\$\{[^}]*\}/g, '');
}

/**
 * String literals that are neither a `t()` key nor a structural value.
 *
 * `t('…')` calls and `import … from '…'` are removed first, so what is left is
 * every remaining literal paired with the name it sits under — or with nothing,
 * which is itself an offence. Both `name="value"` and `name: 'value'` count as
 * sitting under a name: `createRoute`'s `path` is a property, not an attribute,
 * and reading only the JSX form would let an object literal through.
 *
 * BACKTICKS are scanned as well as quotes. The quote-only character class
 * could not see a template literal at all, which is the one string form the
 * ESLint guard needed three selectors to cover — and the shape a `t()`
 * argument widens into when someone reaches for interpolation. A template
 * whose only content is `${…}` is not a hard-coded string and passes.
 */
/**
 * A structural attribute written as an EXPRESSION rather than a quoted value.
 *
 * `aria-describedby={failure === null ? undefined : 'sign-in-error'}` is the
 * same structural value the quoted form carried — an id reference — and it has
 * to be an expression because the element it names renders only on failure.
 * Without this the scan reads the literal as sitting under the name `undefined`
 * and reports an id as user-facing text.
 *
 * A WIDENING, so it is deliberately narrow: only the names already on the
 * allowlist, and only a container with no nested braces of its own. Every other
 * attribute keeps firing in every form, which the detector block below proves
 * on both polarities.
 */
const STRUCTURAL_EXPRESSION = new RegExp(
  `\\b(?:${[...STRUCTURAL_ATTRIBUTES].join('|')})=\\{[^{}]*\\}`,
  'g',
);

function unsanctionedLiterals(text: string): string[] {
  const withoutKeys = text.replace(/\bt\(\s*'[^']+'/g, 't(');
  const withoutStructural = withoutKeys.replace(STRUCTURAL_EXPRESSION, '');
  const withoutImports = withoutStructural.replace(/^\s*import[^;]+;/gm, '');
  const offenders: string[] = [];
  const named = '(?:([A-Za-z-]+)\\s*[=:]\\s*\\{?\\s*)?';

  // A quoted literal cannot contain a raw newline, so `.` is correct here and
  // stops a runaway match spanning half the file.
  for (const found of withoutImports.matchAll(new RegExp(`${named}(['"])(.*?)\\2`, 'g'))) {
    const [, attribute, , value = ''] = found;
    if (attribute !== undefined && STRUCTURAL_ATTRIBUTES.has(attribute)) continue;
    offenders.push(value);
  }

  // A template literal may span lines, so this one is deliberately greedy over
  // newlines and non-greedy over backticks.
  for (const found of withoutImports.matchAll(new RegExp(`${named}\`([\\s\\S]*?)\``, 'g'))) {
    const [, attribute, raw = ''] = found;
    if (attribute !== undefined && STRUCTURAL_ATTRIBUTES.has(attribute)) continue;
    if (!/[\p{L}\p{N}]/u.test(templateStaticText(raw))) continue;
    offenders.push(raw);
  }

  return offenders;
}

/**
 * A TypeScript type-argument list, which is not JSX however much it looks it.
 *
 * `useRef<HTMLInputElement>(null)` and `Promise<void>` put a `>` and a later
 * `<` in the file with ordinary code between them, so the text scan below read
 * `(null); const passwordField = useRef` as user-facing text and reported four
 * offences on a compliant screen — the same class of false positive the `=>`
 * substitution exists for, and one this file could not have met until a screen
 * held a generic call.
 *
 * The `<` must be preceded by an IDENTIFIER CHARACTER, which is what separates
 * the two: a JSX element's `<` always follows whitespace, `(`, `{` or `>`. The
 * body admits no `<` or `>` of its own, so nested generics need another pass,
 * and it admits no `=`, so a JSX opening tag with attributes can never match.
 */
const TYPE_ARGUMENTS = /(?<=[A-Za-z0-9_$])<[A-Za-z0-9_$.,|&\s[\]'"]*>/g;

function stripTypeArguments(text: string): string {
  // To a fixed point, for `useState<Record<string, string>>`. Each pass only
  // ever shortens the text, so it terminates.
  let previous = text;

  for (;;) {
    const next = previous.replace(TYPE_ARGUMENTS, '');

    if (next === previous) return next;

    previous = next;
  }
}

/**
 * JSX text runs: everything between a `>` and the next `<`.
 *
 * `=>` is neutralized first, or an arrow function's body would read as a text
 * run, and so are type-argument lists (above). A run holding a brace is an
 * expression container rather than text, so `{t('auth.heading')}` is correctly
 * not text at all.
 */
function jsxTextWithContent(text: string): string[] {
  return [...stripTypeArguments(text).replace(/=>/g, '__').matchAll(/>([^<>{}]+)</g)]
    .map((found) => found[1] ?? '')
    .filter((run) => /[\p{L}\p{N}]/u.test(run));
}

/**
 * The key a screen's `<h1>` renders, or `null`.
 *
 * Added by story 1.4a, when a destination stopped being a heading and nothing
 * else: source order was standing in for "the heading is the destination's own
 * label", and the two came apart the moment a screen rendered eight strings.
 * Whitespace-tolerant, because a long key puts the call on its own line.
 */
function headingKey(text: string): string | null {
  return /<h1\b[^>]*>\s*\{t\('([^']+)'\)\}/.exec(text)?.[1] ?? null;
}

/** `htmlFor` values, in source order. */
function labelTargets(text: string): string[] {
  return [...text.matchAll(/htmlFor="([^"]+)"/g)].map((found) => found[1] ?? '');
}

/** Every `<Input …/>` element's attribute block. */
function inputElements(text: string): string[] {
  return [...text.matchAll(/<Input\b([\s\S]*?)\/>/g)].map((found) => found[1] ?? '');
}

/**
 * Every BARE `<input …/>` element's attribute block — lowercase only.
 *
 * Added by story 1.4b. The logo's file picker is a plain `<input type="file">`
 * rather than the shadcn primitive, so `inputElements` above does not see it
 * (its pattern is capital-`I` `<Input`) and neither does any sweep built on it.
 * That is deliberate — what a pointer meets is a `<Button>` — but it means the
 * one control on this screen that carries a file is guarded by NOTHING unless
 * it is read separately, which is what this exists for.
 */
function bareInputElements(text: string): string[] {
  return [...text.matchAll(/<input\b([\s\S]*?)\/>/g)].map((found) => found[1] ?? '');
}

/** Every `<Button …>` opening tag's attribute block. */
function buttonElements(text: string): string[] {
  return [...text.matchAll(/<Button\b([^>]*?)\/?>/g)].map((found) => found[1] ?? '');
}

/**
 * Every `<nav …>…</nav>` block, opening tag to closing tag.
 *
 * Added because COUNTING the chrome's controls says nothing about WHERE they
 * are. Two bars render from the same two variables, and deleting `{exit}` from
 * one of them leaves the `<Link>` count at one, `expectedControls` at three, and
 * every responsive-class assertion untouched — a phone build with navigation and
 * no way to sign out, green. The only thing that notices is reading each bar's
 * contents, which is what this extracts.
 *
 * Non-greedy, which is correct here and would not be if a `<nav>` were ever
 * nested inside another; the consumer asserts the count, so that day fails
 * loudly rather than silently merging two bars into one.
 */
function navBlocks(text: string): string[] {
  return [...text.matchAll(/<nav\b[\s\S]*?<\/nav>/g)].map((found) => found[0]);
}

/**
 * Every value an `aria-current` attribute can take, in either syntax.
 *
 * The attribute is on `STRUCTURAL_ATTRIBUTES` above, which EXEMPTS it from the
 * literal sweep on every screen in the application — and the argument that
 * earned the exemption was that its vocabulary is closed and non-textual. That
 * argument is only true while it is enforced: `aria-current="Danas"` is a
 * user-facing literal sitting in the one attribute nothing else now looks at.
 * This is what looks at it.
 */
function ariaCurrentValues(text: string): string[] {
  return [...text.matchAll(/aria-current=(?:"([^"]*)"|\{([^}]*)\})/g)].flatMap((found) => {
    const literal = found[1];

    if (literal !== undefined) return [literal];

    return [...(found[2] ?? '').matchAll(/'([^']*)'/g)].map((quoted) => quoted[1] ?? '');
  });
}

/**
 * Every `<Link …>` opening tag's attribute block.
 *
 * Added by the navigation chrome, and it is a THIRD control detector rather than
 * a widening of the two above, deliberately. A router link is not a `<Button>`
 * and must not be counted as one — `expectedControls` on every other screen is a
 * tight number, and folding links into it would loosen all of them to cover one
 * file. What a link shares with a button is the only thing asserted through it:
 * a person taps it, so UX-DR40's floor applies.
 *
 * Every consumer of this brings its own length assertion. Both element regexes
 * above are non-vacuously guarded by each of theirs, and copying one without
 * that guard is precisely how a sweep goes quiet.
 */
function linkElements(text: string): string[] {
  return [...text.matchAll(/<Link\b([^>]*?)\/?>/g)].map((found) => found[1] ?? '');
}

function attributeOf(element: string, name: string): string | null {
  return new RegExp(`${name}="([^"]+)"`).exec(element)?.[1] ?? null;
}

/**
 * An `aria-describedby` value split into the ids it actually names.
 *
 * The attribute is an ID REFERENCE LIST — space-separated, any amount of
 * whitespace — and reading it as one id was correct only while there was one
 * description to point at. `null` in, empty out, so an absent attribute cannot
 * masquerade as an id and be "found" in a source file that mentions nothing.
 */
function idTokens(value: string | null): string[] {
  return (value ?? '').split(/\s+/).filter((token) => token !== '');
}

/**
 * Every id an element's `aria-describedby` can name, in either syntax.
 *
 * The attribute became CONDITIONAL — the element it points at renders only on
 * failure, and a reference to an absent id is silently ignored, so the static
 * form described a control by something that was not on the page in the common
 * case. `attributeOf` reads `name="…"` only, so it returns `null` for the
 * expression form and the old assertion failed a screen that was correct.
 *
 * Both branches of the expression are collected, because both are shipped:
 * every id NAMED anywhere in the attribute must resolve, whichever branch put
 * it there.
 */
function describedByIds(element: string): string[] {
  const literal = attributeOf(element, 'aria-describedby');

  if (literal !== null) return idTokens(literal);

  const expression = /aria-describedby=\{([^}]*)\}/.exec(element)?.[1];

  if (expression === undefined) return [];

  return [...expression.matchAll(/'([^']*)'/g)].flatMap((found) => idTokens(found[1] ?? ''));
}

/**
 * The tallest height a className can be shown to set, in CSS pixels.
 *
 * Returns `null` rather than 0 when it can prove nothing, so "no height class
 * at all" and "a height class of zero" cannot be confused — the mutation that
 * found this gap deleted the class outright.
 */
function heightPx(className: string | null): number | null {
    if (className === null) return null;

    const found: number[] = [];
    for (const match of className.matchAll(/(?:^|\s)(?:min-)?h-(\d+(?:\.\d+)?)(?=\s|$)/g)) {
      found.push(Number(match[1]) * SPACING_STEP_PX);
    }
    for (const match of className.matchAll(/(?:^|\s)(?:min-)?h-\[(\d+(?:\.\d+)?)(px|rem)\]/g)) {
      found.push(Number(match[1]) * (match[2] === 'rem' ? ROOT_FONT_PX : 1));
    }

    return found.length === 0 ? null : Math.max(...found);
}

/** Every leaf key path in the resource file, dotted the way i18next resolves. */
function resourceKeys(): string[] {
  const walk = (node: unknown, prefix: string): string[] => {
    if (typeof node !== 'object' || node === null) return [prefix];

    return Object.entries(node).flatMap(([key, value]) =>
      walk(value, prefix === '' ? key : `${prefix}.${key}`),
    );
  };

  return walk(JSON.parse(readFileSync(RESOURCE, 'utf8')), '');
}

/**
 * Every source that contributes a key, with the reader that finds them in it.
 *
 * The reader is named per entry rather than assumed, because they are not the
 * same shape: a screen renders `t('key')`, and the message mapping declares its
 * keys as a return-type union in a `.ts` module that renders nothing. Both are
 * "a key this application can put on screen", and the set comparison below is
 * only true if both are read.
 */
const KEY_SOURCES = [
  { name: 'the sign-in screen', file: SCREEN, keys: translationKeys, strings: 5 },
  { name: 'the not-found component', file: NOT_FOUND, keys: translationKeys, strings: 2 },
  { name: 'the organization prompt', file: ORGANIZATION, keys: translationKeys, strings: 3 },
  { name: 'the signed-in placeholder', file: HOME, keys: translationKeys, strings: 1 },
  { name: 'the failure-to-message mapping', file: MESSAGE_KEYS, keys: messageKeyUnion, strings: 2 },
  // TWELVE on the settings surface: its own `nav.organizacija` heading, five
  // field labels, the save and cancel actions, the logo's own label, the choose
  // action — rendered TWICE, once as the button's text and once as the hidden
  // file input's `aria-label`, because the two controls are one affordance and
  // a screen reader must hear the same word the eye sees — and
  // `nav.organizacija` a second time, as the neutral mark's accessible name for
  // the unreachable case where the organization's own name is blank. The set
  // comparison below dedupes, so twelve `t()` calls over ten keys is correct
  // rather than a count that drifted.
  //
  // The refusal is NOT among them — it reaches `t()` through
  // `organizationMessageKey`, which is the next entry, for the reason the
  // sign-in refusals do: a ternary over codes written in a `.tsx` is executed
  // by nothing.
  { name: 'the organization settings surface', file: SETTINGS, keys: translationKeys, strings: 12 },
  {
    // TEN since story 1.4b, and one function rather than two: the surface
    // shows exactly one message region, so a second mapping would need a
    // screen-side ternary choosing between them — the executed-by-nothing
    // branch this entry exists to abolish.
    name: 'the organization failure-to-message mapping',
    file: ORGANIZATION_MESSAGE_KEYS,
    keys: messageKeyUnion,
    strings: 10,
  },
  // SIX literal keys on the chrome — the navigation landmark's name twice (one
  // per bar), the collapse's two state-dependent names, the exit and the retry —
  // and that count is smaller than what the chrome RENDERS, which is the
  // interesting part. The eight destination labels reach `t()` as
  // `t(destination.key)`, read off `@/navigation/destinations` rather than
  // written here, so `translationKeys` finds none of them and must not: a chrome
  // that named its own keys would be a ninth copy of the destination list, and
  // the whole reason that table is data is that a test can execute it. The eight
  // stay in the set comparison below because the eight destination screens each
  // render their own heading.
  { name: 'the navigation chrome', file: CHROME, keys: translationKeys, strings: 6 },
  {
    // TWO, for three role codes and one sign-out code. The collapse is the
    // decision `messages.test.ts` executes; what this count pins is that there
    // are exactly two messages to collapse into, so a third failure that quietly
    // grew its own message has to be justified here first.
    name: 'the chrome failure-to-message mapping',
    file: NAVIGATION_MESSAGE_KEYS,
    keys: messageKeyUnion,
    strings: 2,
  },
  // ONE each, exactly. The seven together are what make the set comparison
  // below hold once `hr.json` gained eight `nav.*` keys: a key declared and
  // never rendered is a string nobody reviewed, and a destination rendering two
  // keys is a screen this story did not sanction.
  ...DESTINATION_SCREENS.map((destination) => ({
    ...destination,
    keys: translationKeys,
    strings: 1,
  })),
];

describe('the screen is read at all, so every sweep below means something', () => {
  // Vacuous-pass guard. A renamed or moved file would make each "contains no"
  // assertion hold against nothing.
  it.each(SCREENS)('finds $name and finds JSX in it', ({ file }) => {
    expect(source(file).length).toBeGreaterThan(200);
    expect(source(file)).toContain('return (');
  });

  it('finds the controls it is about to measure', () => {
    expect(inputElements(source(SCREEN))).toHaveLength(2);
    expect(buttonElements(source(SCREEN))).toHaveLength(1);
  });
});

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

describe('the route skeleton is the one the destination table describes', () => {
  /**
   * Four hand-written copies of the eight destinations exist — the router, the
   * destination table, `hr.json`, and this file's slug list — and only pinning
   * them to each other makes the set of eight a single fact.
   */

  it('partitions the destinations into placeholders and built screens, with no overlap', () => {
    // The split story 1.4a introduced. A destination that fell out of BOTH lists
    // would keep the assertion below green — it reads the union — while escaping
    // the per-file counts, which read the two lists separately.
    expect(PLACEHOLDER_SLUGS.filter((slug) => BUILT_SLUGS.includes(slug))).toEqual([]);
    expect(PLACEHOLDER_SLUGS.length + BUILT_SLUGS.length).toBe(DESTINATION_SLUGS.length);
    expect(BUILT_SLUGS.length, 'nothing is built, so the split asserts nothing').toBeGreaterThan(0);
  });

  it('sweeps exactly the destinations the table names', () => {
    // P7's gap. Every sweep in this file reads `DESTINATION_SCREENS`, so a
    // ninth destination added to the router and the table but not here would
    // ship with no control count, no tap-target floor, no literal sweep and no
    // key count — and nothing in this file would be red, because nothing in
    // this file would know it existed.
    expect([...DESTINATION_SLUGS].sort()).toEqual(
      DESTINATIONS.map((destination) => destination.path.slice(1)).sort(),
    );
  });

  it.each(DESTINATIONS)('renders $key on the file that owns $path', ({ key, path }) => {
    // WHAT NOTHING ELSE BINDS. `danas.tsx` rendering `nav.kalendar` while
    // `kalendar.tsx` renders `nav.danas` satisfies every other assertion in this
    // repository: the per-file count is one either way, the rendered-vs-declared
    // set comparison is unchanged because both keys are still rendered
    // somewhere, and `router.test.ts`'s identity checks pin the component a
    // route renders, never the key that component renders. `/danas` would show
    // "Kalendar" with the whole suite green.
    //
    // The file is derived from the PATH rather than named, so this also pins
    // the third link in the chain: the route path, the file that owns it, and
    // the key that file renders are one fact in three places.
    const file = join(srcRoot, 'routes', `${path.slice(1)}.tsx`);
    const screen = source(file);

    // READ OFF THE `<h1>`, not off source order, since story 1.4a. Seven of the
    // eight render exactly one string, so `toEqual([key])` and "the heading is
    // the key" were the same assertion for them; the settings surface renders
    // eight, and the one that has to be the destination's own is the HEADING —
    // a screen whose `<h1>` drifted to some other key is a page titled something
    // the navigation does not call it. Their per-file exact counts in
    // `KEY_SOURCES` keep the other seven as tight as they were.
    expect(headingKey(screen), `${path} does not title itself ${key}`).toBe(key);
    expect(translationKeys(screen), `${path} never renders ${key}`).toContain(key);
  });
});

describe('the signed-in layout renders its outlet', () => {
  it('renders an Outlet, not merely a container', () => {
    // MUTATION-PROVEN GAP. `_app.tsx` is in `localization-applied.test.ts`'s
    // `SOURCES` for build FRESHNESS only and in no source sweep, and
    // `router.test.ts` pins the component by identity — which says the layout
    // renders `AppLayout`, never what `AppLayout` renders. Replacing its body
    // with a plain `<div>` leaves the entire suite green while all eight
    // destinations render an empty shell at HTTP 200: every path still
    // resolves, every guard still runs, and nothing reaches the screen.
    //
    // Comment-blind, like every read in this file, so the header's own prose
    // about the outlet cannot satisfy it.
    const layout = source(LAYOUT);

    expect(layout, 'the layout renders no <Outlet>, so every destination is a blank page').toContain(
      '<Outlet',
    );
    expect(layout, 'the layout does not import Outlet from the router').toMatch(
      /import\s*\{[^}]*\bOutlet\b[^}]*\}\s*from\s*'@tanstack\/react-router'/,
    );
  });

  it('mounts the chrome around it, which is the whole deliverable of part B', () => {
    // MUTATION-PROVEN GAP, and the widest one this story shipped. Reverting this
    // layout to `<div className="flex flex-1 flex-col"><Outlet /></div>` and
    // deleting the import passed the ENTIRE root suite — 1055 tests — with no
    // navigation, no sign-out and no chrome anywhere in the application. Every
    // assertion about `chrome.tsx` reads `chrome.tsx`, and nothing read the one
    // line that puts it on screen.
    //
    // Both halves are needed and neither implies the other: an import with no
    // element renders nothing, and an element with no import does not build.
    const layout = source(LAYOUT);

    expect(layout, 'the layout does not import the chrome').toMatch(
      /import\s*\{[^}]*\bAppChrome\b[^}]*\}\s*from\s*'@\/navigation\/chrome'/,
    );
    expect(layout, 'the layout never renders the chrome').toContain('<AppChrome>');
  });

  it('puts the outlet INSIDE the chrome, not beside it', () => {
    // The shape the assertion above passes for: `<><AppChrome /><Outlet /></>`
    // imports the chrome, renders it, and renders every destination outside it —
    // a navigation bar with no page attached to it. What must be true is
    // structural, so it is read structurally: the returned block's OUTERMOST
    // element is the chrome, and the outlet is nested within.
    const returned = (/return \(([\s\S]*?)\n {2}\);/.exec(source(LAYOUT))?.[1] ?? '').trim();

    expect(returned, 'no returned JSX block on the layout').not.toBe('');
    expect(returned.startsWith('<AppChrome>'), `the layout's outermost element is not the chrome: ${returned}`).toBe(
      true,
    );
    expect(returned.endsWith('</AppChrome>'), 'the chrome does not close around the whole tree').toBe(
      true,
    );
    expect(
      returned.indexOf('<Outlet'),
      'the outlet is not nested inside the chrome',
    ).toBeGreaterThan(returned.indexOf('<AppChrome>'));
  });

  it('renders the outlet unconditionally, not behind a branch', () => {
    // The shape the assertion above passes for: `{signedIn ? <Outlet /> : null}`
    // contains `<Outlet` and renders nothing in the case that matters. The
    // layout's whole job is to be transparent — the guard decides, and what
    // survives the guard renders.
    const layout = source(LAYOUT);
    const returned = /return \(([\s\S]*?)\n {2}\);/.exec(layout)?.[1] ?? '';

    expect(returned, 'no returned JSX block on the layout').not.toBe('');
    expect(returned, 'the outlet is behind a branch').not.toMatch(/[?]|&&/);
    expect(returned).toContain('<Outlet');
  });
});

describe('the chrome the layout wraps every destination in', () => {
  /**
   * THE NAVIGATION SHELL, PART B. Part A registered eight destinations and the
   * table that maps roles to them and shipped no way to reach any of them; this
   * is the component that calls `destinationsFor`, and it renders above every
   * signed-in screen in the application.
   *
   * Source-level, like everything else here, because AD-15 bans jsdom. What that
   * leaves assertable is exactly what a mutation can break silently: which table
   * the links come from, WHERE each control is placed rather than merely how
   * many there are, whether the active entry is signalled by anything but
   * colour, whether a failed role read says so or merely renders nothing, and
   * whether the exit goes through the module a node test can execute.
   */

  it('renders one list of links, not one per layout', () => {
    // NON-VACUITY for every assertion below, and a claim in its own right. Two
    // `<Link>` blocks — one for the tab bar, one for the sidebar — is two copies
    // of the destinations, their order, their icons and their active treatment,
    // and copies drift. ONE element rendered into two containers cannot.
    expect(
      linkElements(source(CHROME)),
      'the chrome renders its destinations from more than one place',
    ).toHaveLength(1);
  });

  it('puts the destinations AND the exit in both bars, not merely somewhere', () => {
    // MUTATION-PROVEN GAP, and the demonstration is the reason this block exists
    // at all: deleting `{exit}` from the phone `<nav>` alone left the `<Link>`
    // count at one, `expectedControls` at three and every responsive-class
    // assertion untouched — 327 tests green on a phone build with navigation and
    // no way to sign out, on the device this story's whole argument is built
    // around. Counting controls says nothing about where they are.
    const bars = navBlocks(source(CHROME));

    // NON-VACUITY, and specifically the count rather than "more than zero": one
    // bar is the mutation where a whole layout was deleted, and three is a `<nav>`
    // nested inside another, which the non-greedy extraction above would report
    // wrongly.
    expect(bars, 'the chrome does not render exactly two navigation bars').toHaveLength(2);

    for (const bar of bars) {
      expect(bar, `a navigation bar renders no destinations: ${bar}`).toContain('{destinations}');
      expect(bar, `a navigation bar renders no exit: ${bar}`).toContain('{exit}');
    }
  });

  it('keeps the exit outside the collapsible region, so collapsing cannot strand anybody', () => {
    // At and above 640px the tab bar is hidden, so the sidebar is the ONLY
    // chrome — and with the exit inside the collapsible region, collapsing took
    // the way out of the application with it. The collapse resets on reload, so
    // the way back was a page refresh nobody would think to try.
    //
    // Read as a containment question rather than a class question: what the
    // collapse hides is the element `aria-controls` names, so the exit must not
    // be inside it.
    const chrome = source(CHROME);
    const collapsible = /<div\s+id="app-destinations"[\s\S]*?<\/div>/.exec(chrome)?.[0] ?? '';

    expect(collapsible, 'no collapsible region to read').not.toBe('');
    expect(collapsible, 'the collapsible region holds no destinations').toContain('{destinations}');
    expect(
      collapsible,
      'the exit is inside the collapsible region, so collapsing hides the way out',
    ).not.toContain('{exit}');
    expect(
      collapsible,
      'the region is not actually collapsed by the toggle state',
    ).toMatch(/className=\{expanded \?/);
  });

  it('reclaims space when it collapses, rather than hiding a list inside a fixed width', () => {
    // The sidebar kept `w-56` in both states, so the toggle hid the list and
    // moved not one pixel of layout — a control that visibly does nothing, which
    // is the dead affordance the voice rules exist to prevent. The width belongs
    // to the list, so collapsing takes it with it.
    const chrome = source(CHROME);
    const aside = /<aside\b[^>]*>/.exec(chrome)?.[0] ?? '';

    expect(aside, 'no <aside> to read').not.toBe('');
    expect(aside, 'the sidebar fixes its own width, so collapsing reclaims nothing').not.toMatch(
      /\bw-\d+/,
    );
  });

  it('gives the destination links the same 44 px floor every control has', () => {
    // The general sweep over `SCREENS` measures `<Input>` and `<Button>` and
    // structurally cannot see a `<Link>` — so the eight controls a person
    // actually navigates with were measured by nothing until this line. The
    // mutation is one character: drop `h-11` and every entry falls to whatever
    // the flex row gives it.
    const links = linkElements(source(CHROME));

    expect(links.length, 'no link detected on the chrome').toBeGreaterThan(0);
    for (const link of links) {
      const measured = heightPx(attributeOf(link, 'className'));

      expect(measured, `a destination link declares no usable height class: ${link}`).not.toBeNull();
      expect(measured).toBeGreaterThanOrEqual(TARGET_FLOOR_PX);
    }
  });

  it('signals the active destination by aria-current AND by something that is not colour', () => {
    // UX-DR37 and Q21: no meaning by colour alone. BOTH halves are asserted,
    // because each is invisible to the other — `aria-current` alone is a state
    // nobody sighted can see, and a bold entry alone is a state nobody using a
    // screen reader can hear.
    //
    // The treatment is keyed off the attribute itself (`aria-[current=page]:`),
    // which is what stops the two from disagreeing: there is one condition, not
    // two that happen to be written the same way today.
    const link = linkElements(source(CHROME))[0] ?? '';
    const className = attributeOf(link, 'className') ?? '';

    expect(link, 'the chrome never marks the current destination').toMatch(/aria-current=\{/);
    expect(
      /aria-\[current=page\]:(?:font-bold|font-semibold|underline)/.test(className),
      'the active entry is distinguished by colour alone',
    ).toBe(true);
  });

  it('matches a destination and its descendants, not the exact path alone', () => {
    // Every destination is a SECTION. `pathname === destination.path` drops the
    // current-destination signal — and `aria-current` with it — on the first
    // child route, which Epic 2's day view under `Kalendar` adds, so this breaks
    // on arrival rather than hypothetically. The rule itself is executed in
    // `destinations.test.ts`; what is asserted here is that the chrome routes
    // through it rather than comparing strings of its own.
    const link = linkElements(source(CHROME))[0] ?? '';

    expect(
      link,
      'the active entry is decided by an equality this component wrote itself',
    ).toMatch(/aria-current=\{[^}]*isCurrentDestination\(pathname,[^}]*\}/);
    expect(source(CHROME), 'the chrome compares pathnames by hand').not.toMatch(
      /pathname === destination\.path/,
    );
  });

  it('renders the destinations the role reaches, never the whole table', () => {
    // MUTATION-PROVEN SHAPE. `DESTINATIONS` in place of `destinationsFor(role)`
    // type-checks, lints, renders, and shows a member every admin destination —
    // with `destinations.test.ts` still green, because that file executes the
    // TABLE and never sees what renders it.
    const chrome = source(CHROME);

    expect(chrome, 'the chrome does not filter the destinations by role at all').toContain(
      'destinationsFor(',
    );
    expect(
      chrome,
      'the chrome renders the whole destination table rather than the role’s own',
    ).not.toContain('DESTINATIONS');
  });

  it('holds no permission level of its own', () => {
    // The other half of the claim above. The chrome CONSUMES a role and decides
    // nothing about it: a branch on `'admin'` written here would be a second
    // place the member/admin split lives, unexecutable by any test (AD-15), and
    // free to disagree with the table that `destinations.test.ts` runs.
    const chrome = source(CHROME);

    for (const forbidden of ["'admin'", "'member_role'", 'memberRoleOf(']) {
      expect(chrome, `the chrome branches on ${forbidden} instead of consuming the role`).not.toContain(
        forbidden,
      );
    }
  });

  it('reports a role it could not read rather than rendering an empty bar', () => {
    // THE acceptance criterion this file can carry. An unrecognised or
    // unreadable role must not render as an empty navigation, because an empty
    // navigation is byte-identical to what a member with no access would see.
    // The message is what tells them apart, and it reaches `t()` through the
    // mapping a node test executes rather than a ternary over codes.
    const chrome = source(CHROME);

    expect(chrome, 'the chrome renders no alert at all').toContain('role="alert"');
    expect(chrome, 'the chrome does not render its message through the mapping').toContain(
      't(navigationMessageKey(',
    );
    for (const code of ['MEMBER_ROLE_REFUSED', 'MEMBER_ROLE_UNRECOGNISED', 'shell.error.']) {
      expect(chrome, `${code} is branched on in the chrome`).not.toContain(code);
    }
  });

  it('treats a query that ERRORED as a failure too, not as an empty bar', () => {
    // THE THIRD OUTCOME, and the one a first draft misses. `readMemberRole`
    // folds every failure it knows about into `{ ok: false, code }`, which
    // `useQuery` files as a resolved value — but the queryFn can still throw
    // before reaching it, and a chrome reading only `data` then has no role AND
    // no refusal: an empty bar with no message, the exact state this component
    // is written to make impossible.
    const chrome = source(CHROME);

    expect(chrome, 'the errored query state is read nowhere').toContain('member.isError');
    expect(
      chrome,
      'an errored query produces no failure code, so it renders as an empty bar',
    ).toMatch(/member\.isError[\s\S]{0,120}?MEMBER_ROLE_UNAVAILABLE/);
  });

  it('gives the failed read something to press, since nothing retries it', () => {
    // A failure resolves as DATA rather than as a throw, so TanStack Query files
    // it as settled: no retry, no refetch on focus, nothing that recovers on its
    // own. A message that says a thing is temporarily unavailable, on a screen
    // with no way to ask again, is the dead affordance the voice rules exist to
    // prevent — and it is also the path back for an account an administrator has
    // just reactivated.
    const chrome = source(CHROME);

    expect(chrome, 'nothing on screen re-reads the role').toContain('member.refetch()');
    expect(chrome, 'the retry is not offered to the person').toContain("t('shell.retry')");
    // Offered for the ROLE failure only: a refused sign-out already has its
    // retry in the exit itself, re-enabled by the handler's `finally`.
    expect(chrome, 'the retry is offered for a failure it cannot help').toMatch(
      /roleFailure === null \?/,
    );
  });

  it('moves focus to the refusal and clears it on the next destination', () => {
    // TWO defects in one region. `role="alert"` reaches assistive technology on
    // insertion and reaches a sighted phone user not at all — the exit is at the
    // bottom of the viewport and the message renders at the top of the content
    // column, off screen at the moment of the press. And a failure that only
    // cleared on the next attempt followed the person onto every destination for
    // the rest of the session, sitting in front of a later role failure that
    // nothing would then have shown.
    const chrome = source(CHROME);

    expect(chrome, 'the refusal cannot receive focus').toMatch(/tabIndex=\{-1\}/);
    expect(chrome, 'nothing moves focus to the refusal').toMatch(
      /failure !== null[\s\S]{0,80}?\.focus\(\)/,
    );
    expect(chrome, 'a refusal is never cleared by navigating away').toMatch(
      /setFailure\(null\);\s*\n\s*\}, \[pathname\]\)/,
    );
  });

  it('offers both layouts, and exactly one of them at any width', () => {
    // Two layouts, one architecture: bottom tabs below 640px, a sidebar at and
    // above it. Asserted as the PAIR of responsive classes, because either one
    // alone is a chrome that disappears at half the widths the application is
    // used at — and the phone half is the one nobody testing on a laptop meets.
    const chrome = source(CHROME);

    expect(chrome, 'the tab bar is not hidden once the sidebar appears').toContain('sm:hidden');
    expect(chrome, 'the sidebar is not hidden below the breakpoint').toMatch(/hidden[^"]*sm:flex/);
  });

  it('names both navigation landmarks, and clears the phone’s own bottom inset', () => {
    // Accessibility labels are definition-of-done in this project, and two
    // anonymous `<nav>` landmarks are two regions announced as "navigation" with
    // nothing to tell a reader which one they are in. The same name on both is
    // correct rather than lazy: they are mutually exclusive by media query, so
    // only ever one is in the accessibility tree.
    //
    // The inset is the same claim in the physical dimension: the bar is
    // `sticky`, so content scrolls UNDER it, and on a phone with a home
    // indicator the bar itself sits under the system gesture area.
    const chrome = source(CHROME);
    const bars = navBlocks(chrome);

    expect(bars).toHaveLength(2);
    for (const bar of bars) {
      expect(bar, `a navigation landmark carries no name: ${bar}`).toMatch(
        /aria-label=\{t\('shell\.navigation'\)\}/,
      );
    }
    expect(chrome, 'the sticky bar ignores the phone’s bottom inset').toContain(
      'env(safe-area-inset-bottom',
    );
    expect(chrome, 'nothing clears the sticky bar, so content scrolls under it unreachably').toMatch(
      /pb-\[calc\(4rem/,
    );
  });

  it('names the region the collapse controls, and renders that region', () => {
    // `aria-expanded` says a thing opened; `aria-controls` says WHICH thing, and
    // without it a screen-reader user is told something expanded and given no
    // way to reach it. Asserted as a RESOLVING reference, not merely a present
    // attribute — a reference to an absent id is ignored in silence, which is
    // worse than no reference because the source-level lookup passes either way.
    const chrome = source(CHROME);
    const toggle = buttonElements(chrome).find((element) => element.includes('aria-expanded'));

    expect(toggle, 'nothing on the chrome is a disclosure at all').not.toBeUndefined();

    const controls = attributeOf(toggle ?? '', 'aria-controls');

    expect(controls, 'the collapse names no region').not.toBeNull();
    expect(chrome, `no element carries id="${String(controls)}"`).toContain(
      `id="${String(controls)}"`,
    );
    // And its NAME changes with its state. A disclosure whose name reads the
    // same in both directions leaves `aria-expanded` as the only signal —
    // inaudible to anybody not using assistive technology, invisible to
    // everybody else.
    expect(toggle, 'the collapse never announces which state it is in').toContain('aria-expanded=');
    expect(chrome, 'the collapse reads the same in both states').toMatch(
      /expanded \? t\('shell\.menuHide'\) : t\('shell\.menuShow'\)/,
    );
  });

  it('announces the exit as busy rather than renaming it mid-press', () => {
    // The opposite decision to the collapse's, and deliberately: a disclosure
    // has two states and a name that says which one the press produces, while
    // this has one action. A control whose NAME changes under the pointer is a
    // control voice control can no longer be told to press, so the state travels
    // on `aria-busy` and `disabled` instead — which also takes it out of the tab
    // order while the revocation is in flight.
    const exit =
      buttonElements(source(CHROME)).find((element) => element.includes('onClick={startSignOut}')) ??
      '';

    expect(exit, 'nothing on the chrome signs anybody out').not.toBe('');
    expect(exit, 'the in-flight state is not announced').toMatch(/aria-busy=\{[^}]+\}/);
    expect(exit, 'the exit stays live while a revocation is in flight').toMatch(
      /disabled=\{[^}]+\}/,
    );
  });

  it('keeps the icon beside the label rather than in place of it', () => {
    // The icon is DECORATION. Every entry carries its Croatian name at every
    // width, and the glyph is `aria-hidden` so the name is announced once rather
    // than twice — an icon with an accessible name of its own is the shape that
    // reads "Home, Danas" and the shape that survives somebody deleting the
    // label.
    const chrome = source(CHROME);

    expect(chrome, 'the destination icon is exposed to assistive technology').toMatch(
      /<Icon\s+aria-hidden/,
    );
    expect(chrome, 'the link renders no label beside its icon').toContain('{t(destination.key)}');
    expect(chrome, 'the icon is chosen in the component rather than by the typed map').toContain(
      'destinationIcon(destination.key)',
    );
  });

  it('persists nothing about the layout', () => {
    // Human decision, 2026-09-16: collapse resets on every load, matching the
    // theme layer's stance. These are shared devices, and a layout one person
    // chose following the next person into their shift is a setting nobody asked
    // for and nobody can find to undo.
    const chrome = source(CHROME);

    for (const forbidden of ['localStorage', 'sessionStorage', 'document.cookie']) {
      expect(chrome, `the chrome persists its layout through ${forbidden}`).not.toContain(forbidden);
    }
    // The POSITIVE half, pinned to the collapse specifically. A bare
    // `useState(` was satisfied by the failure and in-flight hooks this
    // component would hold anyway, so it asserted nothing about the layout at
    // all — the state could have moved to storage with that line still green.
    expect(chrome, 'the collapse is not component state').toMatch(
      /const \[expanded, setExpanded\] = useState\(/,
    );
  });

  it('renders no outlet of its own', () => {
    // The layout owns the one `<Outlet/>` and the chrome takes it as children. A
    // second one renders the destination twice; a conditional one renders it
    // never, behind a guard that already said yes.
    expect(source(CHROME), 'the chrome renders a second outlet').not.toContain('<Outlet');
    expect(source(CHROME), 'the chrome does not render what the layout hands it').toContain(
      '{children}',
    );
  });
});

describe('the exit ends the session and says so when it cannot', () => {
  it('routes through the supabase module rather than calling the client inline', () => {
    // The same claim the sign-in screen carries, on the other direction of the
    // same seam: the outcome mapping is in a `.ts` module a node test executes,
    // and the chrome's job is to reach it.
    const chrome = source(CHROME);

    for (const required of ["from '@/supabase/sign-out'", 'signOut(', 'supabaseClient()']) {
      expect(chrome, `the chrome no longer reaches ${required}`).toContain(required);
    }
    // A BARE `fetch(`, matched with a boundary rather than as a substring. The
    // other screens use `not.toContain('fetch(')`, which is correct there and
    // wrong here: this component calls `member.refetch()` to re-read the role,
    // and a substring check reports that as a hand-assembled request. The
    // boundary is what keeps the sweep about what it means — a request built in
    // a component rather than routed through the `@/supabase` modules.
    expect(chrome, 'the chrome assembles a request of its own').not.toMatch(/(?<![\w.])fetch\(/);
    expect(chrome, 'the chrome builds a client of its own').not.toContain('createClient(');
  });

  it('lands the person on a sign-in route, and only once the session actually ended', () => {
    // MUTATION-PROVEN SHAPE, and the mutation is the tempting one: navigating
    // first and reading the outcome after. A refused sign-out leaves the session
    // live, so a navigation on that path lands on a sign-in route the layout's
    // own guard bounces straight back off — which reads as "the button did
    // nothing" rather than as the failure it is.
    const handler = componentFunction(source(CHROME), 'leave');

    expect(handler, 'no sign-out handler to read').not.toBe('');
    expect(handler, 'a successful sign-out does not navigate to a sign-in route').toMatch(
      /navigate\(\{\s*to:\s*'\/prijava'\s*\}\)/,
    );
    expect(handler, 'the refused branch does not put the returned code on screen').toMatch(
      /!outcome\.ok[\s\S]{0,200}?setFailure\(outcome\.code\)/,
    );
    expect(
      handler.indexOf('setFailure(outcome.code)'),
      'the handler navigates before it has read the outcome',
    ).toBeLessThan(handler.indexOf('navigate('));
  });

  it('empties the query cache with the session, which is the shared-device case', () => {
    // `main.tsx` builds ONE `QueryClient` for the page load and a client-side
    // navigation does not reload the page — so without this, `['member-role']`
    // and `['organization']` survive the sign-out and the next person to sign in
    // on the same device sees the previous member's destinations and the
    // previous organization's snapshot until each refetch settles. On a shared
    // shift-work device that is the exact failure the exit exists to prevent.
    //
    // ONLY ON THE REVOKED PATH: clearing after a refused sign-out would throw
    // away a working session's cache for nothing.
    const handler = componentFunction(source(CHROME), 'leave');

    expect(handler, 'the cache outlives the session').toContain('queryClient.clear()');
    expect(
      handler.indexOf('revoked = true'),
      'the cache is cleared before the session is known to have ended',
    ).toBeLessThan(handler.indexOf('queryClient.clear()'));
  });

  it('does not report a failed navigation as a failed sign-out', () => {
    // The session is GONE at that point. Reporting it as a failure tells
    // somebody "Odjava trenutačno nije moguća" while they are already signed
    // out, on a chrome that still looks signed in — the one thing a sign-out
    // control must never say. The console carries the navigation failure; the
    // screen does not contradict the database.
    const handler = componentFunction(source(CHROME), 'leave');

    expect(handler, 'nothing records whether the revocation actually happened').toContain(
      'let revoked = false',
    );
    expect(handler, 'the catch reports every failure as a failed sign-out').toMatch(
      /if \(!revoked\) setFailure\(SIGN_OUT_FAILED\)/,
    );
  });

  it('guards on a ref and clears the in-flight flag on every path', () => {
    // The two defects every handler in this application is swept for: a guard on
    // React state is stale inside a handler already called once this tick, so a
    // double press starts two revocations; and clearing the flag outside a
    // `finally` leaves the control dead after the first refusal, with nothing on
    // screen to say why.
    const handler = componentFunction(source(CHROME), 'leave');
    const block = finallyBlock(source(CHROME));

    expect(handler, 'the sign-out handler has no in-flight guard').toMatch(
      /if\s*\([\s\S]*?leaving\.current[\s\S]*?\)\s*\{?\s*return;/,
    );
    expect(block, 'the sign-out handler has no finally, so a path can leave it in flight').not.toBe(
      '',
    );
    expect(block, 'the finally does not re-enable the control').toContain('setPending(false)');
    expect(block, 'the finally does not clear the in-flight ref').toContain(
      'leaving.current = false',
    );
    expect(handler, 'nothing is surfaced when the call throws outside its own mapping').toMatch(
      /catch[\s\S]{0,400}?setFailure\(/,
    );
  });

  it('logs the cause it cannot render', () => {
    // The catch that swallows `SUPABASE_ENVIRONMENT_MISSING` is how a
    // misconfiguration reads as an outage — the failure `client.ts` exists to
    // prevent and that `prijava.tsx` reintroduced once already.
    expect(source(CHROME), 'the catch reports nothing to the console').toMatch(
      /catch\s*\([\s\S]{0,400}?console\.error\(/,
    );
  });
});

describe('the keys rendered and the keys declared are the same set', () => {
  /**
   * DEDUPED, which it was not before story 1.3b.
   *
   * `used()` was a sorted concatenation, so a key rendered at two call sites
   * appeared twice and `toEqual` against the declared list failed even though
   * the two SETS were identical — a screen that renders the same message from
   * two branches is an ordinary thing, and the comparison is about sets.
   */
  const used = (): string[] =>
    [...new Set(KEY_SOURCES.flatMap((entry) => entry.keys(source(entry.file))))].sort();

  /** The resource file's screen strings: everything that is not a plural. */
  const declared = (): string[] => resourceKeys().filter((key) => !key.startsWith('count.')).sort();

  it('renders every screen key the resource file declares', () => {
    expect(used()).toEqual(declared());
  });

  it('declares every key the two screens render', () => {
    // The same claim from the other side, and not redundant: `toEqual` on two
    // empty arrays would pass, so this pins both lists non-empty.
    expect(used().length).toBeGreaterThan(0);
    for (const key of used()) expect(resourceKeys()).toContain(key);
  });
});

describe('every control on the screen clears the 44 px tap-target floor', () => {
  /**
   * MUTATION-PROVEN GAP. The inherited primitives are `h-9` — 36 px — and the
   * screen composes `h-11` onto each of them. Deleting all four `h-11` classes
   * left 900 tests green while every control on the one screen nobody can skip
   * dropped 8 px below UX-DR40's floor.
   *
   * The height is asserted on the COMPOSED className rather than on the
   * primitive, because that is where the fix lives: the primitives are
   * inherited byte-verbatim and must not be edited.
   */
  it.each([0, 1])('gives input %i a height of at least 44 px', (index) => {
    const element = inputElements(source(SCREEN))[index] ?? '';
    const measured = heightPx(attributeOf(element, 'className'));

    expect(measured, `input ${index} declares no usable height class`).not.toBeNull();
    expect(measured).toBeGreaterThanOrEqual(TARGET_FLOOR_PX);
  });

  it('gives the submit button a height of at least 44 px', () => {
    const element = buttonElements(source(SCREEN))[0] ?? '';
    const measured = heightPx(attributeOf(element, 'className'));

    expect(measured, 'the submit button declares no usable height class').not.toBeNull();
    expect(measured).toBeGreaterThanOrEqual(TARGET_FLOOR_PX);
  });

  it('gives the not-found link the same floor, since it is also a control', () => {
    const element = buttonElements(source(NOT_FOUND))[0] ?? '';
    const measured = heightPx(attributeOf(element, 'className'));

    expect(measured, 'the not-found link declares no usable height class').not.toBeNull();
    expect(measured).toBeGreaterThanOrEqual(TARGET_FLOOR_PX);
  });

  it.each(SCREENS)('clears the floor on every control in $name', ({ file, expectedControls }) => {
    // The named assertions above are the mutation-proven ones and stay. This is
    // the general claim they cannot make: a control added to any screen later,
    // on any of the four, is measured without anyone remembering to add a case
    // — which is how the organization prompt's own two controls got covered.
    const screen = source(file);

    const controls = [...inputElements(screen), ...buttonElements(screen)];

    // NON-VACUITY. Without this the loop asserts nothing on a screen it finds
    // no controls on, and it already found none on two of the four — so half
    // its cases were passing on an empty set while reading as coverage. It also
    // records the detectors' reach: both match self-closing `<Input />` and
    // `<Button` only, so a raw `<button>` or a future primitive is invisible
    // here and the count is what would notice it disappearing.
    expect(controls.length, `no control detected on ${file}`).toBe(expectedControls);

    for (const element of controls) {
      const measured = heightPx(attributeOf(element, 'className'));

      expect(measured, `a control declares no usable height class: ${element}`).not.toBeNull();
      expect(measured).toBeGreaterThanOrEqual(TARGET_FLOOR_PX);
    }
  });
});

describe('the boundary the theme layer raised is the one the control draws', () => {
  /**
   * MUTATION-PROVEN GAP, and the same shape as story 1.1b's original loopback.
   * `--input` was raised to 3.23:1 for WCAG 1.4.11 and measured in
   * `test/theme-contrast.test.ts`; changing one class in `input.tsx` from
   * `border-input` to `border-border` left every ratio true of a token that
   * nothing on screen consumed, with the whole suite green.
   *
   * `test/theme-applied.test.ts` holds the other half — that the BUILT sheet
   * emits a `.border-input` rule. This is the source-level half, so a
   * build-less checkout still refuses the mutation.
   */
  it('draws the text input boundary from --input', () => {
    const primitive = source(INPUT_PRIMITIVE);

    expect(
      primitive,
      'input.tsx no longer names border-input — the raised token is not the one the control draws',
    ).toContain('border-input');
  });

  it('does not draw it from --border, which is pinned below AA on purpose', () => {
    expect(source(INPUT_PRIMITIVE)).not.toContain('border-border');
  });
});

describe('both credential fields carry an accessible name', () => {
  it('gives every input a label bound by htmlFor', () => {
    const screen = source(SCREEN);
    const targets = labelTargets(screen);
    const inputs = inputElements(screen);

    expect(inputs).toHaveLength(2);
    expect(targets).toHaveLength(2);
    for (const input of inputs) {
      const id = attributeOf(input, 'id');

      expect(id, `an <Input> carries no id, so no <Label> can name it`).not.toBeNull();
      expect(targets, `no <Label htmlFor> points at ${String(id)}`).toContain(id);
    }
  });

  it('gives the two fields distinct ids', () => {
    // Two inputs sharing one id satisfies the assertion above — every id is
    // pointed at by some label — while one field goes unnamed and the other is
    // named twice.
    const ids = inputElements(source(SCREEN)).map((input) => attributeOf(input, 'id'));

    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain(null);
  });

  it('points every htmlFor at an input that exists', () => {
    // The other direction. A label whose `htmlFor` names nothing is announced
    // as an orphan and names no control at all.
    const ids = inputElements(source(SCREEN)).map((input) => attributeOf(input, 'id'));

    for (const target of labelTargets(source(SCREEN))) {
      expect(ids, `<Label htmlFor="${target}"> points at no input`).toContain(target);
    }
  });

  it('binds the reset guidance and the refusal to the password field', () => {
    // Static text that nothing in the tab order passes through, so
    // `aria-describedby` is the only route to a screen-reader user. Asserted as
    // a RESOLVING reference, not merely a present attribute: every id the
    // attribute can name, in either branch, must be an id this screen renders.
    const screen = source(SCREEN);
    const password = inputElements(screen).find(
      (input) => attributeOf(input, 'type') === 'password',
    );
    const ids = describedByIds(password ?? '');

    expect(ids.length, 'the password field describes nothing').toBeGreaterThan(0);
    for (const id of ids) {
      expect(screen, `no element carries id="${id}"`).toContain(`id="${id}"`);
    }
  });

  it('binds the refusal to the username field too, since it concerns both', () => {
    // One message for the pair. A description reachable from only one of the
    // two fields is unreachable from wherever the person actually is.
    const screen = source(SCREEN);
    const username = inputElements(screen).find(
      (input) => attributeOf(input, 'autoComplete') === 'username',
    );
    const password = inputElements(screen).find(
      (input) => attributeOf(input, 'type') === 'password',
    );
    const shared = describedByIds(username ?? '').filter((id) =>
      describedByIds(password ?? '').includes(id),
    );

    expect(shared, 'the two fields share no description').not.toEqual([]);
    for (const id of shared) expect(screen).toContain(`id="${id}"`);
  });

  it('names the refusal only while the refusal is on the page', () => {
    // The runtime defect a resolving-reference assertion structurally cannot
    // see: `<p id="sign-in-error">` renders only on failure, so a STATIC
    // `aria-describedby="sign-in-error"` described both fields by an element
    // that is absent in the common case. Assistive technology ignores a
    // dangling reference silently, and the source-level lookup above passes
    // either way — the id is in the file.
    //
    // So the shape is asserted, not just the resolution: the error id may only
    // reach the attribute through an expression that branches on the failure.
    const screen = source(SCREEN);
    const errorId = /<p\s+id="([\w-]+)"\s+role="alert"/.exec(screen)?.[1];

    expect(errorId, 'no role="alert" element to describe the fields by').not.toBeUndefined();

    for (const input of inputElements(screen)) {
      const described = describedByIds(input);

      if (!described.includes(String(errorId))) continue;

      expect(
        attributeOf(input, 'aria-describedby'),
        `a field names ${String(errorId)} unconditionally, so it dangles until something fails`,
      ).toBeNull();
      expect(
        /aria-describedby=\{[^}]*failure[^}]*\}/.test(input),
        'the description is not conditioned on there being a failure',
      ).toBe(true);
    }
  });

  it('keeps the reset guidance bound in BOTH branches, since it never goes away', () => {
    // The other polarity of the conditional. Making the whole attribute
    // conditional on a failure would silently drop the password-reset guidance
    // — permanent, always rendered, and reachable only this way — from every
    // screen that has not failed yet, which is all of them.
    const screen = source(SCREEN);
    const password =
      inputElements(screen).find((input) => attributeOf(input, 'type') === 'password') ?? '';
    const branches = [...(/aria-describedby=\{([^}]*)\}/.exec(password)?.[1] ?? '').matchAll(
      /'([^']*)'/g,
    )].map((found) => idTokens(found[1] ?? ''));

    expect(branches.length, 'the password description is not a two-branch expression').toBe(2);
    for (const branch of branches) {
      expect(branch, 'a branch drops the password-reset guidance').toContain('password-reset');
    }
  });

  it('lets the credential manager fill both fields', () => {
    // `autoComplete` is what makes a saved credential offerable, and the VALUE
    // is what decides it: `off` and `on` are both non-null and neither offers
    // a credential, so a presence check would pass for the shape that breaks
    // every password manager. It is also why the `<form>` element is there at
    // all — outside a form the attribute is ignored.
    const CREDENTIAL_TOKENS = new Set(['username', 'current-password', 'new-password', 'email']);

    for (const input of inputElements(source(SCREEN))) {
      const declared = attributeOf(input, 'autoComplete');

      expect(declared, 'an <Input> declares no autoComplete').not.toBeNull();
      expect(
        CREDENTIAL_TOKENS.has(declared ?? ''),
        `autoComplete="${String(declared)}" is not a credential-manager value`,
      ).toBe(true);
    }
  });

  it('masks the password field', () => {
    const types = inputElements(source(SCREEN)).map((input) => attributeOf(input, 'type'));

    expect(types).toContain('password');
    expect(types).toContain('text');
  });

  it('keeps the phone keyboard out of an admin-issued username', () => {
    const username = inputElements(source(SCREEN)).find(
      (input) => attributeOf(input, 'autoComplete') === 'username',
    );

    expect(attributeOf(username ?? '', 'autoCapitalize')).toBe('none');
    expect(attributeOf(username ?? '', 'autoCorrect')).toBe('off');
    expect(username).toContain('spellCheck={false}');
  });
});

describe('every field on the settings surface carries an accessible name', () => {
  /**
   * The same claims the credential form makes, on the screen that has five
   * fields instead of two (story 1.4a).
   *
   * Written as its own block rather than folded into the one above, because the
   * assertions there are about `type="password"` and `autoComplete="username"` —
   * facts about credentials, not about forms. What generalizes is the binding:
   * `htmlFor`/`id` is the only thing that ties a `<Label>` to its `<Input>`, and
   * getting it wrong leaves a screen reader announcing "edit text, blank" on a
   * field whose value decides what timezone the whole organization renders in.
   */
  it('gives every field a label bound by htmlFor, and every label a field', () => {
    const screen = source(SETTINGS);
    const targets = labelTargets(screen);
    const inputs = inputElements(screen);
    const ids = inputs.map((input) => attributeOf(input, 'id'));

    expect(inputs).toHaveLength(5);
    expect(targets).toHaveLength(5);
    expect(ids, 'an <Input> carries no id, so no <Label> can name it').not.toContain(null);
    expect(new Set(ids).size, 'two fields share one id').toBe(ids.length);
    for (const id of ids) {
      expect(targets, `no <Label htmlFor> points at ${String(id)}`).toContain(id);
    }
    for (const target of targets) {
      expect(ids, `<Label htmlFor="${target}"> points at no input`).toContain(target);
    }
  });

  it('binds the refusal to every field, and only while it is on the page', () => {
    // One message for five fields: a description reachable from only one of them
    // is unreachable from wherever the person actually is. CONDITIONAL, for the
    // reason the sign-in screen's is — the element renders only on a refusal,
    // and a reference to an absent id is ignored in silence, which is worse than
    // no reference because the source-level lookup passes either way.
    const screen = source(SETTINGS);
    const errorId = /<p\s+id="([\w-]+)"\s+role="alert"/.exec(screen)?.[1];

    expect(errorId, 'no role="alert" element to describe the fields by').not.toBeUndefined();
    expect(screen, `no element carries id="${String(errorId)}"`).toContain(
      `id="${String(errorId)}"`,
    );

    for (const input of inputElements(screen)) {
      expect(describedByIds(input), 'a field describes nothing').toContain(String(errorId));
      expect(
        attributeOf(input, 'aria-describedby'),
        `a field names ${String(errorId)} unconditionally, so it dangles until something fails`,
      ).toBeNull();
      expect(
        /aria-describedby=\{[^}]*refusal[^}]*\}/.test(input),
        'the description is not conditioned on there being a refusal',
      ).toBe(true);
    }
  });

  it('bounds the leave-year day at 28, so the control cannot express the broken case', () => {
    // `0002:106` admits 1-28 by SHAPE rather than by validation, because a leave
    // year starting on the 30th has no boundary in February. The spec's I/O
    // matrix says the control cannot express the value; a `max` of 31 would make
    // it expressible and turn a shape into a refusal somebody has to read.
    const screen = source(SETTINGS);
    const day = inputElements(screen).find((input) => /id="[\w-]*leave-day"/.test(input));
    const month = inputElements(screen).find((input) => /id="[\w-]*leave-month"/.test(input));

    expect(day, 'no leave-year day field on the settings surface').not.toBeUndefined();
    expect(month, 'no leave-year month field on the settings surface').not.toBeUndefined();
    expect(day).toContain('max={28}');
    expect(day).toContain('min={1}');
    expect(month).toContain('max={12}');
    expect(month).toContain('min={1}');
  });

  it('keeps every entered value by never controlling a field', () => {
    // UX-DR34, and the reason this screen is uncontrolled: a refused save must
    // keep all five entered values. `value={…}` on any of them is the shape that
    // loses them on the render that shows the refusal; `defaultValue={…}` is not
    // — it seeds an uncontrolled field and never re-renders it away.
    for (const input of inputElements(source(SETTINGS))) {
      expect(attributeOf(input, 'value'), 'a settings field is controlled').toBeNull();
      expect(input.includes('value={') && !input.includes('defaultValue={')).toBe(false);
    }
  });

  it('delegates the failure-to-message pairing rather than branching on it', () => {
    const screen = source(SETTINGS);

    expect(screen, 'the screen no longer renders its message through the mapping').toContain(
      't(organizationMessageKey(',
    );
    for (const key of [
      'organization.error.refused',
      'organization.error.name',
      'organization.error.invalid',
      'organization.error.timezone',
      'organization.error.unavailable',
    ]) {
      expect(screen, `${key} is branched on in the screen`).not.toContain(key);
    }
  });

  it('builds no request and no client of its own', () => {
    const screen = source(SETTINGS);

    for (const forbidden of ['fetch(', 'createClient(', 'localStorage']) {
      expect(screen, `the settings screen reaches for ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('renders the refusal outside the branch that needs a snapshot to exist', () => {
    // MUTATION-PROVEN GAP, found by the 1.4a review. The alert lived inside
    // `renderSettings`, after its `organization === null` early return — so it
    // was reachable only once a row had been read, and a read that was REFUSED
    // or UNAVAILABLE produced no row, no form, and therefore no message. The
    // one element that explains the failure was behind the success.
    const screen = source(SETTINGS);
    const gated = componentFunction(screen, 'renderSettings');

    expect(gated, 'no renderSettings function to read').not.toBe('');
    expect(screen, 'the screen renders no alert at all').toContain('role="alert"');
    expect(
      gated,
      'the refusal is inside the snapshot-gated branch, so a failed read shows nothing',
    ).not.toContain('role="alert"');
    expect(
      gated,
      'the refusal message is inside the snapshot-gated branch',
    ).not.toContain('organizationMessageKey(');
  });

  it('shows the skeleton only while the read is actually pending', () => {
    // The other half of the same defect. Gated on `organization === null`, the
    // skeleton was what a permanently failed read looked like: an indefinitely
    // pulsing bar, byte-identical to a slow one, with no message and no way
    // forward. UX-DR40 asks for a skeleton rather than a spinner; it does not
    // ask for one that never resolves.
    const gated = componentFunction(source(SETTINGS), 'renderSettings');

    expect(gated, 'no renderSettings function to read').not.toBe('');
    expect(gated, 'the screen renders no skeleton').toContain('animate-pulse');
    expect(
      gated,
      'the skeleton is not conditioned on the query being pending, so a settled failure pulses forever',
    ).toMatch(/isPending[\s\S]{0,120}?animate-pulse/);
  });
});

describe('the logo control the general sweeps structurally cannot see', () => {
  /**
   * STORY 1.4b. Every other control on this screen is an `<Input>` or a
   * `<Button>`, and every sweep above is built on those two detectors. The file
   * picker is neither: it is a bare `<input type="file">` kept off-screen, and
   * the affordance a pointer meets is a `<Button>` that opens it.
   *
   * That split is the right one — a native file input renders its own chrome in
   * the BROWSER's language, which is the one string on this screen that could
   * never come from `hr.json`, and it cannot be sized to UX-DR40's 44 px floor
   * either — but it puts the input outside every general assertion in this file.
   * So each property it would otherwise have inherited is claimed here by name.
   */

  it('keeps exactly one file picker, off-screen but still in the accessibility tree', () => {
    const screen = source(SETTINGS);
    const pickers = bareInputElements(screen);

    // NON-VACUITY first: with no bare input found, every assertion below would
    // pass against an empty string and read as coverage.
    expect(pickers, 'no bare <input> on the settings surface').toHaveLength(1);

    const picker = pickers[0] ?? '';

    expect(attributeOf(picker, 'type'), 'the picker is not a file input').toBe('file');
    expect(attributeOf(picker, 'id'), 'the picker carries no id to open it by').not.toBeNull();
    // `sr-only` and NOT `hidden`: `hidden` removes the control from the
    // accessibility tree and from the tab order, which would leave the logo
    // unreachable by keyboard with the visible button doing nothing for anyone
    // who cannot use a pointer.
    expect(picker, 'the picker is not kept off-screen').toContain('sr-only');
    expect(picker, 'the picker is removed from the accessibility tree').not.toMatch(
      /(^|\s)hidden(\s|$|=)/,
    );
    expect(picker, 'the picker carries no accessible name').toMatch(/aria-label=\{t\(/);
    expect(picker, 'the picker describes nothing when the upload is refused').toMatch(
      /aria-describedby=\{[^}]*refusal[^}]*\}/,
    );
    // DISABLED TOO, and not only the button. Carried on the button alone, a
    // keyboard user reaching the input directly could choose a second file
    // mid-upload and get silence — the in-flight guard returns without a word.
    expect(picker, 'the picker stays live while an upload is in flight').toMatch(
      /disabled=\{[^}]+\}/,
    );
    // The accept hint is DERIVED from the bucket's allowlist rather than typed
    // here, so a hint offering a type the bucket refuses is not expressible.
    expect(picker, 'the accept hint is written by hand rather than derived').toContain(
      'accept={ORGANIZATION_LOGO_ACCEPT}',
    );
  });

  it('gives the picker a visible action that clears the tap-target floor', () => {
    const screen = source(SETTINGS);
    const buttons = buttonElements(screen);

    expect(buttons, 'the settings surface lost a button').toHaveLength(3);

    const choose = buttons.find((element) => element.includes('onClick={openLogoPicker}')) ?? null;

    expect(choose, 'nothing on the screen opens the file picker').not.toBeNull();
    expect(choose, 'the choose action would submit the settings form').toContain('type="button"');
    // THE CONTROL A PERSON ACTUALLY OPERATES is the button, so the refusal has
    // to be reachable from it: describing only the off-screen input leaves the
    // message unreachable from wherever a pointer user actually is.
    expect(choose ?? '', 'the visible action describes nothing when the upload is refused').toMatch(
      /aria-describedby=\{[^}]*refusal[^}]*\}/,
    );
    expect(choose ?? '', 'the in-flight state is not announced').toMatch(/aria-busy=\{[^}]+\}/);

    const measured = heightPx(attributeOf(choose ?? '', 'className'));

    expect(measured, 'the choose action declares no usable height class').not.toBeNull();
    expect(measured).toBeGreaterThanOrEqual(TARGET_FLOOR_PX);
  });

  it('disables both controls while either handler is in flight', () => {
    // ONE MESSAGE REGION, two handlers: a save started while an upload is in
    // flight takes the region from a refusal nobody has read yet, and whichever
    // finished last owned it. Both flags on every control is the half of the fix
    // that is visible; the guards below are the other half.
    const screen = source(SETTINGS);

    for (const element of buttonElements(screen)) {
      expect(
        element,
        `a control is disabled by only one of the two in-flight flags: ${element}`,
      ).toMatch(/disabled=\{(?:pending \|\| uploadingLogo|busy)\}/);
    }
  });

  it('renders the logo it has, and a neutral mark carrying the name when it has none', () => {
    // The acceptance criterion, as far as source text can carry it: the preview
    // is conditioned on there being a URL, and BOTH branches name the
    // organization — one as `alt`, one as the mark's accessible name. Neither
    // says anything about an absence, which is the voice rule and also why
    // there is no key for it in `hr.json`.
    const screen = source(SETTINGS);

    expect(screen, 'the preview is not conditioned on there being a URL').toMatch(
      /logoUrl === null \?/,
    );
    expect(screen, 'the fallback carries no accessible name').toMatch(
      /aria-label=\{mark === null \? t\('nav\.organizacija'\) : organization\.name\}/,
    );
    expect(screen, 'the logo renders with no alternative text').toContain(
      'alt={organization.name}',
    );
    // A WHOLE CODE POINT, and the helper that takes it is executed in
    // `logo.test.ts`. `slice(0, 1)` splits a surrogate pair and orphans a
    // combining caron, and Croatian diacritic coverage is an explicit
    // requirement of this project.
    expect(screen, 'the mark is cut out of the name by code unit').not.toContain('.slice(0, 1)');
    expect(screen, 'the mark is not derived through the tested helper').toContain(
      'organizationLogoMark(organization.name)',
    );
  });

  it('never renders a broken image, however the signed URL stops working', () => {
    // A signed URL is a capability with a deadline, so a tab left open past the
    // expiry renders the browser's broken-image glyph — the exact state the
    // acceptance criterion forbids. Two defences, both asserted: the cache is
    // bounded below the expiry, and the element falls back when the load fails
    // for any reason a timer cannot predict.
    const screen = source(SETTINGS);

    expect(screen, 'the img has no failure path, so a dead URL renders as a broken image').toContain(
      'onError={markLogoUnrenderable}',
    );
    expect(screen, 'the signed URL is cached without regard for its expiry').toContain(
      'staleTime: LOGO_URL_STALE_MS',
    );
    expect(screen, 'a settled refusal is retried as though it were slow').toContain('retry: false');
  });

  it('draws a skeleton for the logo while the one read is still pending', () => {
    // UX-DR40 asks for a skeleton rather than a spinner, and the reason it
    // belongs on this block specifically is layout: without it the card has no
    // logo at all until the row arrives and then grows one, moving every control
    // below it under whatever the pointer was already heading for.
    const gated = componentFunction(source(SETTINGS), 'renderLogo');

    expect(gated, 'no renderLogo function to read').not.toBe('');
    expect(gated, 'the logo block renders no skeleton').toContain('animate-pulse');
    expect(
      gated,
      'the skeleton is not conditioned on the query being pending, so a settled failure pulses forever',
    ).toMatch(/isPending[\s\S]{0,120}?animate-pulse/);
  });

  it('never sends the logo reference from the form submit', () => {
    // THE CLOBBER the two disjoint write shapes exist to prevent: a save of the
    // five identity fields that also carried `logo_path` would overwrite a logo
    // uploaded seconds earlier, silently, with a PATCH that reports success.
    const handler = submitHandler(source(SETTINGS));

    expect(handler, 'no submit handler to read').not.toBe('');
    expect(handler, 'the identity save carries the logo reference with it').not.toContain(
      'logoPath',
    );
  });

  it('delegates the whole upload rather than sequencing it here', () => {
    // A `.tsx` is collected by nothing (AD-15), so a sequence written here is
    // read as source text and never executed — and the mutation that permits is
    // not subtle: passing `organization.slug` where the policies authorize
    // `organization.id` typechecks, lints, and leaves every assertion in this
    // repository green while every upload is refused 403 at runtime. The
    // sequence, the ordering and the path are executed in `logo.test.ts`
    // against a recorder; what is left to assert here is that the screen ROUTES
    // through it and derives no path of its own.
    const upload = componentFunction(source(SETTINGS), 'uploadLogo');

    expect(upload, 'no uploadLogo function to read').not.toBe('');
    expect(upload, 'the screen no longer routes through the upload module').toContain(
      'replaceOrganizationLogo(',
    );
    expect(upload, 'the screen hands over something other than the snapshot').toMatch(
      /replaceOrganizationLogo\([\s\S]{0,240}?\n\s+organization,/,
    );
    for (const sequenced of ['organizationLogoPath(', 'uploadOrganizationLogo(', 'logoPath:']) {
      expect(
        source(SETTINGS),
        `the screen sequences the upload itself by naming ${sequenced}`,
      ).not.toContain(sequenced);
    }
    expect(upload, 'the refused upload is not put on screen').toMatch(
      /!outcome\.ok[\s\S]{0,160}?setFailure\(outcome\.code\)/,
    );
    // ONE invalidation, and it is the snapshot's key: the derived URL is keyed
    // underneath it, so refetching the row refetches the preview with it.
    expect(upload, 'the preview is not refreshed after an upload').toContain(
      'invalidateQueries({ queryKey: ORGANIZATION_SNAPSHOT_KEY })',
    );
  });

  it('clears the in-flight flag on every path, and guards on both refs not on state', () => {
    // The same two defects the submit handler is swept for, on the second
    // handler this screen grew: `setUploadingLogo(false)` outside a `finally`
    // leaves the button dead after the first refusal, and a guard on state is
    // stale inside a handler already called once this tick.
    //
    // BOTH REFS, in both handlers. They share one message region and
    // `setFailure(null)` here erases whatever the other put there, so a guard
    // on its own flag alone lets one handler wipe a refusal nobody has read.
    const upload = componentFunction(source(SETTINGS), 'uploadLogo');
    const submit = submitHandler(source(SETTINGS));

    expect(upload, 'no uploadLogo function to read').not.toBe('');
    expect(upload, 'the upload has no finally, so a path can leave it in flight').toMatch(
      /\}\s*finally\s*\{/,
    );
    for (const [name, handler] of [
      ['uploadLogo', upload],
      ['submit', submit],
    ] as const) {
      expect(handler, `${name} does not guard on the upload flag`).toMatch(
        /if\s*\([\s\S]*?uploading\.current[\s\S]*?\)\s*\{?\s*return;/,
      );
      expect(handler, `${name} does not guard on the save flag`).toMatch(
        /if\s*\([\s\S]*?saving\.current[\s\S]*?\)\s*\{?\s*return;/,
      );
    }
    expect(upload, 'the finally does not re-enable the action').toContain(
      'setUploadingLogo(false)',
    );
    expect(upload, 'the finally does not clear the in-flight ref').toContain(
      'uploading.current = false',
    );
    expect(upload, 'nothing is surfaced when the call throws outside its own mapping').toMatch(
      /catch[\s\S]{0,200}?setFailure\(/,
    );
  });

  it('logs a read it could not render rather than falling back in silence', () => {
    // A persistently unreadable logo and an organization with no logo look
    // identical on screen, by design — that is the matrix's own row. Which is
    // exactly why the read has to leave a trace somewhere: silence is how a
    // misconfigured bucket stays undiagnosed, and `uploadLogo` already logs.
    const reader = componentFunction(source(SETTINGS), 'renderableLogo');

    expect(reader, 'no renderableLogo function to read').not.toBe('');
    expect(reader, 'a failed read reports nothing at all').toMatch(
      /!outcome\.ok[\s\S]{0,80}?console\.error\(/,
    );
  });

  it('clears the picker after a chosen file, so the same file can be chosen twice', () => {
    // A file input fires no `change` event when the same file is chosen twice
    // running, so without the reset "the upload was refused, try that file
    // again" does nothing at all — the retry a person is most likely to make.
    const chooser = componentFunction(source(SETTINGS), 'chooseLogo');

    expect(chooser, 'no chooseLogo function to read').not.toBe('');
    expect(chooser, 'the picker is never cleared').toContain('value = NO_FILE_CHOSEN');
    expect(chooser, 'nothing is uploaded when a file is chosen').toContain('uploadLogo(');
  });
});

describe('the screen reaches the authentication seam rather than faking one', () => {
  /**
   * THE INVERSE of story 1.1d's block, which asserted this screen was inert and
   * named `supabase`, `fetch(`, `useState` and `localStorage` as offences. It
   * was self-labelled "until story 1.3 wires it", and this is that story — so
   * the claim is narrowed to the new truth rather than deleted, and the tokens
   * are not renamed to evade it. What is still refused is the shape those
   * tokens were standing in for: a request assembled inline, an address built
   * in a screen, and a submission that leaks a password into the URL.
   */

  it('still keeps a typed password out of the URL, the history and the CDN log', () => {
    // UNCHANGED and still load-bearing, precisely BECAUSE there is a handler
    // now: if the handler ever does not run — a bundle that failed to load, a
    // script error — the browser submits the form itself, and the default
    // method is GET.
    expect(source(SCREEN)).toContain('method="post"');
  });

  it.each(FORM_SCREENS)("routes $name's own onSubmit into its submit handler", ({ file }) => {
    // Scoped to the `<form>` element rather than searched for anywhere in the
    // file: a handler defined and never bound is a screen whose button does
    // nothing, which is exactly what this file used to assert was correct.
    //
    // OVER BOTH FORM SCREENS. Reading only the sign-in screen left the
    // organization prompt — same form, same handler shape — covered by nothing.
    const screen = source(file);
    const formBlock = /<form\b[\s\S]*?<\/form>/.exec(screen)?.[0];

    expect(formBlock, 'no <form>...</form> element on the screen').not.toBeUndefined();
    expect(screen, 'the submit handler is gone').toMatch(/function submit\(/);
    // `\bsubmit\b` rather than `submit(`: one screen binds an arrow that calls
    // it, the other binds the function itself, and both are correct bindings.
    expect(
      formBlock,
      "the form's onSubmit does not reach the screen's submit handler",
    ).toMatch(/onSubmit=\{[\s\S]{0,160}?\bsubmit\b/);
  });

  it.each(FORM_SCREENS)('prevents the default submission first on $name', ({ file, effect }) => {
    // `preventDefault` is no longer the whole handler — it is the first thing
    // the real one does, because a POST to a static host is a 405 that discards
    // every entered value, the opposite of UX-DR34.
    //
    // The old assertion required an inline arrow whose body contained no `}`,
    // which no real handler can satisfy. This asserts the ORDER instead:
    // prevention inside the handler, before the screen's own effect.
    const screen = source(file);

    expect(screen, 'the handler does not prevent the default submission').toMatch(
      /function submit\([\s\S]*?preventDefault\(\)/,
    );
    expect(
      screen.indexOf('preventDefault()'),
      `${effect} runs before the default submission is stopped`,
    ).toBeLessThan(screen.indexOf(effect));
  });

  it('exchanges credentials through the supabase modules, not inline', () => {
    // The positive half of the frozen boundary's replacement. `supabase` is no
    // longer forbidden here — it is REQUIRED, and required as an import of the
    // two modules that own the client and the mapping.
    const screen = source(SCREEN);

    for (const required of [
      "from '@/supabase/client'",
      "from '@/supabase/sign-in'",
      'supabaseClient()',
      'signIn(',
    ]) {
      expect(screen, `the sign-in screen no longer reaches ${required}`).toContain(required);
    }
  });

  it('builds no request and no address of its own', () => {
    // What the forbidden-token sweep was really protecting. A screen that
    // assembled the AD-12 address itself would put the `@`, the slug and the
    // reserved domain in a file where `prijava.test.ts` forbids every literal —
    // and would be a second place for the expression `seed.sql` already holds.
    const screen = source(SCREEN);

    for (const forbidden of ['fetch(', 'shift.invalid', 'localStorage', 'createClient(']) {
      expect(screen, `the sign-in screen reaches for ${forbidden}`).not.toContain(forbidden);
    }
  });

  it.each(FORM_SCREENS)('attaches a ref to every field the handler reads on $name', ({ file }) => {
    // MUTATION-PROVEN GAP, and the mutation was the first draft of this screen.
    // The two `useRef` calls were declared and read in the handler but never
    // put on the `<Input>` elements, so `current` stayed null, the handler
    // returned at its own guard, and the button did nothing at all — with the
    // whole suite green, `pnpm lint` clean and `pnpm typecheck` clean, because
    // the refs ARE used, just not attached.
    //
    // Asserted as a resolving pair rather than as a present attribute: the ref
    // an input names has to be the one the handler dereferences, or this passes
    // for a screen wired to two objects nobody reads.
    const screen = source(file);
    const attached = inputElements(screen).map((input) => /ref=\{(\w+)\}/.exec(input)?.[1] ?? null);

    expect(attached.length, 'no <Input> on a screen that has a form').toBeGreaterThan(0);

    expect(attached, 'an <Input> carries no ref, so the handler cannot read it').not.toContain(null);
    expect(new Set(attached).size, 'two fields share one ref').toBe(attached.length);
    for (const name of attached) {
      expect(screen, `ref ${String(name)} is declared on an input and never created`).toContain(
        `const ${String(name)} = useRef`,
      );
      expect(screen, `ref ${String(name)} is attached and never read`).toContain(
        `${String(name)}.current`,
      );
    }
  });

  it.each(FORM_SCREENS)('guards on $name against a ref that is still null', ({ file }) => {
    // The other half: the handler must not assume the element is there. The
    // guard is what turns the mutation above into a no-op rather than a crash,
    // which is also why the assertion above is needed to notice it happening.
    expect(source(file)).toMatch(/=== null[\s\S]{0,80}?return;/);
  });

  it('has an in-flight screen to sweep at all', () => {
    // NON-VACUITY for the three sweeps below, which run over `IN_FLIGHT_SCREENS`
    // rather than over `FORM_SCREENS`. A `null` written into every entry would
    // make all three loops assert nothing while still reading as coverage —
    // which is the shape the per-screen sweeps were introduced to end.
    expect(IN_FLIGHT_SCREENS.length, 'no form screen declares an in-flight ref').toBe(2);
    expect(
      IN_FLIGHT_SCREENS.map((screen) => screen.inFlight).sort(),
      'the in-flight ref names drifted from the screens that hold them',
    ).toEqual(['exchanging', 'saving']);
  });

  it.each(IN_FLIGHT_SCREENS)(
    'clears the in-flight flag on every path on $name, and guards on a ref not on state',
    ({ file }) => {
      // TWO defects in one shape. `pending` was cleared only on the failure
      // branch, so the moment the awaited call stopped resolving the button was
      // disabled forever with nothing on screen to say why — `finally` is what
      // makes that unreachable. And the guard reads a REF: state is stale inside
      // a handler already called once this tick, so a second submit (double
      // click, Enter as the click lands) fired a second concurrent call.
      //
      // OVER EVERY SCREEN THAT AWAITS SOMETHING, since the 1.4a review. Pinned
      // to the sign-in screen this protected one of the two files with the
      // identical shape, and deleting the settings surface's `finally` was free.
      const screen = source(file);

      expect(screen, 'the submit handler has no finally, so a path can leave it in flight').toMatch(
        /\}\s*finally\s*\{/,
      );

      const guard = /if\s*\([\s\S]*?\)\s*\{?\s*return;/.exec(screen)?.[0] ?? '';

      expect(guard, 'the in-flight guard reads React state, which is stale within a tick').toMatch(
        /\.current\b/,
      );
      expect(screen, 'nothing is surfaced when the call throws outside its own mapping').toMatch(
        /catch[\s\S]{0,400}?setFailure\(/,
      );
    },
  );

  it.each(IN_FLIGHT_SCREENS)('surfaces the refused outcome code on $name', ({ file }) => {
    // MUTATION-PROVEN GAP, found by the 1.4a review: deleting
    // `setFailure(outcome.code)` from the settings surface's handler left the
    // whole suite green, and a refused save then looked exactly like a saved
    // one — the button re-enabled, the values still there, nothing said. The
    // `catch` assertion above covers the THROWN path only, and a policy refusal
    // never throws.
    const handler = submitHandler(source(file));

    expect(handler, 'no submit handler to read').not.toBe('');
    expect(
      handler,
      'the refused branch does not put the returned code on screen',
    ).toMatch(/!outcome\.ok[\s\S]{0,160}?setFailure\(outcome\.code\)/);
  });

  it('keeps every entered value by never controlling the fields', () => {
    // UX-DR34: a refused save keeps every entered value. Uncontrolled inputs
    // keep what was typed because nothing re-renders them away — so the state
    // this screen holds is the FAILURE, never the credentials. A `value={…}` on
    // either field is the shape that loses them on the render that shows the
    // error.
    const screen = source(SCREEN);

    for (const input of inputElements(screen)) {
      expect(attributeOf(input, 'value'), 'a credential field is controlled').toBeNull();
      expect(input, 'a credential field is controlled').not.toContain('value={');
    }
  });

  it('delegates the failure-to-message pairing rather than branching on it', () => {
    // The screen used to hold `failure === SIGN_IN_REFUSED ? credentials :
    // unavailable`, and nothing could run it: swapping the branches passed
    // every assertion here while a wrong password reported a service outage.
    // The mapping is executed in `sign-in.test.ts` now, and what is left to
    // assert is that the screen ROUTES through it and holds no branch of its
    // own over the codes.
    const screen = source(SCREEN);

    expect(screen, 'the screen no longer renders its message through the mapping').toContain(
      't(signInMessageKey(',
    );
    for (const key of ['auth.error.credentials', 'auth.error.unavailable']) {
      expect(screen, `${key} is branched on in the screen again`).not.toContain(key);
    }
  });

  it('signs in against the slug from the URL, and not one of its own', () => {
    // Nothing pinned this. A hard-coded slug, or `slug` dropped from the
    // credentials object, passed every test in the suite — and would send every
    // sign-in to one tenant, or to none.
    const screen = source(SCREEN);

    expect(screen, 'the screen never reads the slug from the route params').toMatch(
      /const \{\s*slug\s*\}\s*=\s*[\w.]*useParams\(\)/,
    );

    const call = /signIn\(([\s\S]*?)\}\)/.exec(screen)?.[1];

    expect(call, 'the screen does not call signIn at all').not.toBeUndefined();
    expect(call, 'the slug is not among the credentials handed to signIn').toMatch(
      /(?:^|[\s,{])slug\s*,/,
    );
  });

  it('lands a signed-in visitor on / and nowhere else', () => {
    // MUTATION-PROVEN GAP. Nothing in this repository read a `navigate(` call:
    // a grep across every test file returned zero matches, so `to: '/prijava'`
    // here passed the entire suite while a correct sign-in established a
    // session and then dropped the person back on the organization prompt —
    // which, with no signed-in guard on that route, renders as though nothing
    // happened. The story's first acceptance criterion was verified only by
    // somebody remembering to run the manual browser check.
    const handler = submitHandler(source(SCREEN));

    expect(handler, 'the sign-in screen has no submit handler').not.toBe('');
    expect(handler, 'a successful sign-in does not navigate to /').toMatch(
      /navigate\(\{\s*to:\s*'\/'\s*\}\)/,
    );
  });

  it.each(IN_FLIGHT_SCREENS)(
    'clears the in-flight state inside the finally on $name, not merely near one',
    ({ file, inFlight }) => {
      // The assertion this replaces matched `/\}\s*finally\s*\{/` against the
      // whole file, which is the existence of the keyword and nothing about what
      // it does. Deleting `setPending(false)` from inside it passed — and left
      // `pending` true after the first wrong password, so `disabled={pending}`
      // kept the button dead on the most common error path, with the entered
      // values still on screen and no way to retry.
      //
      // The ref NAME comes from the screen's own entry since the 1.4a review.
      // Hard-coded as `exchanging.current = false` this could only ever be true
      // of one file, so the settings surface's `saving` ref was swept by nothing.
      const block = finallyBlock(source(file));

      expect(block, 'the submit handler has no finally, so a path can leave it in flight').not.toBe(
        '',
      );
      expect(block, 'the finally does not re-enable the button').toContain('setPending(false)');
      expect(block, 'the finally does not clear the in-flight ref').toContain(
        `${inFlight}.current = false`,
      );
    },
  );

  it('logs the cause it cannot render', () => {
    // The catch swallowed `SUPABASE_ENVIRONMENT_MISSING` whole while its own
    // comment claimed "the console still carries the stable code". Nothing
    // wrote to the console, so a deployment with no environment showed a
    // working-looking form saying "try again" forever and left no trace
    // anywhere — the misconfiguration-as-outage failure `client.ts` exists to
    // prevent, reintroduced two files downstream.
    const screen = source(SCREEN);

    expect(screen, 'the catch reports nothing to the console').toMatch(
      /catch\s*\([\s\S]{0,600}?console\.error\(/,
    );
  });

  it('requires both credentials before it asks the service about them', () => {
    // The organization prompt marks its one field `required` and says why: the
    // browser's own validation stops an empty submission in the user's own
    // language. The credential form marked neither, so a blank submit reached
    // `normalizeUsername`, was refused locally, and rendered "Korisničko ime
    // ili lozinka nisu točni." — telling somebody their credentials are wrong
    // when they had not entered any. UX-DR34 names the problem instead.
    for (const input of inputElements(source(SCREEN))) {
      expect(input, `a credential field is not required: ${input}`).toContain('required');
    }
  });
});

describe('the organization prompt reaches the tenant it was given', () => {
  it('navigates to the parameterized form with the slug it just validated', () => {
    // MUTATION-PROVEN GAP, and the widest one this story shipped. This hop is
    // the entire product behaviour of the screen, and no test read it: replace
    // the call with `navigate({ to: '/prijava' })` and the prompt silently does
    // nothing on submit; hard-code `params: { slug: 'dvd-kastel-novi' }` and
    // every visitor of every organization is sent to one tenant's form, where
    // their correct credentials are refused with the deliberately
    // indistinguishable message. Both type-check, both keep `slug` referenced
    // so no lint fires, and both passed the whole suite.
    //
    // The PAIR is what matters: the destination must be the parameterized
    // route, and the parameter must be the value `organizationDestination`
    // returned rather than a literal of the handler's own.
    const handler = submitHandler(source(ORGANIZATION));

    expect(handler, 'the organization prompt has no submit handler').not.toBe('');
    expect(handler, 'the prompt does not navigate to the per-tenant form').toMatch(
      /navigate\(\{\s*to:\s*'\/prijava\/\$slug'/,
    );
    expect(handler, 'the prompt derives no slug from what was typed').toMatch(
      /const\s+slug\s*=\s*organizationDestination\(/,
    );
    expect(handler, 'the slug handed to the route is not the validated one').toMatch(
      /params:\s*\{\s*slug\s*\}/,
    );
  });

  it('surfaces a rejected navigation instead of discarding it', () => {
    // `void navigate(...)` on a promise that rejects is an unhandled rejection:
    // the prompt stays put with no explanation and nothing in the console. The
    // sign-in screen's equivalent call is inside a try/catch for the same
    // reason. No message reaches the screen — one would begin the enumeration
    // oracle this screen is built to avoid — so the console is the whole of it.
    const handler = submitHandler(source(ORGANIZATION));

    expect(handler, 'a rejected navigation is discarded rather than reported').toMatch(
      /navigate\([\s\S]{0,200}?\.catch\(/,
    );
    expect(handler, 'the rejected navigation reports nothing').toContain('console.error(');
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
});

describe('the screen uses no reserved signal', () => {
  it.each(SCREENS)('names no destructive utility in $name', ({ file }) => {
    // UX-DR4: `destructive` is reserved exclusively for an unresolved conflict.
    // Comment-blind, so the screen's own explanation of the rule does not trip
    // it — which is what makes the assertion about the markup.
    expect(source(file)).not.toContain('destructive');
  });
});

describe('the detectors find what they claim to find', () => {
  // Synthetic sources, so each regex is proved on the shape it exists to catch
  // rather than on the one file that happens to be compliant today.
  const compliant = [
    'export function Probe() {',
    '  return (',
    '    <p className="text-sm">{t(\'auth.heading\')}</p>',
    '  );',
    '}',
  ].join('\n');
  const withText = compliant.replace(">{t('auth.heading')}<", '>Prijava<');
  const withLiteral = compliant.replace('className="text-sm"', 'aria-label="Zatvori"');
  const withTemplate = compliant.replace("{t('auth.heading')}", '{`Prijava`}');

  it('reads a key out of a t() call and finds none where there is none', () => {
    expect(translationKeys(compliant)).toEqual(['auth.heading']);
    expect(translationKeys('const x = 1;')).toEqual([]);
  });

  it('reports bare JSX text and stays silent on an expression container', () => {
    expect(jsxTextWithContent(withText)).toEqual(['Prijava']);
    expect(jsxTextWithContent(compliant)).toEqual([]);
  });

  it('reports a literal on a non-structural attribute and allows className', () => {
    expect(unsanctionedLiterals(withLiteral)).toEqual(['Zatvori']);
    expect(unsanctionedLiterals(compliant)).toEqual([]);
  });

  it('allows a structural attribute written as an expression, and only those', () => {
    // The widening the conditional description needed, on BOTH polarities. The
    // first shape is what the screen ships; the second is the shape that must
    // keep firing, and it differs only in the attribute's name.
    expect(
      unsanctionedLiterals("<Input aria-describedby={f === null ? undefined : 'sign-in-error'} />"),
    ).toEqual([]);
    expect(unsanctionedLiterals("<Input aria-label={f === null ? undefined : 'Zatvori'} />")).toEqual(
      ['Zatvori'],
    );
    // A nested container is not matched, so nothing hides inside one.
    expect(unsanctionedLiterals("<p className={cn({ a: 'Danas' })} />")).toEqual(['Danas']);
  });

  it('reports a template literal, which the quote-only class could not see', () => {
    expect(unsanctionedLiterals(withTemplate)).toEqual(['Prijava']);
  });

  it('allows a template that interpolates a value and holds no text of its own', () => {
    expect(unsanctionedLiterals('const label = `${n}`;')).toEqual([]);
    expect(templateStaticText('${n} dana')).toBe(' dana');
  });

  it('does not mistake an arrow function body for JSX text', () => {
    // Without the `=>` substitution this reports ` handler() ` as user-facing
    // text, and the sweep becomes a rule people work around.
    expect(jsxTextWithContent('const f = () => handler();')).toEqual([]);
  });

  it('does not mistake a type-argument list for JSX text', () => {
    // The false positive story 1.3b's refs and state hooks produced. All four
    // shapes are in the sign-in screen today.
    expect(jsxTextWithContent('const a = useRef<HTMLInputElement>(null); const b = f<T>(x);')).toEqual(
      [],
    );
    expect(jsxTextWithContent('function s(e: FormEvent<HTMLFormElement>): Promise<void> {}')).toEqual(
      [],
    );
    expect(stripTypeArguments('useState<Record<string, string>>(x)')).toBe('useState(x)');
    expect(stripTypeArguments('useState<A | null>(x)')).toBe('useState(x)');
  });

  it('still reports bare text once type arguments are neutralized', () => {
    // BOTH polarities, because a substitution that ate JSX would make every
    // text sweep in this file pass on any screen at all. A tag's `<` follows
    // whitespace, `(`, `{` or `>` — never an identifier character.
    expect(jsxTextWithContent('<p>Prijava</p>')).toEqual(['Prijava']);
    expect(stripTypeArguments('<Input id="a" />')).toBe('<Input id="a" />');
    expect(stripTypeArguments('<p>Prijava</p>')).toBe('<p>Prijava</p>');
  });

  it('records where the type-argument strip over-reaches into JSX', () => {
    // The polarity the two self-tests above miss, and it is a real one: they
    // only ever put a CLOSING tag after the text, and `</p>` is excluded by the
    // character class because of the `/`. An OPENING tag after text is not —
    // `Prijava<span>` puts `<` directly after an identifier character, which is
    // exactly the lookbehind's condition, so the strip eats `<span>` and merges
    // two runs into one.
    //
    // Asserted as it BEHAVES rather than as it should behave, because the
    // imprecision loses no literal: the merged run is still reported, so the
    // sweep still fails on hard-coded text. Written down so the next person to
    // widen this regex sees the boundary rather than discovering it.
    expect(stripTypeArguments('<p>Prijava<span>x</span></p>')).toBe('<p>Prijavax</span></p>');
    expect(jsxTextWithContent('<p>Prijava<span>x</span></p>')).toEqual(['Prijavax']);
  });

  it('binds a form to its own handler and refuses one that is merely nearby', () => {
    // The matcher that replaced the deleted `onSubmit` regex got no self-test,
    // and its 160-character window was an unasserted magic bound. Both
    // polarities: a binding inside the window is found, and a `submit` that is
    // only mentioned far away from the attribute is not.
    expect('<form onSubmit={(e) => { void submit(e); }}>').toMatch(
      /onSubmit=\{[\s\S]{0,160}?\bsubmit\b/,
    );
    expect('<form onSubmit={noop}>').not.toMatch(/onSubmit=\{[\s\S]{0,160}?\bsubmit\b/);
    expect(`<form onSubmit={noop}>${' '.repeat(200)}submit`).not.toMatch(
      /onSubmit=\{[\s\S]{0,160}?\bsubmit\b/,
    );
  });

  it('extracts a handler and its finally rather than matching the file', () => {
    const screen = [
      'export function Probe() {',
      '  async function submit(event) {',
      '    try {',
      '      await navigate({ to: 1 });',
      '    } finally {',
      '      setPending(false);',
      '    }',
      '  }',
      '}',
      'function elsewhere() { setPending(true); }',
    ].join('\n');

    expect(submitHandler(screen)).toContain('navigate({ to: 1 })');
    expect(submitHandler(screen), 'the extraction ran past the handler').not.toContain('elsewhere');
    expect(finallyBlock(screen)).toContain('setPending(false)');
    expect(finallyBlock('function submit() { const x = 1; }')).toBe('');
    expect(submitHandler('const noHandlerHere = 1;')).toBe('');
  });

  it('reads a height off every class shape and nothing off none', () => {
    expect(heightPx('h-11 w-full')).toBe(44);
    expect(heightPx('h-9')).toBe(36);
    expect(heightPx('min-h-12')).toBe(48);
    expect(heightPx('h-[44px]')).toBe(44);
    expect(heightPx('h-[2.75rem]')).toBe(44);
    // `h-full` and `h-auto` prove no pixel height, and neither does a class
    // that merely starts with the same letters.
    expect(heightPx('h-full')).toBeNull();
    expect(heightPx('w-full items-center')).toBeNull();
    expect(heightPx(null)).toBeNull();
  });

  it('would refuse the mutation that deleted the height classes', () => {
    // The gap this block exists for, proved on the mutated shape rather than
    // only on the compliant one.
    expect(heightPx('h-9')).toBeLessThan(TARGET_FLOOR_PX);
  });

  it('strips comments before scanning, in both syntaxes', () => {
    expect(stripComments('/* Prijava */ const x = 1;').trim()).toBe('const x = 1;');
    expect(stripComments('const x = 1; // Prijava').trim()).toBe('const x = 1;');
  });

  it('reads an attribute value and finds none where the attribute is absent', () => {
    expect(attributeOf('id="username" type="text"', 'id')).toBe('username');
    expect(attributeOf('id="username" type="text"', 'placeholder')).toBeNull();
  });

  it('allows a variant and still refuses the attribute next to it', () => {
    // The entry story 1.4a added to the allowlist, proved on BOTH polarities.
    // Widening the set is the one edit to this file that can quietly stop it
    // catching things, so the neighbouring offence has to still be caught.
    expect(unsanctionedLiterals('<Button variant="outline">{t(\'organization.save\')}</Button>')).toEqual(
      [],
    );
    expect(unsanctionedLiterals('<Button variant="outline" title="Spremi" />')).toEqual(['Spremi']);
  });

  it('reads a message-key union off either mapping, not only the first one', () => {
    // The generalization story 1.4a needed. A reader pinned to
    // `signInMessageKey` returns nothing for `organizationMessageKey`, which
    // drops four keys out of the rendered set and makes the set comparison
    // quietly weaker by four rather than red.
    const signature = [
      'export function organizationMessageKey(',
      '  failure: OrganizationFailure,',
      "): 'organization.error.refused' | 'organization.error.name' {",
      '  return failure === ORGANIZATION_REFUSED',
      '}',
    ].join('\n');

    expect(messageKeyUnion(signature)).toEqual([
      'organization.error.refused',
      'organization.error.name',
    ]);
  });

  it('allows a role and still refuses the attribute next to it', () => {
    // The entry story 1.3b added to the allowlist, proved on BOTH polarities:
    // widening the set is the one edit to this file that can quietly stop it
    // catching things, so the neighbouring offence has to still be caught.
    expect(unsanctionedLiterals('<p role="alert">{t(\'auth.heading\')}</p>')).toEqual([]);
    expect(unsanctionedLiterals('<p role="alert" aria-label="Greška" />')).toEqual(['Greška']);
  });

  it('reads describedby ids out of a literal and out of a conditional', () => {
    // The matcher loosened for the conditional attribute, on both polarities.
    // A version that saw only the literal form returns nothing for the shape
    // the screen actually ships, and every id assertion above passes vacuously.
    expect(describedByIds('id="a" aria-describedby="one two"')).toEqual(['one', 'two']);
    expect(
      describedByIds("id=\"a\" aria-describedby={f === null ? 'password-reset' : 'sign-in-error password-reset'}"),
    ).toEqual(['password-reset', 'sign-in-error', 'password-reset']);
    expect(describedByIds("aria-describedby={f === null ? undefined : 'sign-in-error'}")).toEqual([
      'sign-in-error',
    ]);
    expect(describedByIds('id="a" type="text"')).toEqual([]);
  });

  it('splits an aria-describedby token list and finds no id in nothing', () => {
    // The matcher loosened for the refusal message. A version that returned the
    // whole value as one token would look up an id no element can carry, and a
    // version that returned `['']` would "find" `id=\"\"` in any file.
    expect(idTokens('sign-in-error password-reset')).toEqual(['sign-in-error', 'password-reset']);
    expect(idTokens('  spaced   out  ')).toEqual(['spaced', 'out']);
    expect(idTokens('single')).toEqual(['single']);
    expect(idTokens(null)).toEqual([]);
    expect(idTokens('')).toEqual([]);
  });

  it('would report a key rendered twice once, which is what the set claim means', () => {
    // The dedupe `used()` gained. Without it a screen that renders one message
    // from two branches fails the set comparison while the two sets are equal.
    const twice = "{t('auth.heading')}{t('auth.heading')}";

    expect(translationKeys(twice)).toEqual(['auth.heading', 'auth.heading']);
    expect([...new Set(translationKeys(twice))]).toEqual(['auth.heading']);
  });

  it('finds every self-closing Input and nothing where there is none', () => {
    const two = '<Input id="a" /><p>text</p><Input id="b" className="h-11" />';

    expect(inputElements(two)).toEqual([' id="a" ', ' id="b" className="h-11" ']);
    expect(inputElements('<p>no inputs here</p>')).toEqual([]);
  });

  it('finds a bare input and never the shadcn primitive, which is a different control', () => {
    // BOTH polarities. A detector that also matched `<Input>` would report the
    // five settings fields as file pickers and make the single-picker assertion
    // fail on correct code; one that matched neither would make every claim
    // about the picker pass against an empty string.
    const mixed = '<Input id="a" className="h-11" /><input id="b" type="file" />';

    expect(bareInputElements(mixed)).toEqual([' id="b" type="file" ']);
    expect(bareInputElements('<Input id="a" />')).toEqual([]);
    expect(bareInputElements('<p>no inputs here</p>')).toEqual([]);
  });

  it('finds every Button, self-closing or not, and nothing where there is none', () => {
    const two = '<Button type="submit">Go</Button><Button className="h-11" disabled />';

    expect(buttonElements(two)).toEqual([' type="submit"', ' className="h-11" disabled ']);
    expect(buttonElements('<p>no buttons here</p>')).toEqual([]);
  });

  it('finds every Link and never a Label, which starts the same way', () => {
    // BOTH polarities, and the near-miss is the point: `<Label` shares four
    // characters with `<Link`, and a detector without the word boundary would
    // report the settings surface's five labels as navigation links and measure
    // them against a floor they are not controls for. One that matched neither
    // would make every claim about the chrome pass against an empty list.
    const mixed = '<Link to="/danas" className="h-11">x</Link><Label htmlFor="a" />';

    expect(linkElements(mixed)).toEqual([' to="/danas" className="h-11"']);
    expect(linkElements('<Label htmlFor="a" />')).toEqual([]);
    expect(linkElements('<p>no links here</p>')).toEqual([]);
  });

  it('allows aria-current and still refuses the attribute next to it', () => {
    // The entry the navigation chrome added to the allowlist, proved on BOTH
    // polarities. Widening that set is the one edit to this file that can
    // quietly stop it catching things, so the neighbouring offence has to still
    // be caught — in the quoted form and in the expression form, since the
    // active treatment ships as the latter.
    expect(unsanctionedLiterals('<Link aria-current="page">{t(\'nav.danas\')}</Link>')).toEqual([]);
    expect(
      unsanctionedLiterals("<Link aria-current={active ? 'page' : undefined} to={path} />"),
    ).toEqual([]);
    expect(unsanctionedLiterals('<Link aria-current="page" title="Danas" />')).toEqual(['Danas']);
    expect(
      unsanctionedLiterals("<Link aria-current={active ? 'page' : undefined} alt='Danas' />"),
    ).toEqual(['Danas']);
  });

  it('extracts each nav block and never merges two into one', () => {
    // BOTH polarities. A version that matched greedily would return ONE block
    // spanning both bars, and "every bar renders the exit" would then be
    // satisfied by one bar that does — which is exactly the mutation the sweep
    // exists to catch. One that matched nothing would make the same sweep pass
    // against an empty list.
    const two = '<nav id="a">{destinations}</nav><p>x</p><nav id="b">{exit}</nav>';

    expect(navBlocks(two)).toEqual(['<nav id="a">{destinations}</nav>', '<nav id="b">{exit}</nav>']);
    expect(navBlocks('<p>no navigation here</p>')).toEqual([]);
  });

  it('reads aria-current values out of both syntaxes and none out of neither', () => {
    // The sweep that keeps the allowlist exemption honest is only as good as
    // this reader: one that returned nothing would let `aria-current="Danas"`
    // through on every screen in the application.
    expect(ariaCurrentValues('<Link aria-current="page" />')).toEqual(['page']);
    expect(ariaCurrentValues("<Link aria-current={a ? 'page' : undefined} />")).toEqual(['page']);
    expect(ariaCurrentValues('<Link aria-current="Danas" />')).toEqual(['Danas']);
    expect(ariaCurrentValues("<Link aria-current={a ? 'step' : 'page'} />")).toEqual(['step', 'page']);
    expect(ariaCurrentValues('<Link to="/danas" />')).toEqual([]);
  });

  it('allows aria-controls and still refuses the attribute next to it', () => {
    // The second entry the chrome added to the allowlist, proved on both
    // polarities. It is an id reference list exactly as `aria-describedby` is,
    // and the neighbouring offence has to keep firing.
    expect(unsanctionedLiterals('<Button aria-controls="app-destinations" />')).toEqual([]);
    expect(unsanctionedLiterals('<Button aria-controls="app-destinations" title="Izbornik" />')).toEqual(
      ['Izbornik'],
    );
  });

  it('extracts a component helper and stops at its own closing brace', () => {
    // The extraction the 1.4a review needed, on both polarities: a version that
    // ran past the function would swallow the component's own return and make
    // "the alert is not inside it" false on correct code, and one that matched
    // nothing would make the same assertion pass on the broken code.
    const component = [
      'export function Probe() {',
      '  function renderSettings() {',
      '    return <div className="animate-pulse" />;',
      '  }',
      '',
      '  return <p role="alert">x</p>;',
      '}',
    ].join('\n');

    expect(componentFunction(component, 'renderSettings')).toContain('animate-pulse');
    expect(
      componentFunction(component, 'renderSettings'),
      'the extraction ran past the helper',
    ).not.toContain('role="alert"');
    expect(componentFunction(component, 'missing')).toBe('');
  });

  it('reads the heading key off an h1, on one line or three', () => {
    // Both polarities and both layouts. A reader that returned `null` for the
    // multi-line form would make the destination-binding assertion fail on a
    // correct screen; one that returned the first key in the file would make it
    // pass on a screen titled by the wrong one.
    expect(headingKey('<h1 className="x">{t(\'nav.danas\')}</h1>')).toBe('nav.danas');
    expect(
      headingKey('<h1 className="x">\n  {t(\'nav.organizacija\')}\n</h1>'),
    ).toBe('nav.organizacija');
    expect(headingKey("<p>{t('nav.danas')}</p>")).toBeNull();
    expect(headingKey('const x = 1;')).toBeNull();
  });

  it('reads htmlFor values in source order and finds none where there are none', () => {
    expect(labelTargets('<Label htmlFor="username" /><Label htmlFor="password" />')).toEqual([
      'username',
      'password',
    ]);
    expect(labelTargets('<Label>text</Label>')).toEqual([]);
  });

  it('reads the message keys off the mapping signature and none off a screen', () => {
    // The reader added when the two refusal keys left the screen. One that
    // returned nothing would drop both from the rendered set and make the
    // "every declared key is rendered" comparison quietly weaker by two.
    const signature = [
      'export function signInMessageKey(',
      '  failure: SignInFailure,',
      "): 'auth.error.credentials' | 'auth.error.unavailable' {",
      '  return failure === SIGN_IN_UNAVAILABLE',
      '}',
    ].join('\n');

    expect(messageKeyUnion(signature)).toEqual([
      'auth.error.credentials',
      'auth.error.unavailable',
    ]);
    expect(messageKeyUnion('export function other(): string { return x; }')).toEqual([]);
    expect(messageKeyUnion(compliant)).toEqual([]);
  });

  it('flattens resource keys the way i18next resolves them', () => {
    // Guards the key-set comparison: a walker that returned nothing would make
    // both directions of it pass on any file.
    expect(resourceKeys()).toContain('auth.heading');
    expect(resourceKeys()).toContain('count.days');
  });
});
