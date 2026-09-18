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
 * WHY THE ALPHABET IS SHORTER THAN YOU WOULD WRITE BY HAND. This credential is
 * READ ALOUD or copied off a screen by somebody who cannot be sent a link, so
 * every pair a person confuses in that setting is excluded — and excluded on
 * BOTH SIDES, which is the half that is easy to get wrong. Dropping `0`, `O`,
 * `1`, `l` and `I` while keeping lowercase `o` and `i` leaves precisely the
 * confusion the exclusion exists to prevent: `o` against `0` is gone but `o`
 * against `O` never was, and `i` against `l` is gone but `i` against `1` never
 * was. So {@link AMBIGUOUS} is closed under the pairs, not a sample of them.
 *
 * WHY REJECTION SAMPLING. `bytes[i] % alphabet.length` is the obvious line and
 * it is biased: 256 is not a multiple of the alphabet's length, so the first
 * `256 mod length` characters come up more often than the rest. The bias is
 * small and it is also completely invisible — every password still looks random
 * — which is why it has to be refused by construction rather than noticed.
 * Bytes at or above {@link PASSWORD_ACCEPTABLE_BYTES} are DISCARDED and redrawn.
 *
 * EVERY FIGURE HERE IS COMPUTED FROM THE LITERAL. The alphabet's size, the
 * entropy and the discard rate are derived below rather than written into this
 * comment, because a number in prose beside the thing it describes is never
 * wrong at the moment somebody reads it and is stale by the next commit — and
 * the 1.5b review found exactly that: arithmetic asserted beside an alphabet it
 * no longer described.
 *
 * THE BYTE SOURCE IS A PARAMETER, so `test/admin-auth-boundary.test.ts` can
 * prove the generator CONSUMES it — hand it a source that only ever yields a
 * byte in the discard band followed by an acceptable one, and a generator that
 * quietly fell back to `Math.random` answers the wrong string. Default is
 * `crypto.getRandomValues`, which both Deno and the node suite provide.
 */

/**
 * Characters excluded because a person reading the credential aloud, or typing
 * it off a screen, confuses them with another character in the set.
 *
 * CLOSED UNDER THE PAIRS: `0/O/o` is one equivalence class and `1/l/I/i` is
 * another, and every member of both is here. Removing one side of a pair is
 * worse than removing neither, because it leaves a set that LOOKS curated.
 */
export const AMBIGUOUS = '0Oo1lIi';

function withoutAmbiguous(characters: string): string {
  return [...characters].filter((character) => !AMBIGUOUS.includes(character)).join('');
}

const UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const LOWERCASE = 'abcdefghijklmnopqrstuvwxyz';
const DIGITS = '0123456789';

/**
 * The alphabet, DERIVED from the three ranges and the exclusion rather than
 * typed out.
 *
 * Typed out, the exclusion becomes a claim about a string somebody transcribed,
 * and the one character accidentally left in is invisible — it reads as a
 * perfectly ordinary letter. Derived, the exclusion is executable, and
 * `test/admin-auth-boundary.test.ts` asserts both that every ambiguous
 * character is absent and that `PASSWORD_ALPHABET.length` equals the value the
 * arithmetic below is computed from.
 */
export const PASSWORD_ALPHABET =
  withoutAmbiguous(UPPERCASE) + withoutAmbiguous(LOWERCASE) + withoutAmbiguous(DIGITS);

/** How many characters a generated credential carries. */
export const PASSWORD_LENGTH = 16;

/** One byte's worth of values. Named because three figures below divide by it. */
const BYTE_VALUES = 256;

/**
 * The highest byte value that can be mapped without bias, exclusive.
 *
 * The largest multiple of the alphabet's length that fits in a byte. Every byte
 * below it maps to exactly one character with exactly the same probability as
 * every other; every byte at or above it is discarded.
 */
export const PASSWORD_ACCEPTABLE_BYTES =
  PASSWORD_ALPHABET.length * Math.floor(BYTE_VALUES / PASSWORD_ALPHABET.length);

/** The share of drawn bytes the rejection sampler throws away. Computed, so it
 *  cannot disagree with the alphabet it is a property of. */
export const PASSWORD_DISCARD_RATE = (BYTE_VALUES - PASSWORD_ACCEPTABLE_BYTES) / BYTE_VALUES;

/** How much a generated credential is actually worth, in bits. Computed. */
export const PASSWORD_BITS_OF_ENTROPY = PASSWORD_LENGTH * Math.log2(PASSWORD_ALPHABET.length);

/** A source of uniformly random bytes. A PARAMETER — see the header. */
export type ByteSource = (count: number) => Uint8Array;

/** The real one. `crypto` is a global in Deno and in the node suite alike, so
 *  this module needs no import and stays assertable from both. */
export const cryptoRandomBytes: ByteSource = (count) =>
  crypto.getRandomValues(new Uint8Array(count));

/**
 * One credential.
 *
 * THE LOOP CANNOT HANG on a real byte source: the discard band is a fraction of
 * a byte's range ({@link PASSWORD_DISCARD_RATE}), so the expected number of
 * draws per character is a small constant and the probability of a long run of
 * discards falls off geometrically. It CAN hang on a deliberately adversarial
 * source that yields only discarded bytes — which is a property of the stub, not
 * of this function, and the alternative (a bounded loop that gives up and
 * returns a short password) fails in the one direction that must never happen
 * silently.
 *
 * Bytes are drawn in batches of the remaining length rather than one at a time,
 * so a source backed by a syscall is asked a handful of times rather than
 * sixteen-plus.
 */
export function generatePassword(randomBytes: ByteSource = cryptoRandomBytes): string {
  const characters: string[] = [];

  while (characters.length < PASSWORD_LENGTH) {
    const drawn = randomBytes(PASSWORD_LENGTH - characters.length);

    for (const byte of drawn) {
      if (characters.length === PASSWORD_LENGTH) break;
      // THE DISCARD. Without it, `byte % length` is biased toward the first
      // `256 mod length` characters of the alphabet — invisibly.
      if (byte >= PASSWORD_ACCEPTABLE_BYTES) continue;

      characters.push(PASSWORD_ALPHABET[byte % PASSWORD_ALPHABET.length] ?? '');
    }
  }

  return characters.join('');
}
