import type { Session } from '@supabase/supabase-js';

import type { MemberRole } from '@/navigation/destinations';
import { currentSession, supabaseClient } from '@/supabase/client';

/**
 * The signed-in member's own permission level, READ (the navigation shell, part B).
 *
 * THE ROLE IS READ FRESH AND NEVER CLAIMED, and that is the single decision this
 * module exists to hold. `0003`'s access-control pattern re-reads role and
 * active status on every policy evaluation through a `SECURITY DEFINER STABLE`
 * helper, precisely so a demoted or deactivated account loses access on its next
 * query rather than at token expiry — and `custom_access_token_hook` puts only
 * `organization_id` in the token, deliberately. Adding `member_role` to the hook
 * would save this query and cost that guarantee: a demoted admin would keep
 * seeing admin navigation until their token rolled over, every entry of it
 * refusing on contact. The interface disagreeing with the database is the one
 * thing AD-10 refuses to allow, so navigation follows the same rule the policies
 * do.
 *
 * NO MIGRATION IS NEEDED. `members_select_own_organization` (`0003:289-300`)
 * already permits a session to read its own organization's member rows; this
 * narrows that to the one row that is the caller's own, by `auth_user_id`.
 *
 * THE TABLE IS A PARAMETER and so is the session reader, never an import — the
 * shape `@/organization/snapshot` established and `@/supabase/sign-in` before
 * it. That is what makes every row of the story's I/O matrix executable from the
 * node suite (AD-15) against a stub: no browser, no stack, no environment. The
 * interfaces below are structural and narrow on purpose, so
 * `supabaseClient().from(MEMBERS_TABLE)` satisfies them and a stub does not have
 * to impersonate the rest of PostgREST.
 *
 * WHAT COMES BACK IS TEXT. `role` is a `text` column with a check constraint
 * (`0002:140`), so what PostgREST hands over is a string and nothing about the
 * transport makes it one of two. It is NARROWED BY A RUNTIME GUARD with an
 * explicit unrecognised branch — never a cast — because a cast would let
 * `'supervisor'` through as a `MemberRole`, `destinationsFor` would filter it to
 * an empty list, and the chrome would render an empty bar. An empty bar is
 * indistinguishable from a member with no access at all, which is the one
 * outcome this module must never produce silently.
 *
 * Codes, never messages (the conventions): `{ code }` out of here, translated
 * only at the edge — `@/navigation/messages` is that edge.
 */

/** The relation this module reads. Named here so no component holds it. */
export const MEMBERS_TABLE = 'members';

/**
 * The single query key the chrome's role comes from.
 *
 * A CONSTANT rather than an inline array, for the reason
 * `ORGANIZATION_SNAPSHOT_KEY` is one: two call sites writing `['member']` by
 * hand are two keys the moment one of them gains a qualifier, and the failure is
 * a second network read answering the same question with a different answer.
 * Nothing else is keyed underneath it, because there is exactly one fact here.
 */
export const MEMBER_ROLE_KEY = ['member-role'] as const;

/**
 * The one column this read selects.
 *
 * ONE COLUMN, and the narrowness is the point rather than an optimization: the
 * chrome needs the permission level and nothing else, and a `*` here would put
 * every member field — name, email, leave allowance — into a cache entry that
 * exists to answer one question. A column added to the select is a column some
 * later screen will read from the wrong query key.
 */
export const MEMBER_ROLE_COLUMNS = 'role';

/** The column that identifies the caller's own row (`0002:129`). */
const AUTH_USER_COLUMN = 'auth_user_id';
/**
 * PostgREST's equality operator, named rather than written into a call.
 *
 * The read is `.filter(column, 'eq', value)` and NOT `.eq(column, value)`, which
 * is the same request on the wire and a very different one to the type checker.
 * postgrest-js declares `eq` as a generic whose column and value types are
 * conditional on the parsed column list and which returns `this` — so checking
 * the real builder against a structural interface naming `eq` is a `TS2589`,
 * "type instantiation is excessively deep". `filter` carries a plain
 * `(string, string, unknown)` overload and returns `this` the same way, so the
 * seam stays stubbable and the compiler stays finite. Measured both ways against
 * `@supabase/postgrest-js@2.113.0` rather than guessed.
 */
const EQUALS = 'eq';
/** The column the answer is read out of. */
const ROLE_COLUMN = 'role';

/**
 * How many rows a member's own row may be.
 *
 * `auth_user_id` is `unique` (`0002:129`), so this is belt AND braces — and the
 * braces are what matter, because the failure without them is silent: a read
 * that somehow matched two rows would have this module take `rows[0]` and render
 * an arbitrary role's navigation, internally consistent and wrong. Asking for
 * two and refusing more than one turns that into a reported failure.
 */
const ONE_ROW = 1;

/** This session reaches no member row of its own: no session, or no row. */
export const MEMBER_ROLE_REFUSED = 'MEMBER_ROLE_REFUSED';
/** A row came back carrying a permission level this application does not know. */
export const MEMBER_ROLE_UNRECOGNISED = 'MEMBER_ROLE_UNRECOGNISED';
/** The service could not be reached, or answered with something that is not a row. */
export const MEMBER_ROLE_UNAVAILABLE = 'MEMBER_ROLE_UNAVAILABLE';

export type MemberRoleFailure =
  | typeof MEMBER_ROLE_REFUSED
  | typeof MEMBER_ROLE_UNRECOGNISED
  | typeof MEMBER_ROLE_UNAVAILABLE;

export type MemberRoleOutcome =
  | { readonly ok: true; readonly role: MemberRole }
  | { readonly ok: false; readonly code: MemberRoleFailure };

/** As much of a PostgREST error as this module reads — whether there is one. */
export interface PostgrestFailure {
  // `| undefined` on every member, for the reason `@/organization/snapshot`'s
  // identical interface records: `exactOptionalPropertyTypes` is on and
  // postgrest-js declares these as present-and-possibly-undefined.
  readonly code?: string | undefined;
  readonly message?: string | undefined;
  readonly details?: string | undefined;
}

/** What the call below resolves to. */
export interface PostgrestAnswer {
  readonly data: readonly unknown[] | null;
  readonly error: PostgrestFailure | null;
}

/** The last link of the read chain: `.limit(…)`. See {@link ONE_ROW}. */
export interface MemberRowsFilter {
  limit(count: number): PromiseLike<PostgrestAnswer>;
}

/**
 * The middle of the read chain: the filter that narrows to the caller's own row.
 *
 * Each link is a NAMED interface rather than an object literal written inline,
 * and the operator is `filter` rather than `eq` — see {@link EQUALS}, which is
 * where the reason is written down. `@/organization/snapshot` reaches only two
 * links deep and met neither problem; a filtered read is one link longer.
 */
export interface MemberSelectFilter {
  filter(column: string, operator: string, value: string): MemberRowsFilter;
}

/** The one call this module makes, named structurally so it can be stubbed. */
export interface MemberTable {
  select(columns: string): MemberSelectFilter;
}

/**
 * Every permission level this application knows, as VALUES rather than a type,
 * IN RANK ORDER.
 *
 * A type alone decides nothing at runtime, and the value arriving here is text
 * from a database that a later migration could widen. Listed here so the
 * narrowing below is a lookup in a list somebody can read, and so adding a third
 * level is one edit in one place.
 *
 * EXPORTED, AND THE ORDER IS LOAD-BEARING, since story 1.5a. `/ljudi` is the
 * first route in the tree that refuses a permission level, and it decides by
 * asking whether the session holds `MEMBER_ROLES[0]` rather than by naming a
 * level itself — so reordering this array inverts that guard. That is the
 * mutation the 1.5a review shipped green once: `['member_role', 'admin']` left
 * the whole suite passing while members read every colleague's address and
 * allowance and admins were forwarded away. `members/list.test.ts` therefore
 * pins `MEMBER_ROLES[0]` to the LITERAL `'admin'`, not to a value derived from
 * this array, which is the only form of that assertion a reorder can fail.
 *
 * TYPED AS A NON-EMPTY TUPLE for the reason `DESTINATIONS` is: "there is a
 * first entry" is a property the guard depends on, and under
 * `noUncheckedIndexedAccess` a plain array type makes `[0]` possibly
 * `undefined` — which would leave the guard inventing a fallback for a case
 * this file rules out. There is no honest fallback: an application with no
 * permission levels has nothing to guard.
 *
 * The rank is most-privileged first. `destinationsFor` filters rather than
 * sorts, so nothing about navigation depends on it; the guard does.
 */
export const MEMBER_ROLES: readonly [MemberRole, ...MemberRole[]] = ['admin', 'member_role'];

/**
 * The permission level a value IS, or `null` if it is not one.
 *
 * A GUARD, never a cast, and the difference is what reaches the screen: `value
 * as MemberRole` makes `'supervisor'` a role the type system believes in, which
 * `destinationsFor` then filters to an empty list — an empty navigation bar,
 * byte-identical to what a member with no access would see. `null` is what makes
 * "the application does not recognise this" a case the caller has to handle.
 */
export function memberRoleOf(value: unknown): MemberRole | null {
  return MEMBER_ROLES.find((known) => known === value) ?? null;
}

/**
 * The `role` text on a PostgREST row, or `null` if the row does not carry one.
 *
 * `null` MEANS THE ROW IS MALFORMED, never that the level is unknown, and the
 * two are different failures with different audiences. A row that is not an
 * object, or one with no `role` string on it, is a SERVICE or SCHEMA fault — a
 * renamed column, a partial response, a proxy returning something that is not
 * JSON — and calling that "a permission level this build does not recognise"
 * sends whoever reads the log looking for a migration that does not exist. It
 * also logged the literal `null` as the offending value, which is the least
 * actionable thing it could have said.
 */
function roleTextOf(row: unknown): string | null {
  if (typeof row !== 'object' || row === null || Array.isArray(row)) return null;

  const value = (row as Record<string, unknown>)[ROLE_COLUMN];

  return typeof value === 'string' ? value : null;
}

/**
 * The signed-in member's own role, or one stable code.
 *
 * FOUR WAYS TO FAIL and each is a different fact, though three of them are the
 * same thing to say to the person (see `@/navigation/messages`):
 *
 *   - NO SESSION is a refusal. The layout's guard has already redirected a
 *     signed-out visitor, so reaching this line with no session means the
 *     session went away between the guard and the render — which is exactly the
 *     state a refusal describes, and it must not render a role.
 *   - AN UNREADABLE SESSION is the service's. `currentSession` rejects on a
 *     build with no environment and wherever storage is blocked (Safari's
 *     private mode, a locked-down profile), and neither is evidence about
 *     anybody's permissions.
 *   - NO ROW is the policy's silent refusal. Row level security fails USING, the
 *     statement matches nothing and raises nothing — a deactivated account and a
 *     missing member row both arrive exactly here.
 *   - AN UNRECOGNISED LEVEL is LOGGED WITH THE VALUE, and it is the only failure
 *     here that leaves a trace. The other three are visible in the interface as
 *     the thing that just happened; this one is a fact about the DATABASE that
 *     no message can carry (the person cannot act on `'supervisor'`), and
 *     without the log the first symptom is navigation that quietly stopped
 *     listing anything.
 */
export async function readMemberRole(
  table: MemberTable,
  session: () => Promise<Session | null>,
): Promise<MemberRoleOutcome> {
  let current: Session | null;

  try {
    current = await session();
  } catch (cause) {
    // NOT SWALLOWED. A rejection here is usually `SUPABASE_ENVIRONMENT_MISSING`
    // from a build with no environment, which is a misconfiguration that would
    // otherwise read as an ordinary outage — the exact disguise `@/supabase/
    // client` exists to refuse.
    console.error(MEMBER_ROLE_UNAVAILABLE, cause);

    return { ok: false, code: MEMBER_ROLE_UNAVAILABLE };
  }

  if (current === null) return { ok: false, code: MEMBER_ROLE_REFUSED };

  let answered;

  try {
    // `limit(ONE_ROW + 1)`, not `limit(1)`, and the extra row is the assertion:
    // asking for one and taking it makes a widened policy invisible, because a
    // truncated answer looks exactly like a correct one.
    answered = await table
      .select(MEMBER_ROLE_COLUMNS)
      .filter(AUTH_USER_COLUMN, EQUALS, current.user.id)
      .limit(ONE_ROW + 1);
  } catch (cause) {
    // A rejected promise is the transport failing outside postgrest-js's own
    // error mapping — a blocked request, an aborted navigation, a DNS failure.
    // LOGGED WITH ITS CAUSE, like every other failure here: a discarded cause is
    // a module that reports "try again" forever with nothing anywhere to say
    // what is actually wrong, which is the disguise this file argues against
    // three paragraphs above and used to practise here.
    console.error(MEMBER_ROLE_UNAVAILABLE, cause);

    return { ok: false, code: MEMBER_ROLE_UNAVAILABLE };
  }

  // AN ERROR IS NEVER A REFUSAL on this table. A refused policy returns an empty
  // row set and raises nothing, so an `error` that reached here is a transport
  // or a schema fault — reporting it as "you have no access" would send somebody
  // to ask for rights they already hold, over a renamed column. The error OBJECT
  // is what names which: `42703` is a column that no longer exists and `42501`
  // is a privilege, and neither is legible from the code alone.
  if (answered.error !== null) {
    console.error(MEMBER_ROLE_UNAVAILABLE, answered.error);

    return { ok: false, code: MEMBER_ROLE_UNAVAILABLE };
  }

  const rows = answered.data ?? [];

  if (rows.length === 0) return { ok: false, code: MEMBER_ROLE_REFUSED };

  if (rows.length > ONE_ROW) {
    // The count is the whole diagnosis, and it is a fact about the POLICY rather
    // than about this caller — `auth_user_id` is unique, so more than one row
    // means something upstream widened.
    console.error(MEMBER_ROLE_UNAVAILABLE, rows.length);

    return { ok: false, code: MEMBER_ROLE_UNAVAILABLE };
  }

  const text = roleTextOf(rows[0]);

  // MALFORMED IS UNAVAILABLE, not unrecognised. See {@link roleTextOf}: a row
  // that carries no `role` string is the service's fault, and the row itself is
  // what somebody debugging it needs to see.
  if (text === null) {
    console.error(MEMBER_ROLE_UNAVAILABLE, rows[0]);

    return { ok: false, code: MEMBER_ROLE_UNAVAILABLE };
  }

  const role = memberRoleOf(text);

  if (role === null) {
    console.error(MEMBER_ROLE_UNRECOGNISED, text);

    return { ok: false, code: MEMBER_ROLE_UNRECOGNISED };
  }

  return { ok: true, role };
}

/**
 * The role reader the router binds into its context, and the one place this
 * module's two seams are tied to the real client.
 *
 * THE SEAMS ABOVE STAY SEAMS. `readMemberRole` takes its table and its session
 * reader as parameters and must keep doing so — that is what makes every row of
 * the I/O matrix executable from the node suite against a stub. This is the
 * single BINDING of those parameters to the shipped client, named here so
 * `router.ts` can import it.
 *
 * IMPORTED RATHER THAN WRITTEN AS AN ARROW IN `router.ts`, for the reason that
 * file records about `currentSession`: an arrow in the router's own context
 * object is executed by no test at all — `router.test.ts` supplies its own
 * context — so a stub left there would keep the suite green while `/ljudi`
 * refused every admin. A named export is something a test can pin by identity,
 * and `router.test.ts` does.
 *
 * It constructs nothing at module load: `supabaseClient()` is memoized and
 * called here, inside the function, so importing this module still needs no
 * environment and `VITE_SUPABASE_URL=""` still runs the router suite.
 */
export function currentMemberRole(): Promise<MemberRoleOutcome> {
  return readMemberRole(supabaseClient().from(MEMBERS_TABLE), currentSession);
}
