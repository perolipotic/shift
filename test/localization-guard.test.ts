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
const component = (body: string): string => `export function Probe() {\n  return ${body};\n}\n`;
const fragment = (body: string): string => `(<>${body}</>)`;

/** Croatian words a real surface would want, so the cases read like the
 *  mistake they model. */
const DANAS = 'Danas';
const ZATVORI = 'Zatvori';

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

describe('the L2 guard stays silent on compliant markup', () => {
  it.each(COMPLIANT)('accepts $name', async ({ source }) => {
    expect(await lint(source)).not.toContain(RULE);
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
