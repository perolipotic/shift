/**
 * Names as the database compares them, as a pure module (AD-15).
 *
 * THE CLIENT HALF OF `0024`'s `private.name_key(text)`. Every name check there is
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

/**
 * The white space a name is trimmed of, one character per code point, in the
 * order `0024`'s `btrim` list spells it. The Deno copy in
 * `supabase/functions/admin-auth/operations.ts` must equal this string;
 * `test/admin-auth-boundary.test.ts` compares the two.
 */
export const NAME_WHITESPACE =
  '\u0009\u000A\u000B\u000C\u000D\u001C\u001D\u001E\u001F\u0020\u0085\u00A0\u1680' +
  '\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A' +
  '\u2028\u2029\u202F\u205F\u3000\uFEFF';

const WHITE = new Set(NAME_WHITESPACE);

/**
 * A name without the white space around it, in the class above.
 *
 * AN INDEX SCAN, NOT A REGEX. An anchored `[class]+$` retries from every run
 * start in V8, so `'a' + ' '.repeat(n) + 'b'` costs O(n²); two scans from the
 * ends are linear. Every character of the class is a single UTF-16 unit, so
 * indexing by code unit is exact.
 */
export function trimName(value: string): string {
  let start = 0;
  let end = value.length;

  while (start < end && WHITE.has(value.charAt(start))) start += 1;
  while (end > start && WHITE.has(value.charAt(end - 1))) end -= 1;

  return value.slice(start, end);
}

/** Whether nothing but white space is left — what `0024`'s checks refuse. */
export function isBlankName(value: string): boolean {
  return trimName(value) === '';
}

/**
 * The key two names are compared by: trimmed, NFC, then lower-cased in
 * Croatian. `Noć` typed composed and `Noć` typed decomposed are one key, as
 * `Tim` and `Tim\t` are.
 *
 * `'hr'` ONLY. `lower()` in the database follows its collation (ICU `en-US`
 * locally), not a language, and the agreement with it is verified by
 * `test/name-key.test.ts` for that local collation only. Croatian lower-cases
 * like the root locale, which is why the two agree; a Turkish or Lithuanian
 * `toLocaleLowerCase` would not, so no other language is accepted.
 */
export function nameKey(value: string): string {
  return trimName(value).normalize('NFC').toLocaleLowerCase('hr');
}

/**
 * The name as it will be stored — `trim()`med, as before — or `null` when the
 * database would refuse it as blank.
 */
export function enteredName(value: string): string | null {
  return isBlankName(value) ? null : value.trim();
}
