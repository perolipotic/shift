/**
 * The initial credential an admin issues, generated here and nowhere else.
 *
 * WHY IT IS GENERATED RATHER THAN TYPED. One admin issuing several hundred
 * credentials converges on one password reused across the organization —
 * `Vatrogasci2026` for everybody, in a system whose whole sign-in story is that
 * accounts are usable by people with no mailbox and therefore no reset path.
 * Generating it inside the function keeps it out of the form, out of the client
 * bundle, out of the request body and out of every log, and leaves exactly one
 * copy: the one shown once on screen.
 *
 * WHY FOUR WORDS (story 7.8, redesign decision 12b). This credential is READ
 * ALOUD or copied off a screen by somebody who cannot be sent a link, and it is
 * no longer the member's password for long: the first sign-in makes them set
 * their own (`app_metadata.must_set_password`). So what it has to be is easy
 * to say and hear — four short lowercase words from {@link WORDS}, joined by
 * {@link WORD_SEPARATOR} — rather than sixteen characters nobody can dictate.
 * The list holds only `a–z`, so no letter is lost between a phone keyboard
 * and a spoken `č`.
 *
 * WHY THERE IS NO REJECTION SAMPLING. The list's length is a power of two, so
 * the low bits of a 16-bit draw map onto it exactly: every 16-bit value is one
 * of `65536 / WORDS.length` values for each word, the same number for every
 * word. `index % length` is biased only when the range is not a multiple of
 * the length, and here it is by construction — which `test/admin-auth-boundary.test.ts`
 * holds by asserting the length is a power of two at all.
 *
 * TWO THINGS THROW RATHER THAN DEGRADE. A list whose length is not a power of
 * two no larger than one 16-bit draw (65536) would make the mask biased or
 * leave words unreachable, so the module refuses to load with one. And a byte
 * source that answers with NO bytes would spin the draw loop for ever, so the
 * generator throws instead — a failed issue, never a hung function.
 *
 * EVERY FIGURE HERE IS COMPUTED FROM THE LIST. The bits per word and the
 * entropy are derived below rather than written into this comment, because a
 * number in prose beside the thing it describes is stale by the next commit —
 * and the 1.5b review found exactly that.
 *
 * THE BYTE SOURCE IS A PARAMETER, so `test/admin-auth-boundary.test.ts` can
 * prove the generator CONSUMES it — hand it a deterministic source, and a
 * generator that quietly fell back to `Math.random` answers the wrong words.
 * Default is `crypto.getRandomValues`, which both Deno and the node suite
 * provide.
 */

import { WORDS } from './words.ts';

/** How many words a generated credential carries. */
export const PASSWORD_WORD_COUNT = 4;

/** Between two words. A hyphen survives being read aloud, typed on a phone
 *  and copied out of a monospace line, and no word in the list contains one. */
export const WORD_SEPARATOR = '-';

/** One draw's width: two bytes, read big-endian. */
const BYTES_PER_DRAW = 2;
const BYTE_BITS = 8;

/** The values one 16-bit draw can take: the ceiling on the list's length. */
const DRAW_VALUES = 2 ** (BYTES_PER_DRAW * BYTE_BITS);

/** A positive power of two no larger than a draw. Checked at load. */
function isDrawablePowerOfTwo(length: number): boolean {
  return Number.isInteger(length) && length > 0 && length <= DRAW_VALUES && (length & (length - 1)) === 0;
}

if (!isDrawablePowerOfTwo(WORDS.length)) {
  throw new Error('PASSWORD_WORDS_NOT_A_POWER_OF_TWO');
}

/** Thrown when the byte source answers with nothing at all. */
export const BYTE_SOURCE_EMPTY = 'BYTE_SOURCE_EMPTY';

/** How many bits each word takes from its draw. Computed from the list. */
export const BITS_PER_WORD = Math.log2(WORDS.length);

/** The low bits of a draw that pick a word. Exact only because the length is a
 *  power of two — see the header. */
const WORD_MASK = WORDS.length - 1;

/** How much a generated credential is actually worth, in bits. Computed. */
export const PASSWORD_BITS_OF_ENTROPY = PASSWORD_WORD_COUNT * BITS_PER_WORD;

/** A source of uniformly random bytes. A PARAMETER — see the header. */
export type ByteSource = (count: number) => Uint8Array;

/** The real one. `crypto` is a global in Deno and in the node suite alike, so
 *  this module needs no import of its own beyond the list. */
export const cryptoRandomBytes: ByteSource = (count) =>
  crypto.getRandomValues(new Uint8Array(count));

/**
 * One credential: {@link PASSWORD_WORD_COUNT} words, each chosen independently
 * and uniformly.
 *
 * A source that answers SHORT is asked again for the rest, rather than padded:
 * a missing byte read as zero is the first word of the list, every time.
 */
export function generatePassword(randomBytes: ByteSource = cryptoRandomBytes): string {
  const needed = PASSWORD_WORD_COUNT * BYTES_PER_DRAW;
  const drawn: number[] = [];

  while (drawn.length < needed) {
    const batch = randomBytes(needed - drawn.length);

    // NOTHING BACK IS NOT "ASK AGAIN": it would loop for ever.
    if (batch.length === 0) throw new Error(BYTE_SOURCE_EMPTY);

    for (const byte of batch) {
      if (drawn.length === needed) break;
      drawn.push(byte);
    }
  }

  const words: string[] = [];

  for (let at = 0; at < needed; at += BYTES_PER_DRAW) {
    const draw = ((drawn[at] ?? 0) << BYTE_BITS) | (drawn[at + 1] ?? 0);

    words.push(WORDS[draw & WORD_MASK] ?? '');
  }

  return words.join(WORD_SEPARATOR);
}
