import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

/**
 * L2 is merge-blocking, and this is what proves the block exists (story 1.1c).
 *
 * `eslint.config.js` carries a `no-restricted-syntax` block over
 * `apps/web/**\/*.tsx` that refuses a bare JSX text literal and a string-valued
 * `aria-label`, `placeholder`, `title` or `alt`. A restriction rule is
 * peculiarly easy to ship broken: a selector that matches nothing produces a
 * green `pnpm lint` on a tree full of literals, which reads exactly like
 * compliance. Two shapes in particular would silently do that here —
 *
 *   - the wrong node name. TSX parses through `@babel/eslint-parser`, which
 *     converts Babel's AST to ESTree, so a string attribute value is `Literal`
 *     and NOT Babel's own `StringLiteral`. A selector naming `StringLiteral`
 *     lints clean forever.
 *   - a type-aware selector. That parser is configured for syntax only (no
 *     `typescript-eslint`, because TypeScript 7 ships no programmatic API until
 *     7.1), so anything needing type information matches nothing.
 *
 * So every case below is linted through the REAL `eslint.config.js`, not a
 * reconstruction of it: `new ESLint({ cwd: repoRoot })` resolves the same flat
 * config `pnpm lint` uses, and `lintText` under a synthetic `apps/web/src`
 * path is what selects the override.
 *
 * The violating sources are assembled at runtime from fragments, so this file
 * — which is scanned by `pnpm lint` like every other — cannot trip the rule it
 * tests. `packages/domain/test/purity.test.ts` uses the same device.
 */

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const RULE = 'no-restricted-syntax';

/**
 * `.tsx` paths under `apps/web` — the only scope the rule covers. The files need
 * not exist; `lintText` lints the string and uses the path to pick the config.
 *
 * THREE paths, not one, and that matters. Every positive assertion here first
 * ran only under `surfaces/`, which today holds nothing but a README — so
 * narrowing the rule to `apps/web/src/surfaces/**\/*.tsx` kept all fourteen
 * tests green while a literal in a real screen stopped being refused. The rule
 * has to be proved where components actually live.
 */
const WEB_PROBES = [
  `${repoRoot}apps/web/src/surfaces/synthetic-probe.tsx`,
  `${repoRoot}apps/web/src/routes/synthetic-probe.tsx`,
  `${repoRoot}apps/web/src/components/synthetic-probe.tsx`,
];
const WEB_TSX = WEB_PROBES[0] ?? '';
/** The same content in the same syntax, outside the rule's file scope. `.tsx`
 *  deliberately: a `.ts` path would fail to PARSE the JSX (the Babel JSX plugin
 *  is enabled per-extension), and a parse error carries no `ruleId`, so the
 *  scope assertion would pass for the wrong reason. */
const OUTSIDE_SCOPE_TSX = `${repoRoot}packages/domain/src/synthetic-probe.tsx`;

/**
 * JSX fragments, assembled so this file holds no literal the rule would catch.
 * `open('p') + 'Danas' + close('p')` never appears in the source as
 * `<p>Danas</p>`.
 */
const open = (tag: string, attributes = ''): string => `<${tag}${attributes}>`;
const close = (tag: string): string => `</${tag}>`;
const selfClosing = (tag: string, attributes: string): string => `<${tag}${attributes} />`;
const attribute = (name: string, value: string): string => ` ${name}="${value}"`;
/** `name={'value'}` — a guarded attribute hiding its string behind braces. */
const bracedAttribute = (name: string, value: string): string => ` ${name}={'${value}'}`;
/** `{'text'}` — a string literal as an element child. */
const bracedString = (text: string): string => `{'${text}'}`;
/** `` {`text`} `` — the same thing as a template literal. */
const bracedTemplate = (text: string): string => `{\`${text}\`}`;
/** `{cond ? 'a' : 'b'}` — a literal hiding inside a branch. */
const bracedTernary = (a: string, b: string): string => `{cond ? '${a}' : '${b}'}`;
/** `{cond && 'a'}` — the same shape written as a guard. */
const bracedGuard = (text: string): string => `{cond && '${text}'}`;
/** `name={cond ? 'a' : 'b'}` — a branch on an attribute. */
const ternaryAttribute = (name: string, a: string, b: string): string =>
  ` ${name}={cond ? '${a}' : '${b}'}`;
/** `` name={`text`} `` — a template literal on an attribute. */
const templateAttribute = (name: string, text: string): string => ` ${name}={\`${text}\`}`;
/** `{a ? 'x' : b ? 'y' : 'z'}` — a branch nested inside a branch. */
const nestedTernary = (a: string, b: string, c: string): string =>
  `{a ? '${a}' : b ? '${b}' : '${c}'}`;
/** `` {cond ? `x` : `y`} `` — the branch shape written with template literals. */
const templateTernary = (a: string, b: string): string => `{cond ? \`${a}\` : \`${b}\`}`;
/** `name={cond && 'x'}` — a guard on an attribute. */
const guardAttribute = (name: string, text: string): string => ` ${name}={cond && '${text}'}`;
/** `name={a ? 'x' : b ? 'y' : 'z'}` — a nested branch on an attribute. */
const nestedTernaryAttribute = (name: string, a: string, b: string, c: string): string =>
  ` ${name}={a ? '${a}' : b ? '${b}' : '${c}'}`;
/** `` name={cond ? `x` : `y`} `` — template literals in a branch on an attribute. */
const templateTernaryAttribute = (name: string, a: string, b: string): string =>
  ` ${name}={cond ? \`${a}\` : \`${b}\`}`;
/** `{cond ? t('a') : t('b')}` — the correct way to write the branch above. */
const translatedTernary = (a: string, b: string): string => `{cond ? t('${a}') : t('${b}')}`;
/** `name={t('a')}` — the correct way to write a guarded attribute. */
const translatedAttribute = (name: string, key: string): string => ` ${name}={t('${key}')}`;
/** `name={cond ? t('a') : t('b')}` — and the correct way to branch on one. */
const translatedTernaryAttribute = (name: string, a: string, b: string): string =>
  ` ${name}={cond ? t('${a}') : t('${b}')}`;
/** `{t(cond ? 'a' : 'b')}` — a KEY chosen by a branch, which is not a
 *  user-facing literal and must stay silent. */
const translatedComputedKey = (a: string, b: string): string => `{t(cond ? '${a}' : '${b}')}`;
const component = (body: string): string => `export function Probe() {\n  return ${body};\n}\n`;
const fragment = (body: string): string => `(<>${body}</>)`;
/** A compliant probe imports `t` the way a real screen does. */
const translated = (body: string): string => `import { t } from '@/i18n';\n\n${body}`;

/** Croatian words a real surface would want, so the cases read like the
 *  mistake they model. */
const DANAS = 'Danas';
const ZATVORI = 'Zatvori';
const SATI = 'Sati';
const SMJENE = 'Smjene';
/** Two keys that exist, so a compliant case is realistic rather than notional. */
const KEY_A = 'auth.heading';
const KEY_B = 'auth.submit';

/** One ESLint, built on first use — flat-config resolution is the slow part,
 *  and nothing below mutates it. Lazy rather than module scope, so a config
 *  that failed to load surfaces inside a named assertion. */
let eslint: ESLint | null = null;

async function report(
  source: string,
  filePath = WEB_TSX,
): Promise<{ rules: string[]; messages: string[] }> {
  eslint ??= new ESLint({ cwd: repoRoot });
  const [result] = await eslint.lintText(source, { filePath });
  const found = result?.messages ?? [];

  return {
    rules: found.map((message) => message.ruleId ?? 'unknown'),
    messages: found.map((message) => message.message),
  };
}

const lint = async (source: string, filePath = WEB_TSX): Promise<string[]> =>
  (await report(source, filePath)).rules;

// ------------------------------------------------------------------ violations

const VIOLATIONS: { name: string; source: string }[] = [
  {
    name: 'bare JSX text',
    source: component(open('p') + DANAS + close('p')),
  },
  {
    name: 'JSX text among elements',
    source: component(
      `(${open('div')}${open('span')}${close('span')}${DANAS}${close('div')})`,
    ),
  },
  {
    name: 'a string aria-label',
    source: component(selfClosing('button', attribute('aria-label', ZATVORI))),
  },
  {
    name: 'a string placeholder',
    source: component(selfClosing('input', attribute('placeholder', 'Ime'))),
  },
  {
    name: 'a string title',
    source: component(selfClosing('abbr', attribute('title', 'Sati'))),
  },
  {
    name: 'a string alt',
    source: component(selfClosing('img', attribute('alt', 'Logotip'))),
  },
  // ---- the shapes the first derivation missed, all verified silent before
  {
    name: 'a string literal in braces as a child',
    source: component(open('p') + bracedString(DANAS) + close('p')),
  },
  {
    name: 'a template literal in braces as a child',
    source: component(open('p') + bracedTemplate(DANAS) + close('p')),
  },
  {
    name: 'a bare literal inside a fragment',
    source: component(fragment(DANAS)),
  },
  {
    name: 'a braced literal inside a fragment',
    source: component(fragment(bracedString(DANAS))),
  },
  {
    name: 'a guarded attribute hiding its string behind braces',
    source: component(selfClosing('button', bracedAttribute('aria-label', ZATVORI))),
  },
  {
    name: 'a string aria-description',
    source: component(selfClosing('div', attribute('aria-description', 'Opis smjene'))),
  },
  {
    name: 'a string aria-roledescription',
    source: component(selfClosing('div', attribute('aria-roledescription', 'Kalendar'))),
  },
  {
    name: 'a string aria-valuetext',
    source: component(selfClosing('div', attribute('aria-valuetext', 'Pet dana'))),
  },
  {
    name: 'a label on an optgroup, which renders to the user',
    source: component(selfClosing('optgroup', attribute('label', 'Smjene'))),
  },
  {
    name: 'a label on an option',
    source: component(selfClosing('option', attribute('label', 'Sve smjene'))),
  },
  {
    name: 'a label on a track',
    source: component(selfClosing('track', attribute('label', 'Titlovi'))),
  },
  // ---- the branch shapes, added by story 1.1d against real screen code
  {
    name: 'a literal in a ternary as a child',
    source: component(open('p') + bracedTernary(DANAS, ZATVORI) + close('p')),
  },
  {
    name: 'a literal guarded by a logical expression as a child',
    source: component(open('p') + bracedGuard(DANAS) + close('p')),
  },
  {
    name: 'a literal in a ternary inside a fragment',
    source: component(fragment(bracedTernary(DANAS, ZATVORI))),
  },
  {
    name: 'a ternary on a guarded attribute',
    source: component(selfClosing('button', ternaryAttribute('aria-label', DANAS, ZATVORI))),
  },
  {
    name: 'a guard on a guarded attribute',
    source: component(selfClosing('input', guardAttribute('placeholder', DANAS))),
  },
  {
    name: 'a template literal on a guarded attribute',
    source: component(selfClosing('button', templateAttribute('aria-label', ZATVORI))),
  },
  {
    name: 'a template literal on a placeholder',
    source: component(selfClosing('input', templateAttribute('placeholder', DANAS))),
  },
  // ---- what the round-1 branch selectors still let through, found in review.
  // Each of these linted CLEAN against `> Literal` anchored one level under the
  // outer conditional, with the guarded-attribute template form the only
  // template shape covered.
  {
    name: 'a literal in a NESTED ternary as a child',
    source: component(open('p') + nestedTernary(DANAS, ZATVORI, SATI) + close('p')),
  },
  {
    name: 'a template literal in a ternary as a child',
    source: component(open('p') + templateTernary(DANAS, ZATVORI) + close('p')),
  },
  {
    name: 'a literal in a nested ternary inside a fragment',
    source: component(fragment(nestedTernary(DANAS, ZATVORI, SATI))),
  },
  {
    name: 'a literal in a nested ternary on a guarded attribute',
    source: component(
      selfClosing('button', nestedTernaryAttribute('aria-label', DANAS, ZATVORI, SATI)),
    ),
  },
  {
    name: 'a template literal in a ternary on a guarded attribute',
    source: component(
      selfClosing('button', templateTernaryAttribute('aria-label', DANAS, ZATVORI)),
    ),
  },
  {
    name: 'a punctuation-only string on a guarded attribute, which names nothing',
    source: component(selfClosing('button', bracedAttribute('aria-label', ' – '))),
  },
  // ---- the option/optgroup/track label, in every form but the bare one. All
  // three elements render `label` to the user, and the round-1 selector saw
  // only `label="…"`.
  {
    name: 'a braced label on an option',
    source: component(selfClosing('option', bracedAttribute('label', SMJENE))),
  },
  {
    name: 'a template label on an option',
    source: component(selfClosing('option', templateAttribute('label', SMJENE))),
  },
  {
    name: 'a ternary label on an option',
    source: component(selfClosing('option', ternaryAttribute('label', SMJENE, SATI))),
  },
  {
    name: 'a nested ternary label on an option',
    source: component(selfClosing('option', nestedTernaryAttribute('label', SMJENE, SATI, DANAS))),
  },
  {
    name: 'a braced label on an optgroup',
    source: component(selfClosing('optgroup', bracedAttribute('label', SMJENE))),
  },
  {
    name: 'a template label on a track',
    source: component(selfClosing('track', templateAttribute('label', 'Titlovi'))),
  },
  {
    name: 'a ternary label on a track',
    source: component(selfClosing('track', ternaryAttribute('label', 'Titlovi', SATI))),
  },
];

describe('the L2 guard fires on a user-facing literal in a component', () => {
  const cases = WEB_PROBES.flatMap((filePath) =>
    VIOLATIONS.map((violation) => ({
      ...violation,
      filePath,
      where: relative(repoRoot, filePath),
    })),
  );

  it.each(cases)('reports $name in $where', async ({ source, filePath }) => {
    expect(await lint(source, filePath)).toContain(RULE);
  });

  it('names L2 and points at the resource file, because it fires mid-task', async () => {
    const { messages } = await report(component(open('p') + DANAS + close('p')));

    expect(messages.join('\n')).toContain('L2');
    expect(messages.join('\n')).toContain('apps/web/src/i18n/locales/hr.json');
  });
});

// ------------------------------------------------------------------ compliance

const COMPLIANT: { name: string; source: string }[] = [
  {
    name: 'whitespace and newlines between elements',
    source: component(`(\n    ${open('div')}\n      ${selfClosing('span', '')}\n    ${close('div')}\n  )`),
  },
  {
    name: 'text resolved through t()',
    source:
      `import { t } from '@/i18n';\n\n` +
      component(`${open('p')}{t('count.days', { count: 2 })}${close('p')}`),
  },
  {
    name: 'an aria-label resolved through t()',
    source:
      `import { t } from '@/i18n';\n\n` +
      component(selfClosing('button', ` aria-label={t('count.days', { count: 1 })}`)),
  },
  {
    name: 'a className, which is not user-facing',
    source: component(selfClosing('div', attribute('className', 'flex min-h-dvh'))),
  },
  {
    name: 'a non-user-facing attribute such as id or type',
    source: component(
      selfClosing('input', attribute('id', 'username') + attribute('type', 'text')),
    ),
  },
  // ---- separator punctuation between expressions is not content (patch 8)
  {
    name: 'an en dash between two values',
    source: component(`${open('p')}{start} – {end}${close('p')}`),
  },
  {
    name: 'a colon after a label',
    source: component(`${open('p')}{label}:${close('p')}`),
  },
  {
    name: 'a slash between two values',
    source: component(`${open('p')}{a} / {b}${close('p')}`),
  },
  {
    name: 'a comma between two values',
    source: component(`${open('p')}{a}, {b}${close('p')}`),
  },
  {
    name: 'parentheses around a value',
    source: component(`${open('p')}{a} ({b})${close('p')}`),
  },
  {
    name: 'a bullet between two values',
    source: component(`${open('p')}{a} • {b}${close('p')}`),
  },
  {
    name: 'the JSX space idiom',
    source: component(`${open('p')}{a}${bracedString(' ')}{b}${close('p')}`),
  },
  {
    name: 'a punctuation-only string literal used as a separator',
    source: component(`${open('p')}{a}${bracedString(' – ')}{b}${close('p')}`),
  },
  {
    name: 'a braced string on a non-guarded attribute',
    source: component(selfClosing('div', ` className={'flex min-h-dvh'}`)),
  },
  {
    name: 'a template literal interpolating only a value',
    source: component(`${open('p')}{\`\${n}\`}${close('p')}`),
  },
  {
    name: 'a number in braces',
    source: component(`${open('p')}{2}${close('p')}`),
  },
];

/**
 * The other polarity of the branch and label selectors (story 1.1d).
 *
 * Separated from `COMPLIANT` because these are the cases the anchoring was
 * chosen FOR. The conditional is allowed to NEST, so `{a ? 'x' : b ? 'y' : 'z'}`
 * fires on all three branches — but the string has to be a DIRECT child of a
 * branch node, never a descendant of one. That single restriction is what keeps
 * both of these clean: `{cond ? t('a') : t('b')}`, where the literals are call
 * arguments one level deeper, and `{t(cond ? 'a' : 'b')}`, where the
 * container's own child is a call rather than a branch and the strings are
 * KEYS. A descendant sweep would refuse the very fix the message asks for, and
 * a merge-blocking rule that refuses the fix is worse than no rule.
 */
const BRANCH_COMPLIANT: { name: string; source: string }[] = [
  {
    name: 'a ternary between two t() calls as a child',
    source: translated(component(open('p') + translatedTernary(KEY_A, KEY_B) + close('p'))),
  },
  {
    name: 'a guard around a t() call as a child',
    source: translated(component(`${open('p')}{cond && t('${KEY_A}')}${close('p')}`)),
  },
  {
    name: 'a NESTED ternary between t() calls as a child',
    source: translated(
      component(
        `${open('p')}{a ? t('${KEY_A}') : b ? t('${KEY_B}') : t('auth.password')}${close('p')}`,
      ),
    ),
  },
  {
    name: 'a key chosen by a ternary inside the t() call itself',
    source: translated(component(open('p') + translatedComputedKey(KEY_A, KEY_B) + close('p'))),
  },
  {
    name: 'a ternary between two t() calls on a guarded attribute',
    source: translated(
      component(selfClosing('button', translatedTernaryAttribute('aria-label', KEY_A, KEY_B))),
    ),
  },
  {
    name: 'an aria-label resolved through a bare t() call',
    source: translated(component(selfClosing('button', translatedAttribute('aria-label', KEY_A)))),
  },
  {
    name: 'an option label resolved through t()',
    source: translated(component(selfClosing('option', translatedAttribute('label', KEY_A)))),
  },
  {
    name: 'an option label resolved through a ternary between t() calls',
    source: translated(
      component(selfClosing('option', translatedTernaryAttribute('label', KEY_A, KEY_B))),
    ),
  },
  {
    name: 'a label on a component, where it is structural rather than rendered',
    source: component(selfClosing('Badge', attribute('label', DANAS))),
  },
  {
    name: 'a ternary between two separators',
    source: component(`${open('p')}{a}${bracedTernary(' – ', ' / ')}{b}${close('p')}`),
  },
  {
    name: 'a ternary on a className, which is not user-facing',
    source: component(selfClosing('div', ternaryAttribute('className', 'flex', 'grid'))),
  },
  {
    name: 'a nested ternary on a className',
    source: component(selfClosing('div', nestedTernaryAttribute('className', 'flex', 'grid', 'hidden'))),
  },
  {
    name: 'a ternary between two elements, which is not JSX content',
    source: component(`(cond ? ${open('p')}${close('p')} : null)`),
  },
  {
    name: 'a template literal on a guarded attribute interpolating only a value',
    source: component(selfClosing('button', ' aria-label={`${n}`}')),
  },
  {
    name: 'a template literal as a child interpolating only a value',
    source: component(`${open('p')}{\`\${n}\`}${close('p')}`),
  },
  {
    name: 'a template literal on a non-guarded attribute',
    source: component(selfClosing('div', ' className={`flex ${n}`}')),
  },
];

describe('the L2 guard stays silent on compliant markup', () => {
  it.each(COMPLIANT)('accepts $name', async ({ source }) => {
    expect(await lint(source)).not.toContain(RULE);
  });
});

describe('the branch selectors refuse the literal and accept the fix', () => {
  // Across all three probe paths, like the violations: narrowing the rule to
  // one directory once kept every positive assertion green while a literal in
  // a real screen stopped being refused, and the same trap applies to a
  // false-positive assertion that only ever ran under `surfaces/`.
  const cases = WEB_PROBES.flatMap((filePath) =>
    BRANCH_COMPLIANT.map((compliant) => ({
      ...compliant,
      filePath,
      where: relative(repoRoot, filePath),
    })),
  );

  it.each(cases)('accepts $name in $where', async ({ source, filePath }) => {
    expect(await lint(source, filePath)).not.toContain(RULE);
  });
});

describe('the separator exemption does not become a hole', () => {
  // Both polarities of the human-approved punctuation exemption. If the
  // character class ever widened to swallow letters, these are what fail.
  it.each([
    { name: 'one word', text: DANAS },
    { name: 'a sentence', text: 'Danas ne radiš' },
    { name: 'a word beside a dash', text: `– ${DANAS}` },
    { name: 'a word beside a colon', text: `${DANAS}:` },
    { name: 'a single letter', text: 'x' },
    { name: 'a bare digit, which is a count someone forgot to translate', text: '3' },
  ])('still refuses $name as JSX text', async ({ text }) => {
    expect(await lint(component(open('p') + text + close('p')))).toContain(RULE);
  });
});

// -------------------------------------------------------------------- the scope

describe('the guard is scoped to the client tree, where markup renders', () => {
  it('does not restrict the same syntax in packages/domain', async () => {
    // The domain returns keys and values (L4) and renders nothing, so the rule
    // has no business there. Asserted rather than assumed: widening the file
    // scope is an "ask first" change, and this is what notices it happening.
    expect(await lint(component(open('p') + DANAS + close('p')), OUTSIDE_SCOPE_TSX)).not.toContain(RULE);
  });

  it.each(WEB_PROBES)('lints %s with a config at all', async (filePath) => {
    // Vacuous-pass guard. If `lintText` were silently ignoring a probe path —
    // an ignore pattern, a cwd mistake — every "stays silent" assertion above
    // would pass having linted nothing.
    expect(await lint(`const x = 1 == 1;\n`, filePath)).toContain('eqeqeq');
  });

  it('lints the out-of-scope path too, so its silence means something', async () => {
    // The other half of the scope assertion. Without this, `packages/domain`
    // joining eslint's `ignores` would make `lintText` return a `ruleId: null`
    // warning, and "does not restrict the same syntax" would pass because
    // NOTHING was linted rather than because the rule is correctly scoped.
    expect(await lint(`const x = 1 == 1;\n`, OUTSIDE_SCOPE_TSX)).toContain('eqeqeq');
  });
});
