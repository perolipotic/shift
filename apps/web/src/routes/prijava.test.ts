import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The sign-in screen, asserted at source level (story 1.1d).
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
 *   - the screen is inert. It has one action and no handler for it until 1.3.
 *   - `destructive` appears nowhere. UX-DR4 reserves it exclusively for an
 *     unresolved conflict; a refused sign-in is 1.3's, and it may not use it.
 *
 * Every read is lazy and every detector is self-tested on synthetic sources at
 * the bottom, the idiom `packages/domain/test/purity.test.ts` established: a
 * regex that stopped matching would make each sweep pass having proved nothing.
 */

const srcRoot = fileURLToPath(new URL('..', import.meta.url));
const SCREEN = join(srcRoot, 'routes', 'prijava.tsx');
const NOT_FOUND = join(srcRoot, 'routes', 'not-found.tsx');
const INPUT_PRIMITIVE = join(srcRoot, 'components', 'ui', 'input.tsx');
const RESOURCE = join(srcRoot, 'i18n', 'locales', 'hr.json');

/** Both screens this story authors, so each sweep runs over both. */
const SCREENS = [
  { name: 'the sign-in screen', file: SCREEN },
  { name: 'the not-found component', file: NOT_FOUND },
];

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
 * Attributes and properties whose string value is structure, not content.
 *
 * An allowlist, not a denylist of the guarded seven: a denylist passes for the
 * attribute nobody thought of, and `label` on a component is user-facing while
 * `name` on an input is not — which is exactly the distinction the ESLint guard
 * cannot make without type information. Here there are two files to read, so
 * naming the permitted set outright is both possible and honest.
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
function unsanctionedLiterals(text: string): string[] {
  const withoutKeys = text.replace(/\bt\(\s*'[^']+'/g, 't(');
  const withoutImports = withoutKeys.replace(/^\s*import[^;]+;/gm, '');
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
 * JSX text runs: everything between a `>` and the next `<`.
 *
 * `=>` is neutralized first, or an arrow function's body would read as a text
 * run. A run holding a brace is an expression container rather than text, so
 * `{t('auth.heading')}` is correctly not text at all.
 */
function jsxTextWithContent(text: string): string[] {
  return [...text.replace(/=>/g, '__').matchAll(/>([^<>{}]+)</g)]
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

  it('renders five strings on the sign-in screen and two on the not-found one', () => {
    // A count, so a string that stopped being rendered fails rather than
    // quietly disappearing from the screen.
    expect(translationKeys(source(SCREEN))).toHaveLength(5);
    expect(translationKeys(source(NOT_FOUND))).toHaveLength(2);
  });
});

describe('the keys rendered and the keys declared are the same set', () => {
  const used = (): string[] =>
    [...translationKeys(source(SCREEN)), ...translationKeys(source(NOT_FOUND))].sort();

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

  it('binds the reset guidance to the password field', () => {
    // Static text after the last control: nothing in the tab order passes
    // through it, so `aria-describedby` is the only route to a screen-reader
    // user. Asserted as a resolving reference, not merely a present attribute.
    const screen = source(SCREEN);
    const password = inputElements(screen).find(
      (input) => attributeOf(input, 'type') === 'password',
    );
    const described = attributeOf(password ?? '', 'aria-describedby');

    expect(described, 'the password field describes nothing').not.toBeNull();
    expect(screen, `no element carries id="${String(described)}"`).toContain(
      `id="${String(described)}"`,
    );
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

describe('the screen is inert until story 1.3 wires it', () => {
  it('stops the form from navigating', () => {
    // A form with no handler still submits. `method="post"` keeps a typed
    // password out of the URL, the history and the CDN log; `preventDefault`
    // keeps the POST from becoming a 405 that discards every entered value.
    // Both are needed, and neither is a step towards authentication.
    const screen = source(SCREEN);

    expect(screen).toContain('method="post"');
    expect(screen).toContain('preventDefault()');

    // The line above is a bare substring search — `preventDefault()` sitting
    // anywhere in the file, including an unrelated or dead code path, would
    // satisfy it. This scopes the call to the form's own `onSubmit`.
    const formBlock = /<form\b[\s\S]*?<\/form>/.exec(screen)?.[0];

    expect(formBlock, 'no <form>...</form> element on the screen').not.toBeUndefined();
    expect(
      formBlock,
      "preventDefault is not bound to the form's own onSubmit handler",
    ).toMatch(/onSubmit=\{\s*\([^)]*\)\s*=>\s*\{[^}]*preventDefault\(\)[^}]*\}\s*\}/);
  });

  it('reaches no network and holds no session', () => {
    // The frozen boundary: 1.3 owns every one of these. Named so that the
    // first import of a client fails here rather than in review.
    const screen = source(SCREEN);

    for (const forbidden of ['supabase', 'fetch(', 'useState', 'localStorage']) {
      expect(screen, `the sign-in screen reaches for ${forbidden}`).not.toContain(forbidden);
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

  it('flattens resource keys the way i18next resolves them', () => {
    // Guards the key-set comparison: a walker that returned nothing would make
    // both directions of it pass on any file.
    expect(resourceKeys()).toContain('auth.heading');
    expect(resourceKeys()).toContain('count.days');
  });
});
