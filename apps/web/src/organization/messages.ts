import {
  LOGO_REFUSED,
  LOGO_TOO_LARGE,
  LOGO_TYPE_UNSUPPORTED,
  LOGO_UNAVAILABLE,
  LOGO_UNREADABLE,
  type LogoFailure,
} from '@/organization/logo';
import {
  ORGANIZATION_INVALID,
  ORGANIZATION_NAME_BLANK,
  ORGANIZATION_REFUSED,
  ORGANIZATION_TIMEZONE_UNKNOWN,
  ORGANIZATION_UNAVAILABLE,
  type OrganizationFailure,
} from '@/organization/snapshot';

/**
 * The message key each organization failure renders as — the edge, and the only
 * place a code becomes Croatian.
 *
 * Here rather than as a ternary in the screen, and that placement is the whole
 * point: a `.tsx` is collected by nothing (AD-15), so a mapping written there
 * can only be read as source text — and swapping two branches passes every
 * source-level assertion while a refused save reports a service outage and an
 * outage reports a blank name. Both are directly actionable and both would be
 * wrong. `@/supabase/sign-in`'s `signInMessageKey` set this shape; this is the
 * second instance of it, and the reason it is a pattern rather than a one-off.
 *
 * TEN CODES, TEN MESSAGES, and the partition is deliberate in both directions.
 * A refused policy, a blank name, an unknown timezone and a service failure are
 * four different things for the person in front of the screen to do next — earn
 * the rights, fix the field, fix a different field, try again — so collapsing
 * them would cost an action. They are
 * also all POST-authentication, which is why nothing here is narrowed the way
 * `signInMessageKey` narrows three refusals into one: the enumeration-oracle
 * argument applies to an anonymous caller, and this surface is reachable only by
 * a session that already reached its own organization.
 *
 * ONE FUNCTION FOR BOTH VOCABULARIES since story 1.4b, and that is a claim about
 * the SCREEN rather than about tidiness: the settings surface shows exactly one
 * message region, because a second `role="alert"` would be a second thing
 * competing to be announced and the five fields would have to choose which one
 * to point their `aria-describedby` at. One region needs one mapping, and a
 * screen-side ternary choosing between two mappings would be the executed-by-
 * nothing branch this file exists to abolish.
 *
 * The four logo codes describe the storage layer's refusals rather than the
 * table's, and two of them NAME A NUMBER the person can act on — the size bound
 * and the accepted types are properties of the bucket (`0005`), so the message
 * repeats what the database will enforce whatever the interface says.
 *
 * The return type is the literal union rather than `string`, so `t()` still
 * type-checks the key against `hr.json` (`i18n/index.ts`) and a key deleted from
 * the resource file is a `pnpm typecheck` failure rather than a `⟦…⟧` on screen.
 */
export function organizationMessageKey(
  failure: OrganizationFailure | LogoFailure,
):
  | 'organization.error.refused'
  | 'organization.error.name'
  | 'organization.error.invalid'
  | 'organization.error.timezone'
  | 'organization.error.logoRefused'
  | 'organization.error.logoUnreadable'
  | 'organization.error.logoTooLarge'
  | 'organization.error.logoType'
  | 'organization.error.logoUnavailable'
  | 'organization.error.unavailable' {
  if (failure === ORGANIZATION_REFUSED) return 'organization.error.refused';
  if (failure === ORGANIZATION_NAME_BLANK) return 'organization.error.name';
  if (failure === ORGANIZATION_INVALID) return 'organization.error.invalid';
  if (failure === ORGANIZATION_TIMEZONE_UNKNOWN) return 'organization.error.timezone';
  if (failure === LOGO_REFUSED) return 'organization.error.logoRefused';
  // A SEPARATE MESSAGE from the one above, and the separation is the whole
  // reason the read has its own code: `logoRefused` tells somebody they need an
  // administrator's rights to CHANGE the logo, which is true of an account that
  // tried to and false of a member who merely could not see one.
  if (failure === LOGO_UNREADABLE) return 'organization.error.logoUnreadable';
  if (failure === LOGO_TOO_LARGE) return 'organization.error.logoTooLarge';
  if (failure === LOGO_TYPE_UNSUPPORTED) return 'organization.error.logoType';
  if (failure === LOGO_UNAVAILABLE) return 'organization.error.logoUnavailable';
  if (failure === ORGANIZATION_UNAVAILABLE) return 'organization.error.unavailable';

  // EXHAUSTIVE, and `never` is what makes it so. Written as a fall-through this
  // mapping answered "try again" for any code it had not been taught, so an
  // eleventh failure added to either vocabulary would have rendered a message
  // that is wrong in the one direction that matters — it tells somebody a
  // transient problem is transient when it is not. Assigning to `never` turns
  // that into a `pnpm typecheck` failure here, at the one place a new code has
  // to be taught. If one ever reaches this line at runtime it is returned as
  // itself, which `t()` renders as a visibly missing key rather than as a
  // confident lie (L1).
  const unhandled: never = failure;

  return unhandled;
}
