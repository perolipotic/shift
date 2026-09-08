/**
 * The synthesized sign-in address (AD-12), built here and nowhere else.
 *
 * Accounts are usable with no email, so the credential an admin issues is a
 * username — and GoTrue authenticates against an email address. AD-12 closes
 * that gap by synthesizing one per account, namespaced by the organization's
 * slug: `ivan.maric@dvd-kastel-novi.shift.invalid`. `supabase/seed.sql` builds
 * exactly this string with `username || '@' || slug || '.shift.invalid'`, and
 * story 1.5 will build it again when it issues further credentials, so the
 * expression has one home and this is it.
 *
 * Why here rather than either obvious alternative: `prijava.test.ts` makes every
 * non-import string literal in a screen an offence, so a `.tsx` cannot hold the
 * `'@'` or the domain; and `packages/domain` is pure by construction
 * (`eslint.config.js`, `packages/domain/test/purity.test.ts`), which is a rule
 * about dependencies rather than about this — but AD-12's address is an
 * authentication-transport detail, not a domain term, and putting it there would
 * make the domain package the place people look for auth wiring.
 *
 * `.invalid` is reserved by RFC 2606 and can never resolve, which is the point:
 * these addresses are identifiers, never mailboxes. Nothing is ever sent to one,
 * and a typo cannot deliver mail to a real domain.
 *
 * No runtime dependency and no client import, deliberately — this module is a
 * pure function of two strings, so the whole of it is executable from the node
 * suite (AD-15) with nothing running.
 */

/** The reserved domain every synthesized address sits under (RFC 2606). */
export const ADDRESS_DOMAIN = 'shift.invalid';

/** Thrown by `signInAddress` when the slug is not a legal DNS label. */
export const INVALID_ORGANIZATION_SLUG = 'INVALID_ORGANIZATION_SLUG';

/** Thrown by `signInAddress` when the username cannot be a local part. */
export const INVALID_USERNAME = 'INVALID_USERNAME';

/**
 * Logged when the organization prompt's navigation to the tenant's form rejects.
 *
 * Declared HERE rather than in the screen that logs it, for the same reason
 * `signInMessageKey` is not a ternary in `prijava.tsx`: `prijava.test.ts` makes
 * every non-import string literal in a screen an offence, so a `.tsx` cannot
 * hold its own stable code. This module is the one the prompt already imports
 * its decision from, so it is where the code for that decision's one failure
 * belongs. Never rendered — a message on that screen would begin the
 * enumeration oracle it exists to avoid.
 */
export const ORGANIZATION_NAVIGATION_FAILED = 'ORGANIZATION_NAVIGATION_FAILED';

/**
 * The slug rule, verbatim from `0002_organizations_and_members.sql`.
 *
 * Two halves, and both are load-bearing. The pattern is what a DNS label may
 * hold — lowercase alphanumerics in hyphen-separated runs, so no leading,
 * trailing or doubled hyphen — and 63 is the DNS label length limit. Without the
 * length half the pattern admits a slug that cannot appear in a hostname, and
 * the first thing built from it is the domain part of every sign-in address.
 */
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SLUG_MAX_LENGTH = 63;

/** Whether a URL segment could be an organization slug at all. */
export function isOrganizationSlug(slug: string): boolean {
  return slug.length <= SLUG_MAX_LENGTH && SLUG_PATTERN.test(slug);
}

/**
 * What the organization prompt does with what somebody typed: the slug to
 * navigate to, or `null` for "do not navigate".
 *
 * Extracted from the screen rather than written inside it, for the reason
 * `apps/web/src/i18n/boot.ts` was extracted from `main.tsx`: AD-15 bans jsdom
 * and `.tsx` files are not collected, so a decision left in a component can
 * only ever be regexed, and a regex over source cannot tell a guard that runs
 * from a guard that was written and then bypassed. Here the decision is
 * executed, one case per outcome.
 *
 * Trimming and lowercasing before the check rather than rejecting on them: a
 * slug is a DNS label, and the two things a person does to one while typing it
 * are add a space and hold shift. Neither is a mistake worth a refusal.
 *
 * TWO CALLERS, and the second is security-relevant rather than cosmetic, so
 * changing this function's behaviour for the prompt's sake changes the auth path
 * too. `prijava-organizacija.tsx` asks it where to navigate; `sign-in.ts` asks
 * it whether to make an authentication request at all, and `prijava.tsx`'s
 * `beforeLoad` asks it whether the form should render for this URL. Its name
 * says "destination" because the prompt came first — read it as the slug rule,
 * and add a case here only if all three callers want it.
 */
export function organizationDestination(typed: string): string | null {
  const slug = typed.trim().toLowerCase();

  return isOrganizationSlug(slug) ? slug : null;
}

/**
 * A username cannot carry whitespace or a second `@`: either makes the address
 * built from it something other than the address the account holds.
 */
const UNBUILDABLE_IN_A_LOCAL_PART = /[\s@]/;

/**
 * What somebody typed into the username field, as the account's local part —
 * or `null` for "this can never name an account".
 *
 * Trimmed and lowercased, for exactly the reason `organizationDestination`
 * trims and lowercases the other half: the two things a person does to an
 * identifier while typing it are add a space and hold shift, and neither is a
 * mistake. Without this, `Ivan.Maric` and a pasted ` ivan.maric ` build
 * addresses no account holds, and the answer is the ordinary refusal — which is
 * unrecoverable, because it is indistinguishable from a wrong password and the
 * screen may not say which.
 *
 * Rejection is deliberately narrow. Story 1.5 issues usernames and this module
 * must not decide their shape a story early, so what is refused here is only
 * what makes the ADDRESS wrong: nothing at all, and characters that cannot sit
 * in a local part.
 */
export function normalizeUsername(username: string): string | null {
  const normalized = username.trim().toLowerCase();

  if (normalized === '' || UNBUILDABLE_IN_A_LOCAL_PART.test(normalized)) return null;

  return normalized;
}

/**
 * AD-12's address for one member of one organization.
 *
 * Both halves are NORMALIZED and then checked, rather than trusted: the slug
 * arrives from the URL and the username from a text field, and anything can be
 * typed into either. A caller that wants to decide what an unusable value means
 * — and the sign-in path does, since it must disclose nothing about which
 * organizations or usernames exist — asks `organizationDestination` and
 * `normalizeUsername` first and never sees these throws.
 *
 * The throws remain because this function has a second caller shape ahead of it
 * (story 1.5 issues credentials against the same expression) and an address
 * built from an unusable part is worse than no address: it authenticates
 * nothing, silently, forever.
 */
export function signInAddress(username: string, slug: string): string {
  const account = normalizeUsername(username);

  if (account === null) throw new Error(INVALID_USERNAME);

  const organization = organizationDestination(slug);

  if (organization === null) throw new Error(INVALID_ORGANIZATION_SLUG);

  return `${account}@${organization}.${ADDRESS_DOMAIN}`;
}
