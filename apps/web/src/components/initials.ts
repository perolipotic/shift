/**
 * Initials, as a pure module (visual refresh B, AD-15).
 *
 * The avatar chips on the member list and the roster draw {@link initialsOf},
 * and the organization lockup's neutral mark draws {@link leadingCharacterOf}.
 * Both are decisions a `.tsx` must not make, because nothing executes a `.tsx`.
 *
 * TWO FUNCTIONS, BECAUSE THE TWO RULES DIFFER. The lockup's mark is the first
 * code point of the name, whatever it is (`logo.test.ts` pins that). An avatar's
 * initials are the first LETTER of a word: a leading bracket, digit or emoji is
 * not an initial, and a word with no letter in it is not a word for this.
 *
 * NFC FIRST, AND A LETTER KEEPS ITS COMBINING MARKS. `slice(0, 1)` counts UTF-16
 * code units, so a decomposed `Č` would render as a bare `C`. Normalizing, then
 * taking a letter together with every mark that follows it, keeps Croatian
 * diacritics on their letters even where NFC has no composed form. `Intl` is
 * constructed only in `@/i18n/format`, so no segmenter is used here.
 */

/** A letter and every combining mark after it. */
const LETTER = /\p{L}\p{M}*/u;

/**
 * The first character of a text, after NFC and trimming, or `null` when the
 * text is blank. The case is kept as written. This is the lockup mark's rule.
 */
export function leadingCharacterOf(text: string): string | null {
  const trimmed = text.normalize('NFC').trim();

  return trimmed === '' ? null : ([...trimmed][0] ?? null);
}

/**
 * The initials a chip shows for a name: the first letter of the first word and
 * the first letter of the last word that HAVE a letter, upper-cased in
 * Croatian. One such word gives one letter. `null` when no word has a letter,
 * so the caller draws an empty chip rather than a punctuation mark.
 */
export function initialsOf(name: string): string | null {
  const letters = name
    .normalize('NFC')
    .split(/\s+/u)
    .map((word) => LETTER.exec(word)?.[0] ?? null)
    .filter((letter): letter is string => letter !== null);
  const first = letters[0];

  if (first === undefined) return null;

  const last = letters.length > 1 ? (letters[letters.length - 1] ?? '') : '';

  return `${first}${last}`.toLocaleUpperCase('hr');
}
