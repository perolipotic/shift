import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

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
const INPUT_PRIMITIVE = join(srcRoot, 'components', 'ui', 'input.tsx');
const RESOURCE = join(srcRoot, 'i18n', 'locales', 'hr.json');

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
  { name: 'the sign-in screen', file: SCREEN },
  { name: 'the not-found component', file: NOT_FOUND },
  { name: 'the organization prompt', file: ORGANIZATION },
  { name: 'the signed-in placeholder', file: HOME },
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
  { name: 'the sign-in screen', file: SCREEN, effect: 'signIn(' },
  { name: 'the organization prompt', file: ORGANIZATION, effect: 'organizationDestination(' },
];

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
  const signature = /function signInMessageKey\([\s\S]*?\):([^{]*)\{/.exec(text)?.[1] ?? '';

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

/** `htmlFor` values, in source order. */
function labelTargets(text: string): string[] {
  return [...text.matchAll(/htmlFor="([^"]+)"/g)].map((found) => found[1] ?? '');
}

/** Every `<Input …/>` element's attribute block. */
function inputElements(text: string): string[] {
  return [...text.matchAll(/<Input\b([\s\S]*?)\/>/g)].map((found) => found[1] ?? '');
}

/** Every `<Button …>` opening tag's attribute block. */
function buttonElements(text: string): string[] {
  return [...text.matchAll(/<Button\b([^>]*?)\/?>/g)].map((found) => found[1] ?? '');
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

  it.each(SCREENS)('clears the floor on every control in $name', ({ file }) => {
    // The named assertions above are the mutation-proven ones and stay. This is
    // the general claim they cannot make: a control added to any screen later,
    // on any of the four, is measured without anyone remembering to add a case
    // — which is how the organization prompt's own two controls got covered.
    const screen = source(file);

    for (const element of [...inputElements(screen), ...buttonElements(screen)]) {
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

  it('clears the in-flight flag on every path, and guards on a ref not on state', () => {
    // TWO defects in one shape. `pending` was cleared only on the failure
    // branch, so the moment `navigate` stopped resolving the button was
    // disabled forever with nothing on screen to say why — `finally` is what
    // makes that unreachable. And the guard reads a REF: state is stale inside
    // a handler already called once this tick, so a second submit (double
    // click, Enter as the click lands) fired a second concurrent exchange.
    const screen = source(SCREEN);

    expect(screen, 'the submit handler has no finally, so a path can leave it in flight').toMatch(
      /\}\s*finally\s*\{/,
    );

    const guard = /if\s*\([^)]*\)\s*return;/.exec(screen)?.[0] ?? '';

    expect(guard, 'the in-flight guard reads React state, which is stale within a tick').toMatch(
      /\.current\b/,
    );
    expect(screen, 'nothing is surfaced when the exchange throws outside signIn').toMatch(
      /catch[\s\S]{0,400}?setFailure\(/,
    );
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

  it('finds every Button, self-closing or not, and nothing where there is none', () => {
    const two = '<Button type="submit">Go</Button><Button className="h-11" disabled />';

    expect(buttonElements(two)).toEqual([' type="submit"', ' className="h-11" disabled ']);
    expect(buttonElements('<p>no buttons here</p>')).toEqual([]);
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
