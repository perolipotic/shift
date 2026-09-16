import {
  MEMBER_ROLE_REFUSED,
  MEMBER_ROLE_UNAVAILABLE,
  MEMBER_ROLE_UNRECOGNISED,
  type MemberRoleFailure,
} from '@/navigation/role';
import { SIGN_OUT_FAILED, type SignOutFailure } from '@/supabase/sign-out';

/**
 * The message key each chrome failure renders as — the edge, and the only place
 * one of these codes becomes Croatian.
 *
 * Here rather than as a ternary in the chrome, and that placement is the whole
 * point: a `.tsx` is collected by nothing (AD-15), so a mapping written there
 * can only be read as source text — and swapping two branches passes every
 * source-level assertion while a refused sign-out reports that navigation could
 * not be loaded and a broken role read tells somebody their sign-out failed.
 * Both are directly actionable and both would be wrong.
 * `@/supabase/sign-in`'s `signInMessageKey` set this shape and
 * `@/organization/messages` is the second instance; this is the third, which is
 * what makes it a pattern rather than a coincidence.
 *
 * ONE FUNCTION FOR BOTH VOCABULARIES, for the reason `organizationMessageKey`
 * gives: the chrome shows exactly one message region, because a second
 * `role="alert"` would be a second thing competing to be announced. One region
 * needs one mapping, and a chrome-side ternary choosing between two mappings
 * would be exactly the executed-by-nothing branch this file exists to abolish.
 *
 * FOUR CODES, TWO MESSAGES, and the collapse is deliberate in one direction and
 * the split in the other.
 *
 * The three role failures collapse, and the collapse is REQUIRED rather than
 * merely convenient: the story's frozen I/O matrix gives "role read refused or
 * unavailable" and "unrecognised role text" the same expected behaviour in so
 * many words — "same reported state as above, not a silent empty filter". A
 * third message here would be this file quietly renegotiating a frozen row.
 *
 * It is also the right answer on its own terms, with one reservation worth
 * writing down. The three differ in what went wrong — this session reaches no
 * member row, the database holds a level this build does not know, the request
 * never landed — and naming the difference would mean writing `'supervisor'`, or
 * a PostgREST code, onto a screen; those are facts about the DATABASE rather
 * than actions, and they are LOGGED instead, where whoever can act on them
 * looks.
 *
 * THE RESERVATION IS `MEMBER_ROLE_REFUSED`, and it is a real one: a deactivated
 * account cannot fix itself by retrying, so a message that invites a retry is
 * inviting one that will not work. It is knowingly shared anyway, for two
 * reasons. The matrix above is the first. The second is that a retry is not
 * useless even there — the refusal is a fact about the database AT THE MOMENT OF
 * THE READ, so an account an administrator has just reactivated is fixed by
 * exactly the re-read the chrome's retry control performs, with no reload and no
 * new sign-in. What the message must not do is promise more than that, which is
 * why it states what happened and the CONTROL beside it carries the action.
 *
 * What the collapse must NOT do, and does not, is make a failure look like an
 * empty navigation: the message is rendered either way, so "no destinations and
 * it says why" is never mistaken for "no destinations".
 *
 * The sign-out failure stays separate because it is a DIFFERENT action. The
 * person pressed a control and the session did not end — they are still signed
 * in, and telling them that is the only honest thing to say; folding it into the
 * navigation message would report the press as a navigation problem and leave
 * somebody on a shared device believing they had signed out.
 *
 * The return type is the literal union rather than `string`, so `t()` still
 * type-checks the key against `hr.json` (`i18n/index.ts`) and a key deleted from
 * the resource file is a `pnpm typecheck` failure rather than a `⟦…⟧` on screen.
 */
export function navigationMessageKey(
  failure: MemberRoleFailure | SignOutFailure,
): 'shell.error.destinations' | 'shell.error.signOut' {
  if (failure === MEMBER_ROLE_REFUSED) return 'shell.error.destinations';
  if (failure === MEMBER_ROLE_UNRECOGNISED) return 'shell.error.destinations';
  if (failure === MEMBER_ROLE_UNAVAILABLE) return 'shell.error.destinations';
  if (failure === SIGN_OUT_FAILED) return 'shell.error.signOut';

  // EXHAUSTIVE, and `never` is what makes it so — the idiom
  // `@/organization/messages` records. Written as a fall-through this mapping
  // would answer "navigation could not be loaded" for any code it had not been
  // taught, which is wrong in the one direction that matters: it would report a
  // failed sign-out as a navigation problem. Assigning to `never` turns a fifth
  // code into a `pnpm typecheck` failure here, at the one place it has to be
  // taught. If one ever reaches this line at runtime it is returned as itself,
  // which `t()` renders as a visibly missing key rather than a confident lie.
  const unhandled: never = failure;

  return unhandled;
}
