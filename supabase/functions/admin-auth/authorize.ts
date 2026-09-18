/**
 * AD-16's authorization, as a pure function over what the DATABASE says.
 *
 * THE RULE IS ONE SENTENCE AND EVERY WORD OF IT IS LOAD-BEARING: the caller must
 * be an ACTIVE ADMIN of the TARGET MEMBER'S OWN ORGANIZATION. Not an admin of
 * some organization; not an account that used to be one; not whoever the request
 * body says it is. The request is data, and the only place any of those three
 * facts exists is `public.current_member_access()` (`0003:107-120`), read as the
 * caller so row level security and the account's live state both apply.
 *
 * READ AS THE CALLER, NEVER WITH THE SECRET KEY. `current_member_access()` takes
 * no argument and answers about `auth.uid()` — there is nowhere to name a
 * subject — so reading it through the caller's JWT client is what makes the
 * answer be about the caller at all. The same call made with the secret key
 * would carry no `auth.uid()` and would answer about nobody.
 *
 * THREE REFUSALS, ONE CODE. Inactive, not an admin, and an admin of a different
 * organization all answer {@link NOT_AN_ADMIN} and nothing else. A caller who
 * can tell those apart learns whether a given organization exists and whether
 * their own account was deactivated or merely demoted — an oracle on the one
 * boundary in the system that holds the secret key. A read that could not be
 * PERFORMED is different in kind and gets its own code: it is not a decision
 * about the caller, and reporting it as one would tell a legitimate admin to ask
 * for rights they already hold, over an outage.
 *
 * A SEPARATE MODULE, and it imports nothing — `handler.ts`'s own property. That
 * is what lets `test/admin-auth-boundary.test.ts` drive every branch from the
 * node environment with a stub, which is the only way any of this is executed
 * at all (AD-15).
 */

/**
 * The permission level that administers an organization.
 *
 * PINNED AGAINST THE DATABASE, not against itself. `members.role` carries a
 * check constraint admitting exactly `'admin'` and `'member_role'`
 * (`0002:140`), and this value is the first of those two. A test that imported
 * this constant, built its stub's answer from it and compared the two would
 * assert nothing whatsoever: setting it to `'administrator'` would leave the
 * whole suite green while this boundary answered {@link NOT_AN_ADMIN} to every
 * legitimate administrator and no account could ever be issued. So
 * `test/admin-auth-boundary.test.ts` reads the check constraint out of `0002`
 * and asserts this value is one of the levels it names.
 */
export const ADMIN_ROLE = 'admin';

/**
 * The database function this authorization is made of, by name.
 *
 * A CONSTANT because it crosses a wire: it is a PostgREST RPC path, so a typo
 * is a 404 at runtime and nothing in TypeScript can see it. Pinned in
 * `test/admin-auth-boundary.test.ts` against the `create function` statement in
 * `0003` rather than against itself, for the reason {@link ADMIN_ROLE} is.
 */
export const CURRENT_MEMBER_ACCESS = 'current_member_access';

/** The caller is not an active admin of the target's organization. One code for
 *  all three, deliberately — see the header. */
export const NOT_AN_ADMIN = 'NOT_AN_ADMIN';

/** The access read could not be performed at all. Never a decision about the
 *  caller: an outage reported as a refusal sends an entitled admin to ask for
 *  rights they already hold. */
export const ACCESS_UNREADABLE = 'ACCESS_UNREADABLE';

export type AuthorizationFailure = typeof NOT_AN_ADMIN | typeof ACCESS_UNREADABLE;

/** What `current_member_access()` answers, in the caller's own terms. */
export interface MemberAccess {
  readonly organizationId: string;
  readonly role: string;
  readonly isActive: boolean;
}

export type AuthorizationOutcome =
  | { readonly ok: true; readonly access: MemberAccess }
  | { readonly ok: false; readonly code: AuthorizationFailure };

/** As much of a PostgREST error as this module reads — whether there is one. */
export interface AccessFailure {
  readonly code?: string | undefined;
  readonly message?: string | undefined;
}

/** What the one call resolves to. `data` is `unknown` because a seam can
 *  resolve to anything, and reading a field off a string throws. */
export interface AccessAnswer {
  readonly data: unknown;
  readonly error: AccessFailure | null;
}

/**
 * The one call this module makes, named structurally so it can be stubbed.
 *
 * `rpc` AND NOTHING ELSE — no `from`, so this module structurally cannot read a
 * table, and the authorization cannot quietly start consulting one.
 */
export interface AccessReader {
  rpc(name: string): PromiseLike<AccessAnswer>;
}

/**
 * One row of `current_member_access()` as {@link MemberAccess}, or `null`.
 *
 * VALIDATED, never cast. `is_active` is computed in SQL from `deleted_at` and
 * `banned_until`, and a cast would make a missing column read as `undefined`,
 * which is falsy — so the validation failing closed here is the difference
 * between refusing an unreadable answer and refusing every admin.
 */
function accessOf(row: unknown): MemberAccess | null {
  if (typeof row !== 'object' || row === null || Array.isArray(row)) return null;

  const fields = row as Record<string, unknown>;
  const organizationId = fields['organization_id'];
  const role = fields['member_role'];
  const isActive = fields['is_active'];

  if (typeof organizationId !== 'string' || organizationId === '') return null;
  if (typeof role !== 'string' || role === '') return null;
  if (typeof isActive !== 'boolean') return null;

  return { organizationId, role, isActive };
}

/**
 * Whether the caller may act on `organization`, and nothing else.
 *
 * ORDER IS IRRELEVANT TO THE ANSWER and deliberately so: all three negative
 * branches produce the identical code, so no ordering of them can leak which
 * one fired. What the order does buy is that an unreadable answer is settled
 * FIRST, before any of the three, so an outage can never be dressed up as a
 * refusal by a later check reading `undefined`.
 */
export async function authorizeAdminOf(
  reader: AccessReader,
  organization: string,
): Promise<AuthorizationOutcome> {
  let answered;

  try {
    answered = await reader.rpc(CURRENT_MEMBER_ACCESS);
  } catch (cause) {
    console.error(ACCESS_UNREADABLE, cause);

    return { ok: false, code: ACCESS_UNREADABLE };
  }

  // A SEAM CAN RESOLVE TO ANYTHING. Reading `.error` off a string throws out of
  // a function whose whole contract is that it returns a code, and the throw
  // would surface as a 500 with no code at all.
  if (typeof answered !== 'object' || answered === null || Array.isArray(answered)) {
    console.error(ACCESS_UNREADABLE, typeof answered);

    return { ok: false, code: ACCESS_UNREADABLE };
  }

  if (answered.error !== null) {
    console.error(ACCESS_UNREADABLE, answered.error);

    return { ok: false, code: ACCESS_UNREADABLE };
  }

  // `current_member_access()` returns a SET, so PostgREST answers with an array.
  // NO ROW IS A REFUSAL rather than an outage: the caller holds a token for an
  // account with no member row, which is exactly the fail-closed case
  // `custom_access_token_hook` (`0003:181-206`) produces by removing the claim.
  const rows = Array.isArray(answered.data) ? answered.data : [];
  const access = rows.length === 1 ? accessOf(rows[0]) : null;

  if (access === null) return { ok: false, code: NOT_AN_ADMIN };
  if (!access.isActive) return { ok: false, code: NOT_AN_ADMIN };
  if (access.role !== ADMIN_ROLE) return { ok: false, code: NOT_AN_ADMIN };
  if (access.organizationId !== organization) return { ok: false, code: NOT_AN_ADMIN };

  return { ok: true, access };
}
