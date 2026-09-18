import { compareText } from '@/i18n/format';
import type { MemberRole } from '@/navigation/destinations';
import { MEMBER_ROLES, type MemberRoleOutcome } from '@/navigation/role';

/**
 * The member list: one organization's people, read once and narrowed in memory
 * (story 1.5a).
 *
 * EVERYTHING THE SCREEN DECIDES IS HERE, and that is the decision this module
 * exists to hold rather than a tidiness. `routes/ljudi.tsx` is a `.tsx`, and
 * AD-15 collects none of those — so a comparator, a sort toggle, a level
 * fallback or a count written there is executed by no test in this repository
 * and can only be asserted by reading its own source text. The 1.5a review
 * demonstrated what that costs: swapping the sort keys on two headers left the
 * suite green. So the screen holds markup and state, and every rule it applies
 * is a pure function below.
 *
 * ONE SNAPSHOT, ONE QUERY KEY (AD-13), the shape `@/organization/snapshot`
 * established: {@link MEMBERS_LIST_KEY} is the only key this surface reads
 * under, and every figure on it — the rows, the stated count, the per-level
 * counts beside the filter — is DERIVED from that one answer by
 * {@link narrowMembers}. Independent keys are precisely what put a stale total
 * beside a fresh list.
 *
 * THE TABLE IS A PARAMETER, never an import, exactly as `@/navigation/role`'s
 * is. That is what makes every row of the story's I/O matrix executable from the
 * node suite against a stub — no browser, no stack, no environment — and the
 * interfaces below are structural and narrow on purpose, so
 * `supabaseClient().from(MEMBERS_TABLE)` satisfies them and a stub does not have
 * to impersonate the rest of PostgREST.
 *
 * WHAT THIS MODULE DOES NOT DO is write. Creating and editing a member is
 * `@/members/write` (story 1.5b), which owns the PostgREST edit, the privileged
 * call and the branch between them; deactivating and resetting a password are
 * story 1.6 and still answer `501`. Nothing here posts, patches or deletes, and
 * the seam below names `select` alone so a write cannot be added without
 * widening the interface in front of a reviewer.
 *
 * Codes, never messages (the conventions): `{ code }` out of here, translated
 * only at the edge — {@link membersMessageKey} is that edge, and it lives here
 * for the same reason the comparators do.
 */

/**
 * The relation this module reads.
 *
 * IMPORTED FROM `@/navigation/role` rather than re-declared, because two
 * spellings of one table name is exactly the drift a renamed relation would
 * produce: one read would move and the other would 404 at runtime with nothing
 * in the type system to say so.
 */
export { MEMBERS_TABLE } from '@/navigation/role';

/**
 * The single query key this surface reads under.
 *
 * A CONSTANT rather than an inline array, for the reason
 * `ORGANIZATION_SNAPSHOT_KEY` is one: two call sites writing `['members']` by
 * hand are two keys the moment one of them gains a qualifier, and AD-13's
 * failure mode is a screen reading the same thing twice under keys that drifted
 * apart.
 *
 * DISTINCT FROM `MEMBER_ROLE_KEY`, which the chrome reads. That one is a single
 * column of a single row — the caller's own level — and this is the whole list;
 * caching the list under the chrome's key would make every navigation in the
 * application refetch several hundred rows for one word.
 */
export const MEMBERS_LIST_KEY = ['members'] as const;

/**
 * The columns this read selects, in one place.
 *
 * FIVE RENDERABLE FIELDS AND TWO THAT ARE NOT. `name`, `email`, `role` and
 * `leave_allowance_days` are what the table shows; `id` is what React keys a row
 * by. `organization_id` renders nowhere and is selected anyway — see
 * {@link readMembers}, which fails closed when an answer spans more than one
 * organization. A column removed from this list is a tripwire removed.
 *
 * `username` IS SELECTED AND NO COLUMN SHOWS IT, and that is a decision rather
 * than an oversight. `0007` gave it to `members` so the application can read
 * the credential an admin issued at all — it exists nowhere else this tree can
 * reach, because `auth.users` is not exposed through PostgREST — and story
 * 1.5b's edit form is what has to seed a field with it. Putting it in
 * {@link MEMBER_COLUMNS} would be a FIFTH heading, which the block there argues
 * is a later story's work arriving without that story's review, and it would
 * widen the search's pinned "name and address and nothing else" claim in the
 * same commit. The list reads it; the edit form renders it.
 *
 * `created_at` is not here, and neither is anything else: `members` carries no
 * health data and no absence-reason field (Q5), and this list is where that
 * claim is made concrete enough for `members/list.test.ts` to assert it. There
 * is no `team_id` to select — teams arrive in story 1.7 — and no active column,
 * because active state lives in `auth.users` (AD-2) and story 1.6 versions it.
 */
export const MEMBERS_COLUMNS =
  'organization_id,id,name,username,email,role,leave_allowance_days';

/**
 * The exact count the transport is asked for alongside the rows.
 *
 * `supabase/config.toml:15` caps PostgREST at `max_rows = 1000`, and nothing in
 * this application reads `Content-Range` or paginates — so an answer truncated
 * at that ceiling is byte-indistinguishable from a complete one, and the surface
 * would render a short list under a confidently wrong total. `'exact'` is what
 * makes the difference observable: the count is the organization's real size and
 * the rows are what arrived, so {@link readMembers} can refuse when they
 * disagree rather than fail open.
 *
 * `'exact'` and not `'planned'` or `'estimated'`, which answer from the planner
 * and from statistics respectively: both are approximations, and an
 * approximation compared against a row count produces a refusal on a correct
 * answer roughly as often as it catches a wrong one.
 */
export const MEMBERS_COUNT: MembersCountOptions = { count: 'exact' };

/**
 * The empty string, NAMED.
 *
 * `routes/ljudi.tsx` may hold no string literal of its own — `prijava.test.ts`
 * sweeps every screen for a literal that is neither a `t()` key nor a
 * structural attribute value, and an empty one is still one. Two things on that
 * surface are nothing at all: the search a freshly opened list carries, and the
 * cell of a member with no address. Both are this.
 */
export const NO_TEXT = '';

/**
 * TanStack Query's own name for a fetch it has NOT started.
 *
 * A paused query is not a failed one and not a slow one: the browser reports
 * itself offline, so `isPending` stays true with nothing in flight and no error
 * ever arriving. The surface has to tell the two apart or it pulses a skeleton
 * forever, and the literal lives here for the reason {@link NO_TEXT} does.
 */
export const FETCH_PAUSED = 'paused';

/**
 * How long the member list may be served from cache, in milliseconds.
 *
 * Here rather than at the call site because this read is the most expensive one
 * in the application: several hundred rows AND an exact count, which costs the
 * database a second pass over the same index. Unbounded, TanStack Query treats
 * every mount and every window focus as a reason to re-run it — so an admin who
 * alt-tabs to their mail and back re-reads the whole organization for a list
 * that has not changed.
 *
 * Five minutes, the same bound `ORGANIZATION_READ_STALE_MS` sets and for the
 * same reason: long enough that returning to the tab is free, short enough that
 * a member added on another device shows up without a reload. It is a FLOOR on
 * staleness rather than a cache — the write half of story 1.5 will invalidate
 * this key explicitly, so a change made here will show up immediately and this
 * bound governs only changes made somewhere else.
 */
export const MEMBERS_READ_STALE_MS = 300000;

/** This session reaches no member row at all — the policy refused, silently. */
export const MEMBERS_REFUSED = 'MEMBERS_REFUSED';
/** The list could not be read, or what came back cannot be trusted as one. */
export const MEMBERS_UNAVAILABLE = 'MEMBERS_UNAVAILABLE';

export type MembersFailure = typeof MEMBERS_REFUSED | typeof MEMBERS_UNAVAILABLE;

export type MembersOutcome =
  | { readonly ok: true; readonly members: readonly MemberListRow[] }
  | { readonly ok: false; readonly code: MembersFailure };

/** As much of a PostgREST error as this module reads — whether there is one. */
export interface PostgrestFailure {
  // `| undefined` on every member, for the reason `@/navigation/role`'s
  // identical interface records: `exactOptionalPropertyTypes` is on and
  // postgrest-js declares these as present-and-possibly-undefined.
  readonly code?: string | undefined;
  readonly message?: string | undefined;
  readonly details?: string | undefined;
}

/** The options the read passes. See {@link MEMBERS_COUNT}. */
export interface MembersCountOptions {
  readonly count: 'exact';
}

/** What the one call below resolves to, count included. */
export interface MembersAnswer {
  readonly data: readonly unknown[] | null;
  readonly error: PostgrestFailure | null;
  /** The organization's real size, or `null` where the transport withheld it. */
  readonly count: number | null;
}

/**
 * The one call this module makes, named structurally so it can be stubbed.
 *
 * `select` AND NOTHING ELSE — no `insert`, no `update`, no `delete`. The seam is
 * the shape of the permission: this story renders rows it does not write, and a
 * writing verb added here is a diff a reviewer sees rather than a call buried in
 * a handler.
 *
 * ONE LINK DEEP, unlike `@/navigation/role`'s three: there is no filter, because
 * the policy is the filter (`members_select_own_organization`, `0003:289-300`)
 * and a client-side `organization_id` filter would be the application asserting
 * an isolation it cannot enforce. No `limit` either — the whole organization is
 * the answer, and {@link MEMBERS_COUNT} is how a truncated one is caught.
 */
export interface MembersTable {
  select(columns: string, options: MembersCountOptions): PromiseLike<MembersAnswer>;
}

/**
 * One member, as the surface sees them.
 *
 * `camelCase` against the database's `snake_case`, which is the conventions'
 * rule and also the seam: {@link memberListRowOf} is the one place the two
 * spellings meet, so a renamed column is one edit rather than a search.
 *
 * `email` is `string | null` because the column is nullable by requirement
 * (`0002:135`) — a member with no address is still a member, and the synthesized
 * sign-in address (AD-12) is never this one.
 */
export interface MemberListRow {
  readonly id: string;
  /** Selected, never rendered. See {@link readMembers}. */
  readonly organizationId: string;
  readonly name: string;
  /**
   * The credential this member signs in with (`0007`).
   *
   * `string` and never `string | null`: the column is `not null`, and a member
   * whose username could not be read is a member whose sign-in identity the
   * edit form would then write a blank over. Selected by this read and rendered
   * by the edit form rather than by the table — see {@link MEMBERS_COLUMNS}.
   */
  readonly username: string;
  readonly email: string | null;
  readonly role: MemberRole;
  readonly leaveAllowanceDays: number;
}

function textAt(row: Record<string, unknown>, column: string): string | null {
  const value = row[column];

  return typeof value === 'string' ? value : null;
}

function numberAt(row: Record<string, unknown>, column: string): number | null {
  const value = row[column];

  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * The permission level a value IS, or `null` if it is not one.
 *
 * A GUARD, never a cast, exactly as `@/navigation/role`'s is — and here the
 * stakes are a whole column rather than one row: `row.role as MemberRole` would
 * let `'supervisor'` through, and the level column would then render whatever
 * an inexhaustive label mapping happened to return for it. `null` is what makes
 * "the application does not recognise this" a case the caller has to handle.
 */
function memberRoleIn(row: Record<string, unknown>): MemberRole | null {
  const value = row['role'];

  return MEMBER_ROLES.find((known) => known === value) ?? null;
}

/** What a row that is not a row at all is reported as. */
export const NOT_A_ROW = 'row';

/**
 * A row that did not validate: WHICH COLUMN was wrong, and which row it was.
 *
 * NAMES RATHER THAN VALUES, and that is a privacy decision rather than a
 * tidiness one. This module used to log the offending ROW, which on this table
 * is a person's name and their email address — the one log in the whole surface
 * that emitted personal data, on a screen whose entire justification is that
 * those addresses are sensitive enough to guard with a route. A column name and
 * a row id are what somebody debugging actually needs, and neither identifies
 * anybody to whoever reads the console.
 */
export interface MalformedRow {
  /** The column that failed, or {@link NOT_A_ROW} for something that is not one. */
  readonly field: string;
  /** The row's own id where it had a usable one, `null` otherwise. Never a name. */
  readonly id: string | null;
}

export type RowOutcome =
  | { readonly ok: true; readonly member: MemberListRow }
  | { readonly ok: false; readonly malformed: MalformedRow };

/**
 * One PostgREST row as a member, or the name of the column that was wrong.
 *
 * VALIDATED FIELD BY FIELD rather than cast, for the reason
 * `organizationSnapshotOf` is: a cast makes `member.name` a `string` the type
 * system believes in and the runtime may not, and an `undefined` name reaching
 * the collator throws inside a sort over several hundred rows — which takes the
 * screen down rather than degrading. Every required column is checked; `email`
 * is admitted as `null`, which is what the column actually is.
 *
 * The FIRST failing column is reported and the rest are not checked: a row is
 * refused whole either way, and the first name is the one that points at the
 * migration or the proxy that caused it.
 */
export function memberRowOutcomeOf(row: unknown): RowOutcome {
  if (typeof row !== 'object' || row === null || Array.isArray(row)) {
    return { ok: false, malformed: { field: NOT_A_ROW, id: null } };
  }

  const fields = row as Record<string, unknown>;

  const id = textAt(fields, 'id');
  const organizationId = textAt(fields, 'organization_id');
  const name = textAt(fields, 'name');
  const username = textAt(fields, 'username');
  const role = memberRoleIn(fields);
  const leaveAllowanceDays = numberAt(fields, 'leave_allowance_days');

  if (id === null) return { ok: false, malformed: { field: 'id', id: null } };
  if (organizationId === null) {
    return { ok: false, malformed: { field: 'organization_id', id } };
  }
  if (name === null) return { ok: false, malformed: { field: 'name', id } };
  // REQUIRED, because `0007` makes the column `not null`. Admitting a missing
  // one as the empty string would seed the edit form with a blank username and
  // save it back over a working sign-in identity.
  if (username === null) return { ok: false, malformed: { field: 'username', id } };
  if (role === null) return { ok: false, malformed: { field: 'role', id } };
  if (leaveAllowanceDays === null) {
    return { ok: false, malformed: { field: 'leave_allowance_days', id } };
  }

  return {
    ok: true,
    member: {
      id,
      organizationId,
      name,
      username,
      email: textAt(fields, 'email'),
      role,
      leaveAllowanceDays,
    },
  };
}

/** The same validation as a nullable value, which is what most callers want. */
export function memberListRowOf(row: unknown): MemberListRow | null {
  const outcome = memberRowOutcomeOf(row);

  return outcome.ok ? outcome.member : null;
}

/**
 * Every member this session reaches, or one stable code.
 *
 * FOUR WAYS TO FAIL, and the order they are checked in is the argument.
 *
 *   - AN ERROR IS NEVER A REFUSAL on this table. Row level security refuses by
 *     failing USING: the statement matches nothing and raises nothing. So an
 *     `error` that reached here is a transport or a schema fault, and reporting
 *     it as "you have no access" would send an entitled admin to ask for rights
 *     they already hold, over a renamed column.
 *   - NO ROW IS THE POLICY'S SILENT REFUSAL, and it is reported as one rather
 *     than rendered as an empty table. An organization always has at least the
 *     caller in it, so zero rows means the session reaches nothing — a
 *     deactivated account, a missing claim — and an empty table under a
 *     confident "0" would say the organization has no people in it.
 *   - A TRUNCATED ANSWER IS UNAVAILABLE. `max_rows = 1000` caps what PostgREST
 *     returns and nothing here paginates, so fewer rows than the exact count
 *     claims is a SHORT LIST THAT LOOKS COMPLETE — the one failure this module
 *     would otherwise commit silently, and the reason the count is asked for at
 *     all. Refusing is the only honest answer: the surface cannot show a list it
 *     did not receive, and showing part of one under the whole organization's
 *     count is worse than showing none.
 *   - AN ANSWER SPANNING TWO ORGANIZATIONS IS UNAVAILABLE. That is the shape a
 *     widened `members_select_own_organization` produces, and it is why
 *     `organization_id` is selected though nothing renders it. It is a CLIENT-
 *     SIDE TRIPWIRE, not a boundary: AD-10 puts isolation in the database, and
 *     proving each row is the CALLER's own would need the caller's organization
 *     from a second source this surface is not permitted to read. What it does
 *     prove is that the answer describes one organization, which is the failure
 *     a loosened policy actually produces.
 *
 * A row that does not validate is UNAVAILABLE and never dropped: a list quietly
 * missing the member whose row was malformed is a wrong answer presented as a
 * right one, which is the same fail-open the truncation check refuses.
 */
export async function readMembers(table: MembersTable): Promise<MembersOutcome> {
  let answered;

  try {
    answered = await table.select(MEMBERS_COLUMNS, MEMBERS_COUNT);
  } catch (cause) {
    // A rejected promise is the transport failing outside postgrest-js's own
    // error mapping — a blocked request, an aborted navigation, a DNS failure,
    // or `SUPABASE_ENVIRONMENT_MISSING` from a build with no environment.
    // LOGGED WITH ITS CAUSE: a discarded cause is a surface that reports "try
    // again" forever with nothing anywhere to say what is actually wrong.
    console.error(MEMBERS_UNAVAILABLE, cause);

    return { ok: false, code: MEMBERS_UNAVAILABLE };
  }

  // AN ANSWER THAT IS NOT AN ANSWER. `table.select` is a seam, and a seam can
  // resolve to anything — a proxy returning a string, a stub written wrong, a
  // transport that answered 200 with a body that is not JSON. Reading `.error`
  // off it would THROW out of a function whose whole contract is that it returns
  // a code rather than throwing, and the throw would surface as an unhandled
  // rejection inside TanStack Query rather than as this surface's own message.
  if (typeof answered !== 'object' || answered === null || Array.isArray(answered)) {
    console.error(MEMBERS_UNAVAILABLE, typeof answered);

    return { ok: false, code: MEMBERS_UNAVAILABLE };
  }

  if (answered.error !== null) {
    console.error(MEMBERS_UNAVAILABLE, answered.error);

    return { ok: false, code: MEMBERS_UNAVAILABLE };
  }

  const rows = answered.data ?? [];

  if (rows.length === 0) return { ok: false, code: MEMBERS_REFUSED };

  const total = answered.count;

  if (total !== null && total > rows.length) {
    // The count is the whole diagnosis: how many the organization has against
    // how many arrived.
    console.error(MEMBERS_UNAVAILABLE, total, rows.length);

    return { ok: false, code: MEMBERS_UNAVAILABLE };
  }

  const members: MemberListRow[] = [];

  for (const row of rows) {
    const outcome = memberRowOutcomeOf(row);

    if (!outcome.ok) {
      // THE COLUMN AND THE ROW ID, never the row. See {@link MalformedRow}: the
      // row is a name and an email address, and this is the one log on a surface
      // guarded precisely because those are sensitive.
      console.error(MEMBERS_UNAVAILABLE, outcome.malformed.field, outcome.malformed.id);

      return { ok: false, code: MEMBERS_UNAVAILABLE };
    }

    members.push(outcome.member);
  }

  const organizations = new Set(members.map((member) => member.organizationId));

  if (organizations.size > 1) {
    console.error(MEMBERS_UNAVAILABLE, organizations.size);

    return { ok: false, code: MEMBERS_UNAVAILABLE };
  }

  return { ok: true, members };
}

/**
 * Whether a session's permission level may read this surface at all.
 *
 * THE GUARD'S WHOLE DECISION, as a function, so `router.test.ts` can execute it
 * and `members/list.test.ts` can pin both polarities. Written inside
 * `beforeLoad` it was assertable only by matching source text, and the 1.5a
 * review widened it to `mayReadMembers(outcome) || outcome.ok` with the suite
 * still green.
 *
 * `MEMBER_ROLES[0]` RATHER THAN THE LITERAL `'admin'`, and what index 0 MEANS is
 * the part worth stating precisely, because the obvious reading of it is wrong.
 * It is not "the most privileged level" — read that way, a level inserted ABOVE
 * `admin` would take index 0 and lock every existing administrator out of the
 * one screen they need. It is THE LEVEL THAT ADMINISTERS THE ORGANIZATION, which
 * `@/navigation/role` declares index 0 to be and `members/list.test.ts` pins
 * against the literal `'admin'`. A fourth level, wherever it ranks, goes
 * anywhere in that array except position 0 — and if it genuinely administers
 * too, this predicate is what has to be widened, in front of a reviewer.
 *
 * The indirection still earns its place: the guard names no level, so the one
 * place the administering level is written down is the array, and the literal
 * pin is what makes a careless reorder a failing test rather than an inverted
 * guard.
 *
 * A FAILED READ IS NOT PERMISSION. Every non-`ok` outcome — refused,
 * unrecognised, unavailable — answers `false`, so a role read that could not
 * complete forwards the visitor rather than admitting them. That is the right
 * direction for a guard whose only cost of being wrong in the other direction is
 * handing a member their colleagues' addresses.
 */
export function mayReadMembers(outcome: MemberRoleOutcome): boolean {
  return outcome.ok && outcome.role === MEMBER_ROLES[0];
}

/** The column a row is named by. */
export const NAME_COLUMN = 'name';
/** The column carrying the member's own address, which may be absent. */
export const EMAIL_COLUMN = 'email';
/** The column carrying the permission level. */
export const LEVEL_COLUMN = 'role';
/** The column carrying the annual leave allowance, in days. */
export const LEAVE_COLUMN = 'leaveAllowanceDays';

export type MemberColumnKey =
  | typeof NAME_COLUMN
  | typeof EMAIL_COLUMN
  | typeof LEVEL_COLUMN
  | typeof LEAVE_COLUMN;

/** The keys the four column headings render. Typed as the union so a heading
 *  absent from `hr.json` is a `pnpm typecheck` failure here. */
export type MemberColumnLabel = 'ljudi.name' | 'ljudi.email' | 'ljudi.role' | 'ljudi.leave';

/** A cell holding text the row already carries — a name, an address. */
export const TEXT_CELL = 'text';
/** A cell holding a permission level, which the surface resolves through `t()`. */
export const LEVEL_CELL = 'level';
/** A cell holding a count of days, which the surface runs through the formatter. */
export const DAYS_CELL = 'days';

/**
 * What one cell CONTAINS, as a value rather than as a rendered string.
 *
 * THE POINT OF THE DISCRIMINANT is that the screen never touches a member field.
 * `cellText` used to live in `routes/ljudi.tsx` as a chain of `if`s reading
 * `member.name`, `member.email` and `member.leaveAllowanceDays` — and vitest
 * executes no `.tsx` at all (AD-15), so swapping the name and address branches
 * rendered every address under `Ime` with the whole suite green. The column now
 * says what its cell holds; the screen only knows how to render each KIND, and
 * `members/list.test.ts` pins the pairing exactly as it pins `sortValue`.
 *
 * `t()` and the number formatter stay on the surface, because a data module that
 * called them would need i18next initialised to be testable at all — which is
 * the dependency this module is written to avoid.
 */
export type MemberCell =
  | { readonly kind: typeof TEXT_CELL; readonly text: string }
  | { readonly kind: typeof LEVEL_CELL; readonly level: MemberRole }
  | { readonly kind: typeof DAYS_CELL; readonly days: number };

export interface MemberColumn {
  readonly key: MemberColumnKey;
  /** The heading's translation key. NEVER the heading. */
  readonly label: MemberColumnLabel;
  /**
   * Whether this column holds a FIGURE, and so needs tabular numerals.
   *
   * UX-DR40: a column of numbers whose glyphs are proportionally spaced wobbles
   * from row to row, and the leave allowance is the first aligned numeric column
   * in the application. On the column rather than in the markup so a fifth
   * numeric column cannot arrive without one.
   */
  readonly numeric: boolean;
  /** What this column's cell holds for one member. See {@link MemberCell}. */
  readonly cell: (member: MemberListRow) => MemberCell;
  /**
   * What this column sorts by, or `null` for a row that carries no value in it.
   *
   * A FUNCTION ON THE COLUMN rather than a `switch` beside the sort, so the
   * column's heading, its cell and its order are one row of one table — which is
   * what makes swapping two columns' sort keys a visible edit to a table
   * `members/list.test.ts` pins, rather than a two-character change in JSX that
   * nothing executes.
   */
  readonly sortValue: (member: MemberListRow) => string | number | null;
}

/**
 * The four columns, in binding order.
 *
 * DATA IN A `.ts`, exactly as `@/navigation/destinations` is and for the same
 * reason: the surface renders its headings, its skeleton cells and its body
 * cells from this one array, so a fifth column is one edit here — and a test can
 * EXECUTE the pairing of heading to sort key, which no regex over a component
 * could. The 1.5a review swapped two headers' sort keys and the suite stayed
 * green precisely because the pairing lived in JSX.
 *
 * FOUR AND NOT FIVE, and each absence is a decision rather than an omission:
 * there is no team column (`members` carries no `team_id` until story 1.7), no
 * hours column (epic 4), and no active/inactive column (story 1.6 versions that
 * state, and it lives in `auth.users` anyway, AD-2).
 *
 * The permission level sorts by RANK rather than by its own text: `MEMBER_ROLES`
 * is ordered most-privileged first, so ascending puts administrators at the top.
 * Sorting the raw column text would order by the accident of the spelling
 * `'admin'` and `'member_role'` having been chosen, and would reorder itself the
 * day a third level is named.
 */
export const MEMBER_COLUMNS: readonly MemberColumn[] = [
  {
    key: NAME_COLUMN,
    label: 'ljudi.name',
    numeric: false,
    cell: (member) => ({ kind: TEXT_CELL, text: member.name }),
    sortValue: (member) => member.name,
  },
  {
    key: EMAIL_COLUMN,
    label: 'ljudi.email',
    numeric: false,
    // AN EMPTY CELL for a member with no address, and deliberately no sentence:
    // `email` is nullable by requirement and a member without one is still a
    // member, so there is nothing to report. UX-DR20 states facts rather than
    // absences, and the honest fact about an empty column is that it is empty.
    cell: (member) => ({ kind: TEXT_CELL, text: member.email ?? NO_TEXT }),
    sortValue: (member) => member.email,
  },
  {
    key: LEVEL_COLUMN,
    label: 'ljudi.role',
    numeric: false,
    cell: (member) => ({ kind: LEVEL_CELL, level: member.role }),
    sortValue: (member) => MEMBER_ROLES.indexOf(member.role),
  },
  {
    key: LEAVE_COLUMN,
    label: 'ljudi.leave',
    numeric: true,
    cell: (member) => ({ kind: DAYS_CELL, days: member.leaveAllowanceDays }),
    sortValue: (member) => member.leaveAllowanceDays,
  },
];

/**
 * What the row action on this list is NAMED AFTER.
 *
 * A FUNCTION FOR ONE FIELD READ, and it earns its line for the reason every
 * other function in this module does: `routes/ljudi.tsx` is executed by nothing
 * (AD-15), and `prijava.test.ts` refuses the screen reaching into a member row
 * at all — because the last time it did, swapping two branches rendered every
 * address under `Ime` with the whole suite green. The row action interpolates a
 * member field into its accessible name, so WHICH field is a decision, and it
 * is the one decision on that control that can be wrong without looking wrong:
 * `member.email` here would announce four hundred people's addresses to anybody
 * moving through the table with a screen reader, and a tenth of them have none,
 * so a tenth of the actions would be named nothing at all.
 *
 * `members/list.test.ts` executes it against a member whose name and address
 * differ, which is what makes that swap a failing case rather than a silent one.
 */
export function memberActionName(member: MemberListRow): string {
  return member.name;
}

/**
 * The classes a cell is drawn with, decided by what the column HOLDS.
 *
 * TAILWIND LITERALS IN A `.ts`, the precedent `@/organization/accent` set, and
 * for two reasons rather than one. The first is that a ternary over two class
 * strings written in JSX is refused outright by `eslint.config.js`'s L2 block —
 * it cannot tell a class name from a word somebody reads, and a merge-blocking
 * rule that has to be argued with is worse than one line here. The second is
 * that it makes UX-DR40 EXECUTABLE: `tabular-nums` on the one aligned numeric
 * column is a claim `members/list.test.ts` can assert, where a class buried in a
 * component is a claim nothing reads.
 *
 * `text-right` travels with it because the two are one decision: a column of
 * figures aligns right so the digits line up, and tabular numerals are what stop
 * them wobbling once they do. The leave allowance is the first such column in
 * the application; the hours table of epic 4 is the next.
 */
export function cellClassNameOf(column: MemberColumn): string {
  return column.numeric ? 'whitespace-nowrap text-right tabular-nums' : 'whitespace-nowrap';
}

/** `aria-sort`'s own vocabulary, so the screen writes neither value by hand. */
export const ASCENDING = 'ascending';
export const DESCENDING = 'descending';
/** What an unsorted column reports. Part of the same ARIA vocabulary. */
export const UNSORTED = 'none';

export type SortDirection = typeof ASCENDING | typeof DESCENDING;

export interface SortState {
  readonly key: MemberColumnKey;
  readonly direction: SortDirection;
}

/**
 * The order the list opens in: by name, ascending.
 *
 * A TABLE IS ALWAYS SORTED, and there is deliberately no third "unsorted" state
 * for a header to cycle back to. Row order is never arbitrary — an unsorted
 * table is sorted by whatever order the transport happened to return — so
 * offering "unsorted" would be a control that claims to remove an ordering it
 * cannot remove.
 */
export const DEFAULT_SORT: SortState = { key: NAME_COLUMN, direction: ASCENDING };

/**
 * What pressing a column heading does.
 *
 * TWO CASES, and the one that matters is the second: pressing a DIFFERENT column
 * starts it ascending rather than inheriting the direction of the column being
 * left. Inheriting is the shape that makes a person press a heading and get a
 * list that is upside down for reasons nothing on screen explains.
 */
export function nextSortState(current: SortState, pressed: MemberColumnKey): SortState {
  if (current.key !== pressed) return { key: pressed, direction: ASCENDING };

  return {
    key: pressed,
    direction: current.direction === ASCENDING ? DESCENDING : ASCENDING,
  };
}

/** What a column heading reports to assistive technology. */
export function sortStateOf(
  sort: SortState,
  column: MemberColumnKey,
): SortDirection | typeof UNSORTED {
  return sort.key === column ? sort.direction : UNSORTED;
}

/** The arrow a sorted heading shows. Names a DIRECTION, never a glyph. */
export const ARROW_UP = 'up';
export const ARROW_DOWN = 'down';

export type SortIndicator = typeof ARROW_UP | typeof ARROW_DOWN;

/**
 * Which way the sorted column's arrow points, or `null` for a column that is
 * not sorted.
 *
 * A PURE FUNCTION rather than a ternary in the heading, and the reason is the
 * one that runs through this whole module: `routes/ljudi.tsx` is executed by no
 * test, so `state === ASCENDING ? ArrowUp : ArrowDown` written there could be
 * inverted with the suite green — and an inverted arrow is worse than no arrow,
 * because it disagrees SILENTLY with a perfectly correct `aria-sort` on the same
 * element. A sighted person and a screen-reader user would then be told opposite
 * things about the same column.
 *
 * `members/list.test.ts` pins this against {@link sortStateOf} for every column
 * and both directions, so the two can never drift apart. What the screen still
 * owns is which GLYPH each name draws, and `prijava.test.ts` pins that pairing
 * at source level, because no node test can see a rendered icon.
 */
export function sortIndicatorOf(sort: SortState, column: MemberColumnKey): SortIndicator | null {
  if (sort.key !== column) return null;

  return sort.direction === ASCENDING ? ARROW_UP : ARROW_DOWN;
}

/** Every member, whatever their level. */
export const ALL_LEVELS = 'all';

export type LevelFilter = typeof ALL_LEVELS | MemberRole;

/**
 * The filter's options, in binding order.
 *
 * DERIVED from `MEMBER_ROLES` rather than written out, so a third permission
 * level appears in the filter the moment it exists rather than the moment
 * somebody remembers this list. `ALL_LEVELS` leads because it is the state the
 * screen opens in.
 *
 * BY PERMISSION LEVEL and not by team, which is what UX-DR17 and UX-DR19
 * describe: `members` has no `team_id` until story 1.7, so the level is the only
 * axis the schema offers today. What survives from those rules is the SHAPE —
 * each option states its own count — so the filter teams arrive into is already
 * the one they described.
 */
export const LEVEL_FILTERS: readonly LevelFilter[] = [ALL_LEVELS, ...MEMBER_ROLES];

/**
 * The level a `<select>` value IS, or every level.
 *
 * A LOOKUP WITH AN EXPLICIT FALLBACK, never a cast. A `<select>`'s value is a
 * string as far as the DOM is concerned, and a value outside this vocabulary —
 * a stale option after a build, an extension rewriting the control — would cast
 * to a `LevelFilter` the type system believes in and `narrowMembers` would then
 * match no row at all: an empty list with no explanation, which is the one
 * outcome this surface must never produce silently. Falling back to every level
 * shows too much rather than nothing, which is the harmless direction.
 */
export function chooseLevel(value: string): LevelFilter {
  return LEVEL_FILTERS.find((known) => known === value) ?? ALL_LEVELS;
}

/**
 * The message key each failure renders as — the edge, and the only place one of
 * these codes becomes Croatian.
 *
 * Here rather than as a ternary in the screen, for the reason
 * `@/organization/messages` records: a `.tsx` is collected by nothing, so a
 * mapping written there can only be read as source text, and swapping two
 * branches passes every source-level assertion.
 *
 * NEITHER MESSAGE SAYS "you need administrator rights", and that is the
 * constraint this surface adds to the pattern. `/ljudi` is reachable only
 * through a route guard that has already read this session's level and found it
 * to be an administrator's — so telling the person they lack the rights would be
 * false on the one path that reaches this screen, and it would send somebody to
 * ask for a permission they demonstrably hold.
 *
 * TWO CODES, TWO MESSAGES, AND TWO DIFFERENT ACTIONS, which is the part the
 * wording has to keep honest. An unavailable read is the transport, so it may
 * well succeed on a second attempt and its message says to try again. A REFUSAL
 * WILL NOT: the database declined this session, and pressing the same button
 * again asks the same question of the same claim. So its message does not invite
 * a retry — it names the action that can actually change the answer, which is
 * signing in again. A session's `organization_id` claim is minted at sign-in
 * (`custom_access_token_hook`) while role and active status are re-read on every
 * statement, so a stale or missing claim is precisely what a new token fixes,
 * and a reactivated account is picked up by the next read either way. Telling
 * somebody to retry something that cannot work is the one thing a refusal
 * message must not do.
 */
export function membersMessageKey(
  failure: MembersFailure,
): 'ljudi.error.refused' | 'ljudi.error.unavailable' {
  if (failure === MEMBERS_REFUSED) return 'ljudi.error.refused';
  if (failure === MEMBERS_UNAVAILABLE) return 'ljudi.error.unavailable';

  // EXHAUSTIVE, and `never` is what makes it so — the idiom
  // `@/organization/messages` records. A third code added to the vocabulary
  // becomes a `pnpm typecheck` failure here, at the one place it has to be
  // taught, rather than a fall-through that reports the wrong fact confidently.
  const unhandled: never = failure;

  return unhandled;
}

/**
 * The label a permission level renders as.
 *
 * AN EXHAUSTIVE MAPPING and never a binary ternary, which is the shape this
 * replaces: `role === 'admin' ? t('…admin') : t('…member')` renders an
 * unrecognised level as `Član` — it tells an administrator whose level a newer
 * build wrote that they are an ordinary member, which is a confident lie about
 * a permission. The `never` below makes a third level a `pnpm typecheck` failure
 * here instead.
 */
export function memberLevelMessageKey(role: MemberRole): 'ljudi.admin' | 'ljudi.member' {
  if (role === 'admin') return 'ljudi.admin';
  if (role === 'member_role') return 'ljudi.member';

  const unhandled: never = role;

  return unhandled;
}

/**
 * The label one filter option renders as — a count, in all three Croatian
 * forms (L7).
 *
 * EXHAUSTIVE for the reason above, and with the same consequence if it were not:
 * a fall-through would label a third level as "every level" and quietly promise
 * a list it does not produce.
 */
export function levelFilterMessageKey(
  level: LevelFilter,
): 'ljudi.filterAll' | 'ljudi.filterAdmin' | 'ljudi.filterMember' {
  if (level === ALL_LEVELS) return 'ljudi.filterAll';
  if (level === 'admin') return 'ljudi.filterAdmin';
  if (level === 'member_role') return 'ljudi.filterMember';

  const unhandled: never = level;

  return unhandled;
}

/**
 * The Croatian digraphs Unicode also encodes as single code points.
 *
 * NFD DOES NOT TOUCH THEM. `'ǆ'.normalize('NFD')` is still `'ǆ'` — these are
 * compatibility characters, not precomposed accents — so a fold built on NFD
 * alone leaves a member whose name was pasted from a system that emits them
 * unfindable by typing `dz`. They are mapped to the two-letter sequences a
 * Croatian keyboard produces, which is what somebody searching will type.
 *
 * Both cases and the title case of each, because all three exist as distinct
 * code points and a person pasting a surname gets whichever their source used.
 */
const DIGRAPHS: readonly (readonly [string, string])[] = [
  // TWO ENCODINGS OF DŽ, not one. U+01C4–U+01C6 are the Latin-Extended-B forms
  // and U+01F1–U+01F3 are the later additions Unicode encoded separately — the
  // same three glyphs at two code points each, and a fold that knew only the
  // first block left a surname pasted from a system emitting the second
  // unfindable by typing `dz`. There is no such pair for LJ or NJ.
  ['Ǳ', 'DZ'],
  ['ǲ', 'Dz'],
  ['ǳ', 'dz'],
  ['Ǆ', 'DZ'],
  ['ǅ', 'Dz'],
  ['ǆ', 'dz'],
  ['Ǉ', 'LJ'],
  ['ǈ', 'Lj'],
  ['ǉ', 'lj'],
  ['Ǌ', 'NJ'],
  ['ǋ', 'Nj'],
  ['ǌ', 'nj'],
];

/** Combining marks, which NFD separates from the letter it decomposed. */
const COMBINING_MARKS = /\p{M}/gu;

/**
 * Text as a search compares it: lowercase, and with every Croatian diacritic
 * folded to the letter underneath it.
 *
 * `Đ` IS THE CASE A NAIVE FOLD MISSES, and it is a Croatian surname's first
 * letter often enough to matter. `normalize('NFD')` decomposes `ć`, `č`, `š` and
 * `ž` into a letter plus a combining mark — but `đ` is U+0111 LATIN SMALL LETTER
 * D WITH STROKE, a letter in its own right with no decomposition at all, so
 * `Đurić` stays unfindable by typing `Duric` unless it is mapped by hand.
 *
 * A FOLD RATHER THAN A COLLATOR: `Intl.Collator` with `sensitivity: 'base'`
 * answers "are these two strings equal", and a search is a SUBSTRING question —
 * `mari` inside `Marić` — which no collator answers. The order the list is
 * presented in is the collator's job, and `@/i18n/format` holds that.
 */
export function foldForSearch(text: string): string {
  let folded = text;

  for (const [single, pair] of DIGRAPHS) folded = folded.split(single).join(pair);

  return folded
    .toLocaleLowerCase('hr')
    .split('đ')
    .join('d')
    .normalize('NFD')
    .replace(COMBINING_MARKS, '');
}

/** Whether a member matches a folded search. Name and address, nothing else:
 *  those are the two fields a person knows somebody by. */
function matches(member: MemberListRow, folded: string): boolean {
  const name = foldForSearch(member.name);
  const email = member.email === null ? NO_TEXT : foldForSearch(member.email);

  return name.includes(folded) || email.includes(folded);
}

/**
 * The members a search selects.
 *
 * A QUERY THAT FOLDS TO NOTHING MATCHES NOTHING, and that is the case this
 * exists to separate from an empty search box. The fold strips combining marks
 * and lowercases, so a query made entirely of characters it removes — a stray
 * accent, a diacritic typed on its own, a combining mark pasted out of a
 * document — folds to the empty string, and `''.includes` is true of every
 * member. The screen would then report the whole organization as the result of
 * a search that matched nobody, with a confident count beside it.
 *
 * An EMPTY box is the other thing entirely: it is not a search at all, and every
 * member is the honest answer to it.
 */
function searchedMembers(
  members: readonly MemberListRow[],
  search: string,
): readonly MemberListRow[] {
  const query = search.trim();

  if (query === NO_TEXT) return members;

  const folded = foldForSearch(query);

  // TRIMMED AGAIN, and the second trim is not the first one repeating itself.
  // The fold removes combining marks from the MIDDLE of the query as well as
  // from its ends, so `"\u0300 \u0301"` — two marks with a space between them —
  // survives the first trim as a non-empty query and folds to a lone space,
  // which `includes` then finds in every member whose name has one. What is left
  // after folding has to carry something before it can select anybody.
  if (folded.trim() === NO_TEXT) return [];

  return members.filter((member) => matches(member, folded));
}

/** How many of each level a set of members holds, keyed the filter's own way. */
export type LevelCounts = Readonly<Record<LevelFilter, number>>;

export interface MembersNarrowing {
  /** The rows to render, searched, filtered and ordered. */
  readonly rows: readonly MemberListRow[];
  /** What each filter option would yield from the same search. */
  readonly counts: LevelCounts;
}

/**
 * Two values in this column's order, or `0` where the column cannot compare
 * them. Strings go through the Croatian collator; numbers subtract.
 */
function compareValues(first: string | number, second: string | number): number {
  if (typeof first === 'string' && typeof second === 'string') return compareText(first, second);
  if (typeof first === 'number' && typeof second === 'number') return first - second;

  return 0;
}

/**
 * A TOTAL order over members: the column's own value, then the name, then the id.
 *
 * THE TIE-BREAKS ARE WHAT MAKE DESCENDING A MIRROR OF ASCENDING. Without them
 * `sort()` leaves equal values in whatever order they arrived and `reverse()`
 * then INVERTS that arbitrary order — so two members with the same allowance
 * swap places when the direction changes, for no reason a person can see. It is
 * acute on the permission level, where four hundred rows carry two distinct
 * values: pressing the heading twice would reshuffle the whole list rather than
 * turn it over.
 *
 * The id is the last resort and it is what makes the order genuinely total: two
 * members may share a name, and `members.id` is a primary key. With no ties left
 * anywhere, reversing is the exact mirror, which is the property
 * `members/list.test.ts` asserts rather than assumes.
 */
function compareMembers(
  first: { readonly member: MemberListRow; readonly value: string | number },
  second: { readonly member: MemberListRow; readonly value: string | number },
): number {
  const byValue = compareValues(first.value, second.value);
  if (byValue !== 0) return byValue;

  const byName = compareText(first.member.name, second.member.name);
  if (byName !== 0) return byName;

  return compareText(first.member.id, second.member.id);
}

/** The same total order for the members a column has no value for. */
function compareByName(first: MemberListRow, second: MemberListRow): number {
  const byName = compareText(first.name, second.name);

  return byName !== 0 ? byName : compareText(first.id, second.id);
}

/**
 * The rows the surface renders AND the counts beside its filter, from one call.
 *
 * ONE FUNCTION FOR BOTH, and that is the decision rather than a convenience: the
 * counts describe the rows, and computed separately the two drift — a filter
 * promising twelve beside three rows is the defect, and it is the kind nobody
 * reports because each half looks right on its own. Here they are the same
 * traversal.
 *
 * THE COUNTS ARE OVER THE SEARCH, NOT OVER THE LEVEL. Each option says how many
 * rows choosing it would produce from what is currently searched — which is what
 * makes the numbers an answer to "what happens if I pick this" rather than a
 * static fact about the organization. Counting after the level filter would make
 * every option but the chosen one read zero.
 *
 * ADDRESS-LESS MEMBERS SORT LAST IN BOTH DIRECTIONS. A member with no address is
 * not "before A" or "after Z" — they have no place in an alphabetical order at
 * all — so they are partitioned out and appended, and reversing the direction
 * reverses the members who HAVE an address rather than floating the ones who do
 * not to the top. `members/list.test.ts` pins both directions, because the
 * obvious implementation (sort with `null` as the empty string) gets exactly one
 * of the two right.
 */
export function narrowMembers(
  members: readonly MemberListRow[],
  search: string,
  level: LevelFilter,
  sort: SortState,
): MembersNarrowing {
  const searched = searchedMembers(members, search);

  const counts: Record<LevelFilter, number> = {
    [ALL_LEVELS]: searched.length,
    admin: 0,
    member_role: 0,
  };

  for (const member of searched) counts[member.role] += 1;

  const filtered =
    level === ALL_LEVELS ? searched : searched.filter((member) => member.role === level);

  const column = MEMBER_COLUMNS.find((candidate) => candidate.key === sort.key);
  // A sort key no column owns orders nothing rather than throwing: the state is
  // this module's own and cannot reach that, but a `!` here would turn a future
  // mistake into a blank screen instead of an unsorted one.
  if (column === undefined) return { rows: filtered, counts };

  // DECORATED once rather than read inside the comparator, which is called
  // O(n log n) times: at Q20's several hundred members that is a few thousand
  // extra property reads per keystroke, and for the name column a few thousand
  // extra folds. It is also what removes the `null` from the comparator's
  // argument types, so nothing here has to invent a value for a member who has
  // none.
  const present: { readonly member: MemberListRow; readonly value: string | number }[] = [];
  const absent: MemberListRow[] = [];

  for (const member of filtered) {
    const value = column.sortValue(member);

    if (value === null) absent.push(member);
    else present.push({ member, value });
  }

  present.sort(compareMembers);
  absent.sort(compareByName);

  // REVERSED BLOCK BY BLOCK, which keeps two properties that pull in opposite
  // directions. Both orders are total, so reversing is the exact MIRROR of
  // ascending rather than a reshuffle of whatever order equal values arrived in.
  // And the members a column has no value for stay at the END either way: they
  // have no place in the order at all, so floating them to the top when the
  // direction flips would be the list inventing one for them.
  if (sort.direction === DESCENDING) {
    present.reverse();
    absent.reverse();
  }

  return { rows: [...present.map((entry) => entry.member), ...absent], counts };
}

/**
 * Everything the narrowing depends on, in one object.
 *
 * WHY THIS EXISTS AT ALL: `routes/ljudi.tsx` memoizes the narrowing, and a
 * dependency dropped from that array is invisible here — `eslint.config.js`
 * registers no `react-hooks` plugin, so nothing lints the list, and the screen
 * is executed by no test. Removing `sort` left the suite green and eslint clean
 * while the arrow flipped and the rows never moved.
 *
 * Naming the inputs once, and DERIVING the dependency array from the same
 * object the call consumes, is what closes that: the two cannot disagree,
 * because there is only one of them. `members/list.test.ts` pins the array's
 * contents, so a field dropped from {@link narrowingDependencies} is a failing
 * test rather than a stale table.
 */
export interface NarrowingInputs {
  readonly members: readonly MemberListRow[] | null;
  readonly search: string;
  readonly level: LevelFilter;
  readonly sort: SortState;
}

/**
 * The memo's dependency array, derived from the inputs rather than written
 * beside them.
 *
 * Every field of {@link NarrowingInputs}, in declaration order, and the test
 * that pins it compares against the object's own keys — so a FIFTH input added
 * to the narrowing and forgotten here fails rather than producing a table that
 * quietly stops responding to it.
 */
export function narrowingDependencies(inputs: NarrowingInputs): readonly unknown[] {
  return [inputs.members, inputs.search, inputs.level, inputs.sort];
}

/** The narrowing, from the same object the dependencies are derived from. */
export function narrowFrom(inputs: NarrowingInputs): MembersNarrowing {
  return narrowMembers(inputs.members ?? [], inputs.search, inputs.level, inputs.sort);
}

/**
 * As much of a TanStack Query result as this surface reads.
 *
 * A STRUCTURAL PARAMETER, the same shape the table seam above is, and for the
 * same reason: the derivation below decides what the screen shows, and a
 * derivation that could only be driven by mounting a component would be a
 * derivation no test in this repository executes.
 */
export interface MembersQueryAnswer {
  readonly isPending: boolean;
  readonly isError: boolean;
  readonly fetchStatus: string;
  readonly data: MembersOutcome | undefined;
}

/** What the surface renders: rows, a skeleton, a message, or a combination. */
export interface MembersSurfaceState {
  /** The rows to narrow and draw, or `null` when there are none to draw. */
  readonly members: readonly MemberListRow[] | null;
  /** The message to show, or `null`. */
  readonly refusal: MembersFailure | null;
  /** Whether to pulse the skeleton. Never true beside a message. */
  readonly loading: boolean;
}

/**
 * One query result as the four things the screen can be showing.
 *
 * FOUR STATES, NOT TWO, and every one of them was a defect in this surface at
 * some point in the 1.5a review:
 *
 *   - ANSWERED. `readMembers` folds every failure it knows about into
 *     `{ ok: false, code }`, which `useQuery` reports as a resolved VALUE.
 *   - THREW. The query function can still reject before reaching that mapping —
 *     `supabaseClient()` raises `SUPABASE_ENVIRONMENT_MISSING` on a build with
 *     no environment — and a version reading only `data` left that case
 *     rendering headings with no rows, no count and no message. It shipped
 *     GREEN, because this derivation used to live in the screen.
 *   - PAUSED. TanStack Query pauses rather than fails when the browser reports
 *     itself offline: `isPending` stays true with nothing in flight and no error
 *     ever arriving, so the skeleton pulses for ever with nothing saying why.
 *   - THREW OVER A GOOD ANSWER. A refetch that fails while a complete list is
 *     already cached — the ordinary shape of a network blip on a screen someone
 *     is looking at. The rows are KEPT and the message is shown BESIDE them,
 *     which is the decision this story makes and the one the previous version
 *     got wrong in the expensive direction: it replaced a correct, if slightly
 *     old, list of several hundred people with a sentence. Stale data plainly
 *     labelled as troubled beats no data at all, and the alternative asks
 *     somebody to reload to see what they were already looking at.
 *
 * `loading` and `refusal` are never both set: a skeleton beside an explanation
 * says the surface is both working and broken.
 */
export function membersSurfaceStateOf(answer: MembersQueryAnswer): MembersSurfaceState {
  const answered = answer.data;
  const members = answered !== undefined && answered.ok ? answered.members : null;
  const paused = answer.isPending && answer.fetchStatus === FETCH_PAUSED;

  if (answered !== undefined && !answered.ok) {
    return { members: null, refusal: answered.code, loading: false };
  }

  if (answer.isError || paused) {
    return { members, refusal: MEMBERS_UNAVAILABLE, loading: false };
  }

  return { members, refusal: null, loading: answer.isPending };
}
