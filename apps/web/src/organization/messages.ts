import {
  ORGANIZATION_INVALID,
  ORGANIZATION_NAME_BLANK,
  ORGANIZATION_REFUSED,
  ORGANIZATION_TIMEZONE_UNKNOWN,
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
 * FIVE CODES, FIVE MESSAGES, and the partition is deliberate in both directions.
 * A refused policy, a blank name, an unknown timezone and a service failure are
 * four different things for the person in front of the screen to do next — earn
 * the rights, fix the field, fix a different field, try again — so collapsing
 * them would cost an action. They are
 * also all POST-authentication, which is why nothing here is narrowed the way
 * `signInMessageKey` narrows three refusals into one: the enumeration-oracle
 * argument applies to an anonymous caller, and this surface is reachable only by
 * a session that already reached its own organization.
 *
 * The return type is the literal union rather than `string`, so `t()` still
 * type-checks the key against `hr.json` (`i18n/index.ts`) and a key deleted from
 * the resource file is a `pnpm typecheck` failure rather than a `⟦…⟧` on screen.
 */
export function organizationMessageKey(
  failure: OrganizationFailure,
):
  | 'organization.error.refused'
  | 'organization.error.name'
  | 'organization.error.invalid'
  | 'organization.error.timezone'
  | 'organization.error.unavailable' {
  if (failure === ORGANIZATION_REFUSED) return 'organization.error.refused';
  if (failure === ORGANIZATION_NAME_BLANK) return 'organization.error.name';
  if (failure === ORGANIZATION_INVALID) return 'organization.error.invalid';
  if (failure === ORGANIZATION_TIMEZONE_UNKNOWN) return 'organization.error.timezone';

  return 'organization.error.unavailable';
}
