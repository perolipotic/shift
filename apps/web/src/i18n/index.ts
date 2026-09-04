import i18next from 'i18next';
import ICU from 'i18next-icu';

import { LOCALE } from '@/i18n/format';
import hr from '@/i18n/locales/hr.json';

/**
 * The i18next instance every surface translates through (story 1.1c).
 *
 * L1/L2 say no user-facing string is hard-coded and that the rule is
 * merge-blocking, so this module plus `eslint.config.js`'s `no-restricted-syntax`
 * block are the two halves of one guard: ESLint refuses the literal, this
 * resolves the key that replaces it.
 *
 * Four decisions worth their lines:
 *
 *   - ICU messages, not i18next's own `_plural` suffixes. Croatian's `one` is
 *     `n % 10 === 1 && n % 100 !== 11`, so `21` is `one` and `22` is `few`
 *     (L7). ICU delegates to `Intl.PluralRules`, which carries the real CLDR
 *     rule; every hand-rolled shape — `count === 1` most of all — gets 21
 *     wrong. `i18next-icu` declares `intl-messageformat` as a *peer*, so
 *     `apps/web/package.json` pins it explicitly or it is simply absent.
 *   - `parseMissingKeyHandler` returns `⟦key⟧` (L5). Never a blank, never a
 *     throw: a blank screen is indistinguishable from a layout bug, and a
 *     throw takes the whole render down for one absent string. The brackets are
 *     U+27E6/U+27E7, outside Latin Extended-A, so a missing key cannot be
 *     mistaken for Croatian content in a screenshot or a diff while the key
 *     stays legible enough to fix.
 *   - `fallbackLng: false`. There is one locale; a fallback chain would mask an
 *     absent `hr` key behind another language's string instead of showing
 *     `⟦key⟧`, which is the opposite of degrading visibly.
 *   - `i18nFormat.parseErrorHandler` routes a message that cannot be FORMATTED
 *     to the same `⟦key⟧` placeholder as a message that cannot be FOUND. Both
 *     are L5's "degrades visibly and safely", and without it two shapes reach
 *     the user raw: `t('count.days')` with no `count` renders the ICU source
 *     text `{count, plural, one {# dan} …}` on screen (intl-messageformat
 *     throws `MissingValueError`, and the plugin's DEFAULT handler returns the
 *     untranslated source), and `t('count')` — a parent node rather than a
 *     leaf — resolves to the resource OBJECT, which makes React throw
 *     "Objects are not valid as a React child" and takes the screen down. Note
 *     this must be passed under `i18nFormat`, not at the top level: the plugin
 *     reads its own options from `i18next.options.i18nFormat`, so a
 *     `parseErrorHandler` set beside `lng` is silently ignored.
 *   - `escapeVariables: false`, on the plugin — which is where escaping is
 *     actually decided. It is the plugin's default; it is stated because it is
 *     the flag that governs. i18next's own `interpolation.escapeValue` does
 *     NOT apply here and is deliberately absent: `extendTranslation` hands the
 *     message to `i18nFormat.parse` and never reaches its own interpolator, so
 *     that option changes no output under ICU (measured both ways). React
 *     escapes at render, and interpolated values are member and team names
 *     typed by an admin, never markup.
 *
 * Resources are bundled, not fetched: `init` therefore has no network step, but
 * it is still awaited before the first render (`main.tsx`) so no surface can
 * mount against an instance whose store is empty.
 */

/** The language tag i18next resolves against. One locale in MVP (L3). */
export const LANGUAGE = LOCALE;

/** What an absent key renders as (L5). Exported so tests name it once. */
export function missingKeyPlaceholder(key: string): string {
  return `⟦${key}⟧`;
}

export const i18n = i18next.createInstance();

/** Initializes the instance. Must resolve before the first render. */
export function initLocalization(): Promise<unknown> {
  return i18n.use(ICU).init({
    lng: LANGUAGE,
    supportedLngs: [LANGUAGE],
    fallbackLng: false,
    resources: { [LANGUAGE]: { translation: hr } },
    returnNull: false,
    parseMissingKeyHandler: (key: string) => missingKeyPlaceholder(key),
    i18nFormat: {
      escapeVariables: false,
      parseErrorHandler: (_error: Error, key: string) => missingKeyPlaceholder(key),
    },
  });
}

/**
 * The typed `t`.
 *
 * `i18n.t` is bound once when the instance is created and keeps that identity
 * across `init`, so exporting the reference directly — rather than a wrapper,
 * which would erase `TFunction`'s generics and with them the key typing below —
 * is safe. `format.test.ts` asserts it, so an i18next release that started
 * rebinding `t` fails a test instead of shipping a permanently empty `t`.
 */
export const t = i18n.t;

/**
 * Key typing. With this augmentation `t('count.days')` compiles and
 * `t('count.dayz')` does not, which moves a whole class of L1 defect —
 * the key that silently renders `⟦…⟧` — from runtime to `pnpm typecheck`.
 */
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    returnNull: false;
    resources: { translation: typeof hr };
  }
}
