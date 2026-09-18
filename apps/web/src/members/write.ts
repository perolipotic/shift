import {
  MEMBERS_REFUSED,
  MEMBERS_TABLE,
  type MemberListRow,
  type MembersSurfaceState,
} from '@/members/list';
import {
  CREATE_USER_OPERATION,
  LEAVE_ALLOWANCE_MAX,
  MEMBER_CREATED,
  MEMBER_READ_REFUSED,
  MEMBER_UNKNOWN,
  MEMBER_WRITE_FUNCTION,
  MEMBER_WRITE_REFUSED,
  MEMBER_WRITE_UNAVAILABLE,
  UPDATE_USER_OPERATION,
  USERNAME_CHANGED,
  editFailureOf,
  memberWriteFailureOf,
  type MemberWriteFailure,
  type MemberWriteRefusal,
  type PostgrestFailure,
} from '@/members/wire';
import type { MemberRole } from '@/navigation/destinations';
import { MEMBER_ROLES } from '@/navigation/role';

/**
 * Creating and editing a member (story 1.5b) — every decision the two forms
 * make, in a `.ts` that renders nothing.
 *
 * WHY THIS IS A MODULE AND NOT TWO SCREENS. `routes/ljudi.novi.tsx` and
 * `routes/ljudi.$id.tsx` are `.tsx` files, and AD-15 collects none of those: a
 * branch written in either is executed by no test in this repository and can
 * only be asserted by reading its own source text. Story 1.5a's loopback paid
 * for that lesson twice — two swapped sort keys and a widened route guard, both
 * green. So the screens hold markup and state, and every rule they apply is a
 * pure function below, including the two that decide whether a form may render
 * at all.
 *
 * THE CENTRAL BRANCH: MOST EDITS NEVER REACH THE PRIVILEGED FUNCTION.
 * `members_update_by_own_active_admin` (`0003:331-351`) already admits an active
 * admin to every column of every row in their own organization, so a name, an
 * address, a permission level and a leave allowance are an ordinary PostgREST
 * PATCH. Routing those through the secret-key boundary would widen that
 * boundary's blast radius for nothing. The function is reached only when the
 * SIGN-IN IDENTITY changes, which is the one thing row level security cannot
 * do — `auth.users.email` is not a table this application may write.
 * {@link saveMember} is where that branch lives and `write.test.ts` executes it
 * rather than matching source text.
 *
 * THE FUNCTION IS A PARAMETER, exactly as `MembersTable` is. No
 * `functions.invoke` call exists anywhere else in this application — this story
 * establishes the seam — and injecting it is what makes every row of the story's
 * I/O matrix drivable from the node suite against a stub, with no stack and no
 * environment.
 *
 * ITS VOCABULARY IS WRITTEN TWICE AND BOUND BY A TEST. The codes below are the
 * SPA's copy of what `supabase/functions/admin-auth/operations.ts` puts on the
 * wire; the two trees cannot import each other, because one is bundled by Vite
 * and the other runs on Deno with an `npm:` specifier.
 * `test/admin-auth-boundary.test.ts` is the one file that can import both, and
 * it asserts that every code the function emits is a code
 * {@link memberWriteFailureOf} recognises and that both success gates agree.
 * Unbound, renaming the value of `MEMBER_CREATED` on one side reports a
 * successful create as a service failure and throws away the generated
 * password — the one unrecoverable value in the system — with both suites green.
 *
 * NOTHING HERE STORES OR LOGS THE ISSUED CREDENTIAL. It travels from the reply
 * to the caller's return value and no further: not into a query cache, not into
 * `localStorage`, and above all not into `console`, which is a place it could be
 * read back long after its one showing.
 */

// ----------------------------------------------------------------- the seams

/** What a PostgREST write resolves to. */
export interface PostgrestAnswer {
  readonly data: readonly unknown[] | null;
  readonly error: PostgrestFailure | null;
}

/** The tail of the update chain: `.eq('id', …).select(…)`. */
export interface MemberUpdateFilter {
  eq(column: string, value: string): { select(columns: string): PromiseLike<PostgrestAnswer> };
}

/**
 * The one PostgREST call this module makes, named structurally so it can be
 * stubbed.
 *
 * `update` AND NOTHING ELSE — no `insert` and no `delete`. Creating a member is
 * not a PostgREST write at all: the `auth.users` row has to exist first
 * (`0002:128`), which only the privileged boundary can arrange. Naming `insert`
 * here would be an invitation to write half an account.
 */
export interface MemberWriteTable {
  update(values: Readonly<Record<string, unknown>>): MemberUpdateFilter;
}

/**
 * As much of a `FunctionsError` as this module reads.
 *
 * `context` IS THE WHOLE REASON THIS SHAPE EXISTS. supabase-js reports a
 * non-2xx from an Edge Function as an ERROR with the `Response` hidden on
 * `context`, and leaves `data` null — so a module reading only `data` sees
 * every refusal this story defines as "something went wrong" and none of the
 * codes. The body is read back off that response, which is where
 * `{ code, ...operands }` actually is.
 */
export interface FunctionsError {
  readonly message?: string | undefined;
  readonly context?: { json?: () => PromiseLike<unknown> } | undefined;
}

export interface FunctionsAnswer {
  readonly data: unknown;
  readonly error: FunctionsError | null;
}

/** The injected `functions.invoke`. See the header: no other call to it exists
 *  in this application. */
export interface MemberFunctions {
  invoke(
    name: string,
    options: { readonly body: Readonly<Record<string, unknown>> },
  ): PromiseLike<FunctionsAnswer>;
}

function fieldsOf(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;

  return value as Record<string, unknown>;
}

/**
 * The whole body of a function reply, whichever half of the answer holds it.
 *
 * ONE READER FOR BOTH OPERATIONS. `createMember` needs the issued credential out
 * of the body and `renameMember` needs only the code, and a second extraction
 * written for the second caller is a second place the defect below can live —
 * it did, and both copies carried it.
 */
export async function replyBodyOf(
  answer: FunctionsAnswer,
): Promise<Record<string, unknown> | null> {
  const direct = fieldsOf(answer.data);

  if (direct !== null) return direct;

  const context = answer.error?.context;

  if (context === undefined || context === null || typeof context.json !== 'function') return null;

  try {
    // CALLED ON ITS RECEIVER, never pulled off it first.
    // `context` is the raw `Response` supabase-js attaches to a
    // `FunctionsHttpError`, and `Response.prototype.json` is BRAND-CHECKED:
    // `const read = context.json; await read()` throws
    // `TypeError: Illegal invocation` synchronously, which the catch below
    // swallows into `null`. The cost of that one-line convenience was every
    // refusal in this story — a taken username, a refused policy, an unknown
    // member, a rename that did not apply — collapsing into
    // `MEMBER_WRITE_UNAVAILABLE` "try again" IN THE BROWSER ONLY, because a
    // hand-built stub's `json` is an arrow closure that never touches `this`
    // and works detached. `write.test.ts` carries a case built on a real
    // `Response` for exactly this, on both readers.
    return fieldsOf(await context.json());
  } catch {
    return null;
  }
}

/**
 * The stable code a reply body carries, or `null`.
 *
 * SEPARATE FROM THE READ, and that separation is not tidiness: a `Response`
 * body may be consumed EXACTLY ONCE, so a caller that needs both the code and
 * an operand has to read the body once and ask this twice. Reading it twice
 * throws `TypeError: Body is unusable` on the second attempt — swallowed into
 * `null`, which is the same "try again" failure the detached-method defect
 * produced, reached a different way.
 *
 * `''` is not a code. A reply carrying one is a reply with no code at all.
 */
export function replyCodeIn(body: Record<string, unknown> | null): string | null {
  const code = body === null ? undefined : body['code'];

  return typeof code === 'string' && code !== '' ? code : null;
}

/**
 * The `code` a function reply carries, whichever half of the answer holds it.
 *
 * `null` for a reply with no code at all, which is the shape a crashed runtime
 * or a proxy produces — and the reason `handler.ts` wraps its dispatch, so that
 * shape should be unreachable from our own function rather than merely handled.
 */
export async function replyCodeOf(answer: FunctionsAnswer): Promise<string | null> {
  return replyCodeIn(await replyBodyOf(answer));
}

// ------------------------------------------------------------------ the writes

/** The columns a plain edit writes, and the ones read back to prove it landed. */
export const MEMBER_EDIT_COLUMNS = 'id,name,email,role,leave_allowance_days,username';
const ID_COLUMN = 'id';

/**
 * The level a new person starts at.
 *
 * `member_role` AND NEVER `admin`, and it is a decision rather than a default
 * that fell out of array order: the create form's `<select>` opens on whatever
 * this says, and an admin issuing several hundred accounts in a sitting will
 * leave most of them on it. Opening on `admin` would hand organization-wide
 * configuration rights to everybody nobody thought about — the failure nobody
 * notices, because every screen works.
 *
 * Written here rather than as `MEMBER_ROLES[1]`, which would mean "whatever is
 * second in the rank order" — a list reordered for the sort column would move
 * this with it.
 */
export const DEFAULT_MEMBER_ROLE: MemberRole = 'member_role';

/**
 * The permission level a `<select>`'s value IS, with an explicit fallback.
 *
 * A LOOKUP, NEVER A CAST, for the reason `chooseLevel` is one: a `<select>`'s
 * value is a string as far as the DOM is concerned, and a value outside the
 * vocabulary — a stale option after a deploy, an extension rewriting the
 * control — would cast to a `MemberRole` the type system believes in and land
 * in `members.role`, where `0002:140`'s check refuses it with a message about a
 * constraint. Falling back to {@link DEFAULT_MEMBER_ROLE} is the harmless
 * direction: it grants less rather than more.
 */
export function chosenRole(value: string): MemberRole {
  return MEMBER_ROLES.find((known) => known === value) ?? DEFAULT_MEMBER_ROLE;
}

/**
 * The leave allowance a `<select>`-free number field yields.
 *
 * `0002:145` makes the column `smallint not null check (>= 0)`, and an empty or
 * non-numeric field yields `NaN` from `Number('')`'s cousin — which serializes
 * as `null` in JSON and lands as a not-null violation an admin cannot act on.
 * `null` here is "there is no number in that field", which the caller refuses
 * before sending anything.
 */
export function enteredAllowance(value: string): number | null {
  const parsed = Number(value.trim());

  if (value.trim() === '' || !Number.isInteger(parsed) || parsed < 0) return null;
  // BOUNDED BY WHAT THE COLUMN CAN HOLD. `leave_allowance_days` is a `smallint`
  // (`0002:145`), so 32768 is not a large allowance — it is `22003`, a refusal
  // about a storage type that names nothing an admin can act on. Refusing it
  // here makes it the same "correct a value" every other bad entry is, and both
  // controls carry the same bound as a `max` so the field mostly cannot express
  // it in the first place.
  if (parsed > LEAVE_ALLOWANCE_MAX) return null;

  return parsed;
}

/** What both forms collect. `username` is here because both forms show it —
 *  where it GOES is {@link saveMember}'s branch, not the form's. */
export interface MemberEdits {
  readonly name: string;
  readonly email: string | null;
  readonly role: MemberRole;
  readonly leaveAllowanceDays: number;
  readonly username: string;
}

export type MemberWriteOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly refusal: MemberWriteRefusal };

/** An entered address as the column stores it: `null` rather than an empty
 *  string, because `members.email` is nullable by requirement (`0002:135`) and
 *  an empty string is not an address. */
export function storedEmail(entered: string): string | null {
  const trimmed = entered.trim();

  return trimmed === '' ? null : trimmed;
}

/**
 * Whether this edit moves the sign-in identity.
 *
 * NORMALIZED ON BOTH SIDES, so capitalizing a username that is already issued
 * is not a rename: `0007`'s unique index is case-insensitive and the address
 * builder lowercases, so `Ana.Kovac` and `ana.kovac` are the same identity and
 * calling the privileged function to swap one for the other would reach GoTrue
 * with the address the account already holds.
 */
export function usernameChanged(current: string, entered: string): boolean {
  return current.trim().toLowerCase() !== entered.trim().toLowerCase();
}

/**
 * Move a member's sign-in identity through the privileged boundary.
 *
 * THE LOG AND THE RETURNED CODE NAME THE SAME THING. A handler that logged one
 * code and returned another is a console that disagrees with the screen, which
 * is worse than no log: whoever is debugging searches for the wrong string.
 */
export async function renameMember(
  functions: MemberFunctions,
  memberId: string,
  username: string,
): Promise<MemberWriteOutcome> {
  let answered: FunctionsAnswer;

  try {
    answered = await functions.invoke(MEMBER_WRITE_FUNCTION, {
      body: { operation: UPDATE_USER_OPERATION, memberId, username },
    });
  } catch (cause) {
    console.error(MEMBER_WRITE_UNAVAILABLE, cause);

    return { ok: false, refusal: { code: MEMBER_WRITE_UNAVAILABLE, saved: false } };
  }

  const code = await replyCodeOf(answered);

  if (code === USERNAME_CHANGED) return { ok: true };

  const failure = code === null ? MEMBER_WRITE_UNAVAILABLE : memberWriteFailureOf(code);

  console.error(failure, code);

  return { ok: false, refusal: { code: failure, saved: false } };
}

/**
 * Save an edit: the ordinary fields through PostgREST, the username through the
 * function, and the function only when the username actually moved.
 *
 * THE ORDER IS WHAT MAKES THE PARTIAL SAVE HONEST. The four fields go first
 * because they are the ones RLS already admits; the rename follows, and if it is
 * refused the four are genuinely in the database. {@link MemberWriteRefusal}
 * carries that fact rather than discarding it.
 */
export async function saveMember(
  table: MemberWriteTable,
  functions: MemberFunctions,
  member: MemberListRow,
  edits: MemberEdits,
): Promise<MemberWriteOutcome> {
  let answered: PostgrestAnswer;

  try {
    answered = await table
      .update({
        // TRIMMED, exactly as `createPayloadOf` trims it on the other path.
        // Untrimmed here, `  Ana  ` created through one form and typed into the
        // other are two different names for one person — a difference nobody
        // can see and nobody chose.
        name: edits.name.trim(),
        email: edits.email,
        role: edits.role,
        leave_allowance_days: edits.leaveAllowanceDays,
      })
      .eq(ID_COLUMN, member.id)
      .select(MEMBER_EDIT_COLUMNS);
  } catch (cause) {
    console.error(MEMBER_WRITE_UNAVAILABLE, cause);

    return { ok: false, refusal: { code: MEMBER_WRITE_UNAVAILABLE, saved: false } };
  }

  if (answered.error !== null) {
    const code = editFailureOf(answered.error);

    console.error(code, answered.error.code);

    return { ok: false, refusal: { code, saved: false } };
  }

  // ZERO ROWS IS THE POLICY'S SILENT REFUSAL: `members_update_by_own_active_admin`
  // fails USING, so the statement matches nothing and raises nothing.
  if ((answered.data ?? []).length === 0) {
    return { ok: false, refusal: { code: MEMBER_WRITE_REFUSED, saved: false } };
  }

  if (!usernameChanged(member.username, edits.username)) return { ok: true };

  const renamed = await renameMember(functions, member.id, edits.username);

  if (renamed.ok) return { ok: true };

  // THE FOUR FIELDS REALLY ARE IN THE DATABASE. See {@link MemberWriteRefusal}.
  return { ok: false, refusal: { code: renamed.refusal.code, saved: true } };
}

/** What a create collects, plus the organization the row belongs to. */
export interface MemberCreation extends MemberEdits {
  readonly organizationId: string;
}

/**
 * The credential the create issues, and the only copy of it there is.
 *
 * NOT CACHED, NOT PERSISTED, NOT LOGGED. It is returned to the caller, shown
 * once, and dropped when the screen leaves. Story 1.6's admin-issued reset is
 * what replaces it if the admin loses it before handing it over.
 */
export interface IssuedCredential {
  readonly username: string;
  readonly password: string;
}

export type MemberCreateOutcome =
  | { readonly ok: true; readonly credential: IssuedCredential }
  | { readonly ok: false; readonly refusal: MemberWriteRefusal };

/**
 * Issue an account and its member row, through the privileged boundary.
 *
 * NOT A POSTGREST WRITE, and it structurally cannot become one:
 * `members.auth_user_id` is `not null references auth.users(id)` (`0002:128`),
 * and creating an `auth.users` row needs the secret key — which lives in exactly
 * one place (AD-17) and it is not this bundle.
 */
export async function createMember(
  functions: MemberFunctions,
  creation: MemberCreation,
): Promise<MemberCreateOutcome> {
  let answered: FunctionsAnswer;

  try {
    answered = await functions.invoke(MEMBER_WRITE_FUNCTION, {
      body: {
        operation: CREATE_USER_OPERATION,
        organizationId: creation.organizationId,
        name: creation.name,
        username: creation.username,
        email: creation.email,
        role: creation.role,
        leaveAllowanceDays: creation.leaveAllowanceDays,
      },
    });
  } catch (cause) {
    console.error(MEMBER_WRITE_UNAVAILABLE, cause);

    return { ok: false, refusal: { code: MEMBER_WRITE_UNAVAILABLE, saved: false } };
  }

  // ONE READ AND ONE CODE RULE. The body is read ONCE — a `Response` body is
  // consumable exactly once, so calling `replyCodeOf` here as well would throw
  // `Body is unusable` on the second pass and report every create as a service
  // failure — and the code comes out of it through the same `replyCodeIn` the
  // rename path uses, which is what stops a second inline extraction (the one
  // this replaces accepted `''` as a code) drifting from it.
  const body = await replyBodyOf(answered);
  const code = replyCodeIn(body);

  if (code === MEMBER_CREATED) {
    const username = body?.['username'];
    const password = body?.['password'];

    // A SUCCESS WITH NO CREDENTIAL IN IT IS NOT A SUCCESS, and BOTH HALVES have
    // to be there. The account exists either way, but nobody can sign in to it
    // and no later read can recover the password — and a blank USERNAME is the
    // same failure wearing a friendlier face: the panel renders, the admin
    // writes down a password, and the sign-in identity it belongs to is a
    // blank line.
    if (
      typeof username === 'string' &&
      username !== '' &&
      typeof password === 'string' &&
      password !== ''
    ) {
      return { ok: true, credential: { username, password } };
    }

    // DELIBERATELY NOT LOGGED WITH THE BODY. The body is where the credential
    // is, and a console line carrying it would outlive the one showing.
    console.error(MEMBER_WRITE_UNAVAILABLE, MEMBER_CREATED);

    return { ok: false, refusal: { code: MEMBER_WRITE_UNAVAILABLE, saved: false } };
  }

  const failure = code === null ? MEMBER_WRITE_UNAVAILABLE : memberWriteFailureOf(code);

  console.error(failure, code);

  return { ok: false, refusal: { code: failure, saved: false } };
}

// ------------------------------------------------------- what the forms render

/**
 * The member an edit form is for, or the refusal to show instead.
 *
 * THE EDIT SCREEN'S WHOLE GATING DECISION, as a function, for the reason every
 * other rule on this surface is one: a `.tsx` is executed by nothing, and this
 * is the branch that decides whether a form renders over a row that was read or
 * over nothing at all. A form seeded from nothing saves defaults over a person's
 * record.
 *
 * FOUR OUTCOMES, and the third is the one a naive version gets wrong. A list
 * that is still loading has no member AND no refusal — it shows a skeleton. A
 * list that settled FAILED shows that failure and no form. A list that settled
 * fine but holds no row with this id is {@link MEMBER_UNKNOWN}, which is its own
 * code precisely because it is not a refusal. And a list that holds the row
 * hands it over.
 */
export interface MemberFormState {
  readonly member: MemberListRow | null;
  readonly refusal: MemberWriteFailure | null;
  readonly loading: boolean;
}

export function memberFormRefusalOf(state: MembersSurfaceState, id: string): MemberFormState {
  if (state.loading) return { member: null, refusal: null, loading: true };

  if (state.refusal !== null) {
    // THE TWO LIST CODES ARE KEPT APART, and collapsing them was the defect.
    // `/ljudi/$id` is reachable by URL — a bookmark, a link in a message — so a
    // stale or claim-less session lands here with `MEMBERS_REFUSED`, which is
    // the database declining this session PERMANENTLY. Reported as "try again"
    // it invites reloading a page that will refuse identically for ever; the
    // action that can change the answer is signing in again, which the list's
    // own refusal already says.
    return {
      member: null,
      refusal: state.refusal === MEMBERS_REFUSED ? MEMBER_READ_REFUSED : MEMBER_WRITE_UNAVAILABLE,
      loading: false,
    };
  }

  const member = (state.members ?? []).find((candidate) => candidate.id === id) ?? null;

  if (member === null) return { member: null, refusal: MEMBER_UNKNOWN, loading: false };

  return { member, refusal: null, loading: false };
}

/**
 * As much of the organization read as the create form needs.
 *
 * A STRUCTURAL PARAMETER, the shape `membersSurfaceStateOf` established, so the
 * derivation is drivable from the node suite rather than only by mounting a
 * component.
 */
export interface OrganizationQueryAnswer {
  readonly isPending: boolean;
  readonly isError: boolean;
  readonly data: { readonly ok: boolean; readonly snapshot?: { readonly id: string } } | undefined;
}

/** What the create form renders: a form seeded from an organization, a
 *  skeleton, or a message and no form at all. */
export interface CreateFormState {
  readonly organizationId: string | null;
  readonly refusal: MemberWriteFailure | null;
  readonly loading: boolean;
}

/**
 * Is there anything to seed the create form from?
 *
 * THE DECISION THE CREATE SCREEN MUST NOT HOLD. Written in the `.tsx` it is
 * unverifiable by construction (AD-15), and the failure it permits is the one
 * `routes/index.tsx:21-25` warns about wearing a different shape: a form that
 * renders fully, looks completely usable, and whose Save returns silently
 * because the organization id it needs never arrived. A settled failed read
 * renders a message and NO form — an admin who cannot start is told so, rather
 * than filling in six fields first.
 */
export function createFormStateOf(answer: OrganizationQueryAnswer): CreateFormState {
  const answered = answer.data;
  const organizationId = answered?.ok === true ? (answered.snapshot?.id ?? null) : null;

  if (organizationId !== null) return { organizationId, refusal: null, loading: false };

  // A SETTLED FAILURE, whichever half it came from: the query rejected, or it
  // resolved to this application's own `{ ok: false }`. Both are "there is
  // nothing to seed a form from and waiting will not help".
  if (answer.isError || (answered !== undefined && answered.ok !== true)) {
    return { organizationId: null, refusal: MEMBER_WRITE_UNAVAILABLE, loading: false };
  }

  return { organizationId: null, refusal: null, loading: answer.isPending };
}

/**
 * Something the edit screen raised, and the member it was raised ABOUT.
 *
 * WHY THE MEMBER TRAVELS WITH IT. `/ljudi/$id` is one component instance for
 * every member: navigating from one row's form to another's changes a route
 * PARAM, not the component, so React state survives the move. The form itself
 * remounts — {@link memberFormKey} sees to that — and the alert above it did
 * not, so a refusal raised on Ana stayed on screen over Marko's form, naming a
 * problem with a record nobody was looking at. The same is true of a
 * confirmation, in the more dangerous direction: "saved" standing over a form
 * that was never submitted.
 */
export interface RaisedForMember<T> {
  readonly member: string;
  readonly raised: T;
}

/**
 * What a screen showing member `id` may render out of something it raised
 * earlier, or `null`.
 *
 * A FUNCTION rather than an `id`-comparison written into the JSX, for the
 * reason every other rule on this surface is one: a `.tsx` is executed by
 * nothing, and `raised.member === id` inverted or dropped is invisible in a
 * diff and invisible to every test.
 */
export function raisedForMember<T>(raised: RaisedForMember<T> | null, id: string): T | null {
  return raised !== null && raised.member === id ? raised.raised : null;
}

/**
 * The identity the edit form's uncontrolled fields are mounted under.
 *
 * WHY A KEY AT ALL. Every field on that form is uncontrolled with a
 * `defaultValue` (UX-DR34: a refused save keeps every entered value), and
 * `defaultValue` seeds the DOM at MOUNT and never again. After a successful
 * save the list is invalidated and refetched, so the row underneath the form
 * changes — and without a remount the fields still show what the row held when
 * the screen opened, while `Odustani`, which is `type="reset"`, snaps them back
 * to that stale state. `<select>` is worse still: its `defaultValue` sets
 * `defaultSelected`, so the level control and the fields would disagree.
 * `organizacija.tsx` keys its accent `<select>` for exactly this reason; here
 * the whole form takes the key, because every field has the problem.
 *
 * EVERY WRITTEN FIELD IS IN THE FINGERPRINT, not just the id: keying on `id`
 * alone never changes for a row being edited in place, which is the only case
 * that matters. A test executes this rather than reading the JSX, so a field
 * dropped from it is a failing case rather than one control left stale.
 */
export function memberFormKey(member: MemberListRow): string {
  return [
    member.id,
    member.name,
    member.username,
    member.email ?? '',
    member.role,
    String(member.leaveAllowanceDays),
  ].join('|');
}

/** The relation the edit path writes. Re-exported rather than re-declared, for
 *  the reason `members/list.ts` re-exports it: two spellings of one table name
 *  is one read that moves and one that 404s. */
export { MEMBERS_TABLE };

/**
 * The wire vocabulary, re-exported so no caller has to know it is a leaf.
 *
 * It lives in `@/members/wire` because `test/admin-auth-boundary.test.ts` has
 * to import it alongside the function's own constants, and pnpm's isolated
 * linker means the root project cannot resolve anything this module reaches.
 * See that file's header.
 */
export {
  CREATE_USER_OPERATION,
  LEAVE_ALLOWANCE_MAX,
  MESSAGE_SEPARATOR,
  MEMBER_ACCOUNT_STRANDED,
  MEMBER_CREATED,
  MEMBER_READ_REFUSED,
  MEMBER_UNKNOWN,
  MEMBER_USERNAME_INVALID,
  MEMBER_USERNAME_NOT_APPLIED,
  MEMBER_USERNAME_TAKEN,
  MEMBER_USERNAME_UNSETTLED,
  MEMBER_WRITE_FUNCTION,
  MEMBER_WRITE_INVALID,
  MEMBER_WRITE_REFUSED,
  MEMBER_WRITE_UNAVAILABLE,
  ORGANIZATION_WOULD_HAVE_NO_ADMIN,
  PARTIAL_SAVE_KEY,
  UPDATE_USER_OPERATION,
  USERNAME_CHANGED,
  WIRE_CODES,
  editFailureOf,
  memberWriteFailureOf,
  memberWriteMessageKey,
  memberWriteMessageKeys,
  type MemberWriteFailure,
  type MemberWriteMessageKey,
  type MemberWriteRefusal,
  type PostgrestFailure,
} from '@/members/wire';
