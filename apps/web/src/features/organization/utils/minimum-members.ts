/**
 * Minimum members as the organization screen enters it (story 11.1; FR-70).
 *
 * The column is a nullable `smallint` under `organizations_minimum_members_check`
 * (`>= 1`, `0048`): empty is "not set", and then nothing is short-staffed.
 */

/** The largest number the `smallint` column can hold: the parser refuses anything above it. */
export const MINIMUM_MEMBERS_MAX = 32767;

/** What the field yields: a value to send, or a refusal before anything is sent. */
export type EnteredMinimumMembers =
  | { readonly ok: true; readonly value: number | null }
  | { readonly ok: false };

/**
 * The value a typed field means: empty (or only white space) is `null`, which
 * clears the setting; a whole number from 1 to {@link MINIMUM_MEMBERS_MAX} is
 * itself. Anything else — zero, a negative, a fraction, an exponent, text, or
 * a number the column cannot hold — is refused here, so it never reaches the
 * database as a refusal about a storage type.
 */
export function enteredMinimumMembers(value: FormDataEntryValue | null): EnteredMinimumMembers {
  // No entry at all is an empty field; a `File` is no number.
  if (value === null) return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false };

  const trimmed = value.trim();

  if (trimmed === '') return { ok: true, value: null };
  // DIGITS ONLY: `Number` would also read `1e1`, `0x10` and `+3`.
  if (!/^\d+$/.test(trimmed)) return { ok: false };

  const parsed = Number(trimmed);

  if (parsed < 1 || parsed > MINIMUM_MEMBERS_MAX) return { ok: false };

  return { ok: true, value: parsed };
}
