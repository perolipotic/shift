/**
 * Names as the database compares them, as a pure module (AD-15).
 *
 * THE CLIENT HALF OF `0024`'s `public.name_key(text)`. Every name check there is
 * `name_key(name) <> ''` and every name unique index is on `name_key(name)`, so
 * a name is blank, or two names are the same name, exactly when these say so.
 * `test/name-key.test.ts` runs both over every BMP code point and fails the
 * moment they disagree.
 *
 * THE CLASS IS THE UNION of what `String.prototype.trim` strips and what
 * Postgres's `\s` and `[[:space:]]` match (see `0024`'s header): everything
 * `trim` strips, plus U+001C–001F and U+0085. It is spelled out rather than
 * `\s`, because JavaScript's `\s` lacks those five and Postgres's named classes
 * follow the collation.
 *
 * THE STORED VALUE IS NOT THIS. {@link enteredName} still stores `value.trim()`,
 * byte for byte what every name surface stored before `0024`: only the verdict
 * "is anything left" uses the wider class. The key is for comparing, never for
 * writing.
 */

/** The white space a name is trimmed of, as the body of a character class. */
export const NAME_WHITESPACE =
  '\\u0009-\\u000D\\u001C-\\u001F\\u0020\\u0085\\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF';

const EDGES = new RegExp(`^[${NAME_WHITESPACE}]+|[${NAME_WHITESPACE}]+$`, 'gu');

/** A name without the white space around it, in the class above. */
export function trimName(value: string): string {
  return value.replace(EDGES, '');
}

/** Whether nothing but white space is left — what `0024`'s checks refuse. */
export function isBlankName(value: string): boolean {
  return trimName(value) === '';
}

/**
 * The key two names are compared by: trimmed, NFC, then lower-cased in the
 * organization's language. `Noć` typed composed and `Noć` typed decomposed are
 * one key, as `Tim` and `Tim\t` are. The language is the caller's to pass
 * (`LOCALE` from `@/lib/i18n/format`), so this module imports nothing.
 */
export function nameKey(value: string, locale: string): string {
  return trimName(value).normalize('NFC').toLocaleLowerCase(locale);
}

/**
 * The name as it will be stored — `trim()`med, as before — or `null` when the
 * database would refuse it as blank.
 */
export function enteredName(value: string): string | null {
  return isBlankName(value) ? null : value.trim();
}
