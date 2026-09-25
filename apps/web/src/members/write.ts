import {
  MEMBERS_REFUSED,
  MEMBERS_TABLE,
  memberActiveFrom,
  memberLatestVersion,
  memberStatusOf,
  memberTeamLatestVersion,
  memberTeamOf,
  type MemberListRow,
  type MemberStatus,
  type MemberStatusVersion,
  type MemberTeamState,
  type MemberTeamVersion,
  type MembersSurfaceState,
} from '@/members/list';
import {
  CREATE_USER_OPERATION,
  DEACTIVATE,
  LEAVE_ALLOWANCE_MAX,
  MEMBER_CREATED,
  MEMBER_READ_REFUSED,
  MEMBER_STATUS_DATE_TAKEN,
  MEMBER_STATUS_IN_EFFECT,
  MEMBER_STATUS_IN_PAST,
  MEMBER_STATUS_OUT_OF_ORDER,
  MEMBER_STATUS_SELF,
  MEMBER_STATUS_STALE,
  MEMBER_STATUS_UNCHANGED,
  MEMBER_TEAM_ARCHIVED,
  MEMBER_TEAM_DATE_TAKEN,
  MEMBER_TEAM_IN_EFFECT,
  MEMBER_TEAM_IN_PAST,
  MEMBER_TEAM_OUT_OF_ORDER,
  MEMBER_TEAM_SCHEDULED,
  MEMBER_TEAM_STALE,
  MEMBER_TEAM_UNCHANGED,
  MEMBER_UNKNOWN,
  MEMBER_WRITE_FUNCTION,
  MEMBER_WRITE_INVALID,
  MEMBER_WRITE_REFUSED,
  MEMBER_WRITE_UNAVAILABLE,
  ORGANIZATION_WOULD_HAVE_NO_ADMIN,
  REACTIVATE,
  WITHDRAW,
  PASSWORD_RESET,
  RESET_PASSWORD_OPERATION,
  UPDATE_USER_OPERATION,
  USERNAME_CHANGED,
  editFailureOf,
  memberWriteFailureOf,
  statusPromptMessageKey,
  TEAM_MOVE,
  teamPromptMessageKey,
  type TeamChange,
  type MemberWriteFailure,
  type MemberWriteRefusal,
  type PostgrestFailure,
  type StatusChange,
} from '@/members/wire';
import { isIsoDate, nextIsoDate } from '@/i18n/format';
import type { MemberRole } from '@/navigation/destinations';
import { MEMBER_ROLES } from '@/navigation/role';

/**
 * Creating a member, editing one, and resetting a member's password — every
 * decision the two forms make, in a `.ts` that renders nothing.
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
 * read back long after its one showing. That is true of BOTH credentials —
 * {@link createMember}'s and {@link resetPassword}'s — and the reset's is the
 * one that matters more, because it is issued precisely when the first copy is
 * already gone.
 *
 * THE RESET'S FOUR STAGES ARE A PURE FUNCTION HERE, not a chain of `&&` in the
 * screen. {@link resetStageOf} is why: a `.tsx` is executed by nothing, and the
 * IN-FLIGHT stage is the one a component gets wrong — clear `armed` before
 * awaiting and the plain, enabled offer renders for the whole request.
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
export const MEMBER_EDIT_COLUMNS = 'id,name,email,role,leave_allowance_days,username,fire_rank';
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
  /**
   * The rank code (`0014`), `null` for "no rank", or ABSENT when the
   * organization does not use ranks. Absent is not `null`: the form offers no
   * rank control then, so the write must not touch the stored rank — switching
   * the setting off hides ranks and never deletes them.
   */
  readonly fireRank?: string | null;
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
 * The credential one reset issues, and the only copy of it there is.
 *
 * ONE FIELD AND NOT TWO. {@link IssuedCredential} carries a username because a
 * create INVENTS one and the panel is the only place it is ever read back; a
 * reset changes nothing about the sign-in identity, so the member's username is
 * already on the screen that offers the reset and asking the function to repeat
 * it would put a second copy of an identity on a wire for no reason.
 *
 * NOT CACHED, NOT PERSISTED, NOT LOGGED, for the reason `IssuedCredential` is
 * not: it is returned, shown once, and dropped when the panel is dismissed.
 */
export interface ResetCredential {
  readonly password: string;
}

/** Mirrors {@link MemberCreateOutcome}: a credential or a refusal, never both
 *  and never neither. */
export type MemberResetOutcome =
  | { readonly ok: true; readonly credential: ResetCredential }
  | { readonly ok: false; readonly refusal: MemberWriteRefusal };

/**
 * Issue a member a new password through the privileged boundary.
 *
 * `renameMember` IS THE TEMPLATE — one `invoke`, one success gate, everything
 * else a refusal — with one addition it cannot share: a reply that passes the
 * gate but carries no password IS NOT A SUCCESS. The account's credential has
 * changed either way, so a panel rendering an empty line is the worst outcome
 * this surface has: the member is locked out of the one account with no
 * self-service recovery, and the admin has been told it worked.
 *
 * NOTHING IS INVALIDATED AFTER THIS. A reset writes no `members` row — the
 * credential lives in `auth.users` — so a refetch would change nothing on the
 * list and would only be a render the shown credential has to survive.
 */
export async function resetPassword(
  functions: MemberFunctions,
  memberId: string,
): Promise<MemberResetOutcome> {
  let answered: FunctionsAnswer;

  try {
    answered = await functions.invoke(MEMBER_WRITE_FUNCTION, {
      body: { operation: RESET_PASSWORD_OPERATION, memberId },
    });
  } catch (cause) {
    console.error(MEMBER_WRITE_UNAVAILABLE, cause);

    return { ok: false, refusal: { code: MEMBER_WRITE_UNAVAILABLE, saved: false } };
  }

  // ONE READ AND ONE CODE RULE, the shape `createMember` established: a
  // `Response` body is consumable exactly once, so asking `replyCodeOf` as well
  // would throw `Body is unusable` and report every reset as a service failure.
  const body = await replyBodyOf(answered);
  const code = replyCodeIn(body);

  if (code === PASSWORD_RESET) {
    const password = body?.['password'];

    if (typeof password === 'string' && password !== '') {
      return { ok: true, credential: { password } };
    }

    // DELIBERATELY NOT LOGGED WITH THE BODY. The body is where the credential
    // is — when there is one — and a console line carrying it would outlive the
    // one showing.
    console.error(MEMBER_WRITE_UNAVAILABLE, PASSWORD_RESET);

    return { ok: false, refusal: { code: MEMBER_WRITE_UNAVAILABLE, saved: false } };
  }

  const failure = code === null ? MEMBER_WRITE_UNAVAILABLE : memberWriteFailureOf(code);

  // THE LOG AND THE RETURNED CODE NAME THE SAME THING, exactly as the rename's
  // do: a console that disagrees with the screen sends whoever is debugging
  // after the wrong string.
  console.error(failure, code);

  // NEVER `saved: true`. One store is written, so there is no partial save to
  // report and no state in which two stores disagree.
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
        // ONLY WHEN THE FORM OFFERED IT. `null` is a value — the empty choice,
        // "no rank" — and is written; an absent rank leaves the column alone.
        ...(edits.fireRank === undefined ? {} : { fire_rank: edits.fireRank }),
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
 * once, and dropped when the screen leaves. {@link resetPassword} — the
 * admin-issued reset story 1.5 owns, not story 1.6 — is what replaces it if the
 * admin loses it before handing it over.
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
        // In the ONE create payload, so the row is inserted with its rank
        // rather than patched afterwards. Absent is "no rank" to the function.
        ...(creation.fireRank === undefined ? {} : { fireRank: creation.fireRank }),
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
    // MEMBER RANK: the rank `<select>` is seeded by `defaultValue` too.
    member.fireRank ?? '',
  ].join('|');
}

// ------------------------------------------------------ the reset's four stages

/** The offer stands: one control, naming the member it would act on. */
export const RESET_IDLE = 'idle';
/** The confirmation stands, naming the member. Nothing has been sent. */
export const RESET_ARMED = 'armed';
/** The request is outstanding. THE CONFIRMATION STAYS MOUNTED, disabled. */
export const RESET_BUSY = 'busy';
/** The credential stands, and it outranks everything else on the screen. */
export const RESET_SHOWN = 'shown';

export type ResetStage =
  | typeof RESET_IDLE
  | typeof RESET_ARMED
  | typeof RESET_BUSY
  | typeof RESET_SHOWN;

/**
 * Which of the reset's four stages is showing.
 *
 * FOUR AND NOT THREE, and the fourth is what a first attempt gets wrong. A
 * model with no IN-FLIGHT stage has to clear `armed` before awaiting, which
 * unmounts the confirm pair and renders the plain, ENABLED offer in its place
 * for the whole request — so the pending flag the confirmation carried is
 * observable by nobody and a second press starts a second reset. `pending`
 * therefore decides this function's answer rather than only a `disabled`
 * attribute on a control that may not be on screen.
 *
 * THE SHOWN CREDENTIAL OUTRANKS EVERY OTHER CONSIDERATION, which is why it is
 * tested FIRST and why this function is not handed the read's state at all.
 * Everything else on that screen can be recovered by looking again; the
 * password cannot, because it is the only copy. A refetch that drops the row, a
 * read that re-settles failed, a member id that now reaches nobody — none of
 * them may take it off the screen. This deliberately inverts the gating rule
 * the rest of the surface follows.
 *
 * IT ENDS ONLY BY AN EXPLICIT DISMISS. `issued` going back to `null` is the
 * ONLY transition out of {@link RESET_SHOWN}, and until it happens a second
 * reset is impossible — which is what stops one credential being overwritten by
 * another before anybody has read it.
 */
export function resetStageOf(
  armed: boolean,
  pending: boolean,
  issued: ResetCredential | null,
): ResetStage {
  if (issued !== null) return RESET_SHOWN;
  if (pending) return RESET_BUSY;

  return armed ? RESET_ARMED : RESET_IDLE;
}

// ------------------------------------------------ deactivation (story 1.6)

/**
 * The relation a status change writes (`0008_member_status.sql`).
 *
 * A PLAIN POSTGREST WRITE, never the privileged function. `ban` and `unban`
 * left `admin-auth`'s vocabulary in this story: the helper every policy re-reads
 * ends data access on the date, the access token hook ends sign-in, and the
 * table's policies are where every rule of the write is enforced — for this
 * screen and for a direct API call alike.
 */
export const MEMBER_STATUS_TABLE = 'member_status_versions';

/** What a status insert resolves to. Nothing is read back: the policy that
 *  admits the write is the confirmation, and the list refetch shows it. */
export interface StatusInsertAnswer {
  readonly error: PostgrestFailure | null;
}

/** The tail of the cancellation chain:
 *  `.eq('member_id', …).eq('effective_from', …).select(…)`. */
export interface StatusDeleteFilter {
  eq(
    column: string,
    value: string,
  ): {
    eq(column: string, value: string): { select(columns: string): PromiseLike<PostgrestAnswer> };
  };
}

/**
 * The two PostgREST calls a status change makes, named structurally so they
 * can be stubbed. `insert` to append a version, `delete` to cancel one not yet
 * in effect — and NO `update`: a version is never changed, and the table
 * carries no update policy for a seam to reach.
 */
export interface MemberStatusTable {
  insert(values: Readonly<Record<string, unknown>>): PromiseLike<StatusInsertAnswer>;
  delete(): StatusDeleteFilter;
}

/** The column a cancellation reads back. A refused one deletes nothing and
 *  answers `[]` rather than an error, so the row count IS the outcome. */
const WITHDRAWN_COLUMNS = 'effective_from';

/**
 * What the status block shows and offers for one member.
 */
export type StatusOffer =
  | {
      /** Deactivate (active today) or reactivate (inactive today) from a date. */
      readonly change: typeof DEACTIVATE | typeof REACTIVATE;
      readonly status: MemberStatus;
      /** The organization's today. */
      readonly today: string;
      /**
       * The earliest date the control admits, and its default: the later of
       * today and the day after the member's latest version, because versions
       * append in date order.
       */
      readonly minimum: string;
    }
  | {
      /** A change is scheduled: the only thing offered is cancelling it. */
      readonly change: typeof WITHDRAW;
      readonly status: MemberStatus;
      readonly today: string;
      /** The scheduled version the cancellation removes. */
      readonly scheduled: MemberStatusVersion;
    };

/**
 * Whether the status block renders at all, and what it offers.
 *
 * ABSENT ON THE CALLER'S OWN ROW. `0008` refuses an admin inserting OR
 * cancelling a version on their own row — cancelling one's own reactivation
 * is a self-deactivation — so a control offered there can only fail. And
 * absent while either the caller's identity or the organization's today is
 * unknown: an offer resting on a guessed date proposes a write the database
 * may refuse, and one resting on an unread session cannot tell whose row this
 * is.
 *
 * A SCHEDULED CHANGE IS OFFERED ONLY FOR CANCELLATION. A new version must be
 * dated after it and must change something, so "reactivate from today" beside
 * a deactivation scheduled for next week would be a version that changes
 * nothing — the "saved" that did nothing this rule exists to prevent.
 */
export function statusOfferOf(
  member: MemberListRow,
  callerAuthUserId: string | null,
  today: string | null,
): StatusOffer | null {
  if (today === null || callerAuthUserId === null) return null;
  if (member.authUserId === callerAuthUserId) return null;

  const status = memberStatusOf(member, today);

  if (status.scheduled !== null) {
    return { change: WITHDRAW, status, today, scheduled: status.scheduled };
  }

  const latest = memberLatestVersion(member);
  const afterLatest = latest === null ? null : nextIsoDate(latest.effectiveFrom);

  // NO DATE LEFT TO OFFER: the latest version is on `9999-12-31`, the last day
  // `0008` admits, so nothing can be dated after it.
  if (latest !== null && afterLatest === null) return null;

  const minimum = afterLatest !== null && afterLatest > today ? afterLatest : today;

  return { change: status.activeToday ? DEACTIVATE : REACTIVATE, status, today, minimum };
}

/** Everything a status change is judged against. */
export interface StatusContext {
  /** The member the change is about. */
  readonly member: MemberListRow;
  /** The whole organization, as the same list read holds it. */
  readonly members: readonly MemberListRow[];
  readonly callerAuthUserId: string;
  /** The organization's today, as an ISO date. */
  readonly today: string;
}

/**
 * The refusals a status change can know before it is sent, or `null`.
 *
 * `day` is the entered date for a deactivation or a reactivation, and the
 * scheduled version's date for a cancellation.
 *
 * ONLY THE CERTAIN ONES — facts about what was entered and about the history
 * the list holds. Whether the organization would be left without an active
 * admin is NOT decided here: the list may be stale, and refusing on a stale
 * list would block a write the database admits. That one is read only after
 * the database has refused.
 */
export function statusPreflightOf(
  change: StatusChange,
  day: string,
  context: StatusContext,
): MemberWriteFailure | null {
  if (!isIsoDate(day)) return MEMBER_WRITE_INVALID;
  if (context.member.authUserId === context.callerAuthUserId) return MEMBER_STATUS_SELF;

  const latest = memberLatestVersion(context.member);

  // ISO dates order as strings, so every comparison below is the policy's own.
  if (change === WITHDRAW) {
    // A CANCELLATION NAMING A VERSION THE LIST NO LONGER HOLDS AS LATEST is
    // stale data, not a change in effect: the status moved since the screen
    // armed it, and the thing to do is look again.
    if (latest === null || latest.effectiveFrom !== day) return MEMBER_STATUS_STALE;
    if (day <= context.today) return MEMBER_STATUS_IN_EFFECT;

    return null;
  }

  if (day < context.today) return MEMBER_STATUS_IN_PAST;
  if (latest !== null && day === latest.effectiveFrom) return MEMBER_STATUS_DATE_TAKEN;
  if (latest !== null && day < latest.effectiveFrom) return MEMBER_STATUS_OUT_OF_ORDER;

  const latestActive = latest === null ? true : latest.active;

  if ((change === REACTIVATE) === latestActive) return MEMBER_STATUS_UNCHANGED;

  return null;
}

/**
 * Whether a change would leave some date from `day` onward with no active
 * admin, by the list's reading — the one `0008` makes: a change that makes an
 * ADMIN inactive from `day` needs another admin active on every date from
 * `day` onward. A change to anybody else never earns this refusal.
 */
function leavesNoAdmin(change: StatusChange, day: string, context: StatusContext): boolean {
  const target = context.member;

  if (target.role !== 'admin') return false;

  // Only a deactivation, and the cancellation of a REACTIVATION, make the
  // target inactive from `day`.
  const makesInactive =
    change === DEACTIVATE ||
    (change === WITHDRAW && memberLatestVersion(target)?.active === true);

  if (!makesInactive) return false;

  return !context.members.some(
    (candidate) =>
      candidate.role === 'admin' && candidate.id !== target.id && memberActiveFrom(candidate, day),
  );
}

/**
 * A refused status write, as this application's own failure. `error` is
 * `null` for a cancellation that deleted nothing.
 *
 * EVERY RULE OF `0008`'s POLICIES ARRIVES AS `42501`, or — for a cancellation
 * — as zero rows deleted, because they are all conjuncts of one clause. So a
 * refusal is read against what was sent: the preflight's named refusals first,
 * then the last-admin refusal when the list says that rule is what refused.
 * A refusal the list cannot explain means the list is behind the database —
 * somebody changed this member, or another admin, since it was read — so it is
 * STALE: look again, rather than a bare "refused" that names nothing to do.
 * The last-admin message is the existing one, because it is the same rule (Q6)
 * reached another way.
 */
export function statusFailureOf(
  error: PostgrestFailure | null,
  change: StatusChange,
  day: string,
  context: StatusContext,
): MemberWriteFailure {
  if (error?.code === '23505') return MEMBER_STATUS_DATE_TAKEN;

  if (error === null || error.code === '42501') {
    const named = statusPreflightOf(change, day, context);

    if (named !== null) return named;
    if (leavesNoAdmin(change, day, context)) return ORGANIZATION_WOULD_HAVE_NO_ADMIN;

    return MEMBER_STATUS_STALE;
  }

  if (error.code !== undefined && ['22', '23'].includes(error.code.slice(0, 2))) {
    return MEMBER_WRITE_INVALID;
  }

  return MEMBER_WRITE_UNAVAILABLE;
}

/** What one status write came back as, before it is judged. */
interface StatusAnswer {
  readonly written: boolean;
  readonly error: PostgrestFailure | null;
}

async function sendStatus(
  table: MemberStatusTable,
  change: StatusChange,
  day: string,
  member: MemberListRow,
): Promise<StatusAnswer> {
  if (change === WITHDRAW) {
    const answered = await table
      .delete()
      .eq('member_id', member.id)
      .eq('effective_from', day)
      .select(WITHDRAWN_COLUMNS);

    // ZERO ROWS IS A REFUSAL: the delete policy matched nothing.
    return { written: answered.error === null && answered.data?.length === 1, error: answered.error };
  }

  const answered = await table.insert({
    organization_id: member.organizationId,
    member_id: member.id,
    active: change === REACTIVATE,
    effective_from: day,
  });

  return { written: answered.error === null, error: answered.error };
}

/**
 * Append one status version, or cancel the scheduled one.
 *
 * NOTHING IS SENT FOR A REFUSAL IT CAN ALREADY NAME, and the entered date is
 * the caller's to keep — the screen holds it in an uncontrolled field that a
 * refusal does not remount.
 */
export async function changeMemberStatus(
  table: MemberStatusTable,
  change: StatusChange,
  day: string,
  context: StatusContext,
): Promise<MemberWriteOutcome> {
  const preflight = statusPreflightOf(change, day, context);

  if (preflight !== null) return { ok: false, refusal: { code: preflight, saved: false } };

  let answer: StatusAnswer;

  try {
    answer = await sendStatus(table, change, day, context.member);
  } catch (cause) {
    console.error(MEMBER_WRITE_UNAVAILABLE, cause);

    return { ok: false, refusal: { code: MEMBER_WRITE_UNAVAILABLE, saved: false } };
  }

  if (answer.written) return { ok: true };

  const code = statusFailureOf(answer.error, change, day, context);

  console.error(code, answer.error?.code);

  return { ok: false, refusal: { code, saved: false } };
}

/**
 * The prompt key for an armed confirmation, worded by its date as at the
 * organization's today: a change dated TODAY is in the present — it happens
 * the moment it is confirmed — and one dated after it in the future. A
 * cancellation is only ever of a later date.
 */
export function statusPromptKeyOf(
  confirmation: Pick<StatusConfirmation, 'change' | 'day'>,
  today: string,
): ReturnType<typeof statusPromptMessageKey> {
  return statusPromptMessageKey(confirmation.change, confirmation.day > today);
}

/**
 * The date today's status line names: the date the version in effect took
 * effect, or today for a member no version has touched (whose line, "active",
 * interpolates no date at all).
 */
export function statusSinceOf(status: MemberStatus, today: string): string {
  return status.since ?? today;
}

/** The query key the caller's own account id is read under. */
export const SESSION_SUBJECT_KEY = ['session-subject'] as const;

/**
 * The caller's own account id, or `null` when there is no session to read.
 *
 * `null` ON EVERY FAILURE, and the status block treats it as "offer nothing":
 * without the caller's identity the screen cannot tell whether this row is the
 * caller's own, which is the one row the control may never be offered on.
 */
export async function readSessionSubject(
  read: () => Promise<{ readonly user: { readonly id: string } } | null>,
): Promise<string | null> {
  try {
    return (await read())?.user.id ?? null;
  } catch (cause) {
    console.error(MEMBER_WRITE_UNAVAILABLE, cause);

    return null;
  }
}

/** The offer stands: a date control and one action, naming the member. */
export const STATUS_IDLE = 'idle';
/** The confirmation stands, naming the member and the date. Nothing sent. */
export const STATUS_ARMED = 'armed';
/** The write is outstanding. THE CONFIRMATION STAYS MOUNTED, disabled. */
export const STATUS_BUSY = 'busy';

export type StatusStage = typeof STATUS_IDLE | typeof STATUS_ARMED | typeof STATUS_BUSY;

/**
 * Which of the status block's three stages is showing.
 *
 * `pending` DECIDES, for the reason {@link resetStageOf} gives: a model where
 * the armed flag is cleared before awaiting renders the plain, enabled offer
 * for the whole request, and a second press appends a second version.
 */
export function statusStageOf(armed: boolean, pending: boolean): StatusStage {
  if (pending) return STATUS_BUSY;

  return armed ? STATUS_ARMED : STATUS_IDLE;
}

/**
 * The status block's fingerprint: the member and their whole history.
 *
 * The block is keyed to it, so the date control's `defaultValue` returns to
 * the new minimum after a version lands — and NOT on a refusal, which leaves
 * the history alone and so keeps the entered date. An armed confirmation
 * carries the fingerprint it was armed against, for {@link standingConfirmation}.
 */
export function statusBlockKey(member: MemberListRow): string {
  return [
    member.id,
    ...member.statusVersions.map((version) => `${version.effectiveFrom}:${String(version.active)}`),
  ].join('|');
}

/**
 * The confirmation, carrying what it is about.
 *
 * The NAME and the DATE travel with it rather than being read off the row and
 * the field at render time, so the date confirmed is the date sent. `history`
 * is the member's {@link statusBlockKey} when it was armed.
 */
export interface StatusConfirmation {
  readonly name: string;
  readonly change: StatusChange;
  readonly day: string;
  readonly history: string;
}

/**
 * The armed confirmation that still stands for this member, or `null`.
 *
 * CLEARED BY A REFETCH THAT CHANGES THE MEMBER'S VERSIONS. A confirmation
 * armed against one history and confirmed against another is a decision about
 * a state that no longer exists — "deactivate from Monday" armed before
 * somebody else scheduled a deactivation for Friday. A refetch that leaves the
 * history alone keeps it, and so does a PENDING write: its own refetch is what
 * changes the history, and the busy state must outlive it.
 */
export function standingConfirmation(
  armed: StatusConfirmation | null,
  member: MemberListRow | null,
  pending: boolean,
): StatusConfirmation | null {
  if (armed === null) return null;
  if (pending || member === null) return armed;

  return statusBlockKey(member) === armed.history ? armed : null;
}

// --------------------------------------------- team membership (story 1.7b)

/**
 * The relation a team change writes: `0010`'s versioned membership.
 *
 * A PLAIN POSTGREST WRITE, mirroring the status path exactly: an insert to
 * append a version, a delete to cancel the scheduled one, and never an update.
 * Every rule is `0010`'s policies; what is here is the surface's reading.
 */
export const MEMBER_TEAM_TABLE = 'team_membership_versions';

/** The same two-verb seam the status table has. */
export type MemberTeamTable = MemberStatusTable;

/** The `<select>` value that means "no team". Named, because the screen may
 *  hold no literal, and not a uuid, so it can never collide with a team id. */
export const NO_TEAM_VALUE = 'none';

/** A team a member can be moved onto, as the picker offers it. */
export interface TeamChoice {
  readonly id: string;
  readonly name: string;
}

/** As much of a team row as the team path reads (`@/teams/list`'s `TeamRow`). */
export interface TeamOption {
  readonly id: string;
  readonly name: string;
  readonly archived: boolean;
}

/**
 * What the team block shows and offers for one member.
 *
 * NO OWN-ROW EXCLUSION, unlike the status block: an admin may set their own
 * team, and `0010` admits it.
 */
export type TeamOffer =
  | {
      /** Move from a date, onto one of `choices` or onto no team. */
      readonly change: typeof TEAM_MOVE;
      readonly state: MemberTeamState;
      readonly today: string;
      /** The active teams the member is not on today, in the order given. */
      readonly choices: readonly TeamChoice[];
      /** Whether "no team" is offered: only for a member who is on one. */
      readonly offersNoTeam: boolean;
      /** The earliest date the control admits, and its default — the rule
       *  {@link statusOfferOf} applies: versions append in date order. */
      readonly minimum: string;
    }
  | {
      /** A move is scheduled: the only thing offered is cancelling it. */
      readonly change: typeof WITHDRAW;
      readonly state: MemberTeamState;
      readonly today: string;
      /** The scheduled version the cancellation removes. */
      readonly scheduled: MemberTeamVersion;
    };

/**
 * Whether the team block offers anything, and what.
 *
 * `null` while today or the teams are unknown — an offer resting on a guessed
 * date or on no list of teams proposes a write the database may refuse — and
 * when there is nothing to move onto: no active team the member is not on, and
 * no team to leave.
 *
 * `teams` are the ACTIVE teams, already sorted (`splitTeams(...).active`);
 * an archived one passed in is dropped anyway.
 */
export function teamOfferOf(
  member: MemberListRow,
  teams: readonly TeamOption[] | null,
  today: string | null,
): TeamOffer | null {
  if (today === null || teams === null) return null;

  const state = memberTeamOf(member, today);
  const latest = memberTeamLatestVersion(member);

  if (state.scheduled !== null && latest !== null) {
    return { change: WITHDRAW, state, today, scheduled: latest };
  }

  const afterLatest = latest === null ? null : nextIsoDate(latest.effectiveFrom);

  // NO DATE LEFT TO OFFER: the latest version is on the last day `0010` admits.
  if (latest !== null && afterLatest === null) return null;

  const current = state.team?.id ?? null;
  const choices = teams
    .filter((team) => !team.archived && team.id !== current)
    .map((team) => ({ id: team.id, name: team.name }));
  const offersNoTeam = current !== null;

  if (choices.length === 0 && !offersNoTeam) return null;

  const minimum = afterLatest !== null && afterLatest > today ? afterLatest : today;

  return { change: TEAM_MOVE, state, today, choices, offersNoTeam, minimum };
}

/**
 * The team a `<select>` value names: a team id, `null` for "no team", or
 * `undefined` for a value the offer never rendered — a lookup with no cast,
 * so a stale option cannot become a write.
 */
export function chosenTeam(value: string, offer: TeamOffer): TeamChoice | null | undefined {
  if (offer.change !== TEAM_MOVE) return undefined;
  if (value === NO_TEAM_VALUE) return offer.offersNoTeam ? null : undefined;

  return offer.choices.find((choice) => choice.id === value);
}

/** The value the picker opens on: the first team offered, or "no team". */
export function teamPickerDefault(offer: TeamOffer): string {
  if (offer.change !== TEAM_MOVE) return NO_TEAM_VALUE;

  return offer.choices[0]?.id ?? NO_TEAM_VALUE;
}

/** Everything a team change is judged against. */
export interface TeamContext {
  readonly member: MemberListRow;
  /** Every team the read holds, archived ones included. */
  readonly teams: readonly TeamOption[];
  /** The organization's today, as an ISO date. */
  readonly today: string;
}

/**
 * The refusals a team change can know before it is sent, or `null`.
 *
 * `day` is the entered date for a move and the scheduled version's date for a
 * cancellation; `team` is the chosen team's id, `null` for no team, ignored
 * for a cancellation. The same rules as `0010`'s policies, in the order the
 * screen can act on them.
 */
export function teamPreflightOf(
  change: TeamChange,
  day: string,
  team: string | null,
  context: TeamContext,
): MemberWriteFailure | null {
  if (!isIsoDate(day)) return MEMBER_WRITE_INVALID;

  const latest = memberTeamLatestVersion(context.member);

  // ISO dates order as strings, so every comparison below is the policy's own.
  if (change === WITHDRAW) {
    if (latest === null || latest.effectiveFrom !== day) return MEMBER_TEAM_STALE;
    if (day <= context.today) return MEMBER_TEAM_IN_EFFECT;

    return null;
  }

  if (day < context.today) return MEMBER_TEAM_IN_PAST;
  // DATE ORDER BEFORE THE ONE-SCHEDULED RULE: a date on or before a scheduled
  // move is refused for its date whatever else holds, and only a date after it
  // is refused for being a second scheduled change.
  if (latest !== null && day === latest.effectiveFrom) return MEMBER_TEAM_DATE_TAKEN;
  if (latest !== null && day < latest.effectiveFrom) return MEMBER_TEAM_OUT_OF_ORDER;
  if (latest !== null && latest.effectiveFrom > context.today) return MEMBER_TEAM_SCHEDULED;
  // CHANGES THE TEAM: compared with the latest state, and "no team" for a
  // member with no history at all is no change either.
  if (team === (latest?.team?.id ?? null)) return MEMBER_TEAM_UNCHANGED;

  if (team !== null) {
    const target = context.teams.find((candidate) => candidate.id === team);

    if (target === undefined) return MEMBER_TEAM_STALE;
    if (target.archived) return MEMBER_TEAM_ARCHIVED;
  }

  return null;
}

/**
 * A refused team write, as this application's own failure — the reading
 * {@link statusFailureOf} makes. Every rule arrives as `42501`, or as zero
 * rows for a cancellation, so the preflight names it; a refusal the list
 * cannot explain is STALE (look again). `23503` is a team or member that is no
 * longer there, which is stale too.
 */
export function teamFailureOf(
  error: PostgrestFailure | null,
  change: TeamChange,
  day: string,
  team: string | null,
  context: TeamContext,
): MemberWriteFailure {
  if (error?.code === '23505') return MEMBER_TEAM_DATE_TAKEN;
  if (error?.code === '23503') return MEMBER_TEAM_STALE;

  if (error === null || error.code === '42501') {
    return teamPreflightOf(change, day, team, context) ?? MEMBER_TEAM_STALE;
  }

  if (error.code !== undefined && ['22', '23'].includes(error.code.slice(0, 2))) {
    return MEMBER_WRITE_INVALID;
  }

  return MEMBER_WRITE_UNAVAILABLE;
}

async function sendTeam(
  table: MemberTeamTable,
  change: TeamChange,
  day: string,
  team: string | null,
  member: MemberListRow,
): Promise<StatusAnswer> {
  if (change === WITHDRAW) {
    const answered = await table
      .delete()
      .eq('member_id', member.id)
      .eq('effective_from', day)
      .select(WITHDRAWN_COLUMNS);

    // ZERO ROWS IS A REFUSAL: the delete policy matched nothing.
    return { written: answered.error === null && answered.data?.length === 1, error: answered.error };
  }

  const answered = await table.insert({
    organization_id: member.organizationId,
    member_id: member.id,
    team_id: team,
    effective_from: day,
  });

  return { written: answered.error === null, error: answered.error };
}

/**
 * Append one team version, or cancel the scheduled one. Nothing is sent for a
 * refusal it can already name, and the picked team and date are the caller's
 * to keep — both controls are uncontrolled and a refusal does not remount them.
 */
export async function changeMemberTeam(
  table: MemberTeamTable,
  change: TeamChange,
  day: string,
  team: string | null,
  context: TeamContext,
): Promise<MemberWriteOutcome> {
  const preflight = teamPreflightOf(change, day, team, context);

  if (preflight !== null) return { ok: false, refusal: { code: preflight, saved: false } };

  let answer: StatusAnswer;

  try {
    answer = await sendTeam(table, change, day, team, context.member);
  } catch (cause) {
    console.error(MEMBER_WRITE_UNAVAILABLE, cause);

    return { ok: false, refusal: { code: MEMBER_WRITE_UNAVAILABLE, saved: false } };
  }

  if (answer.written) return { ok: true };

  const code = teamFailureOf(answer.error, change, day, team, context);

  console.error(code, answer.error?.code);

  return { ok: false, refusal: { code, saved: false } };
}

/**
 * The team confirmation, carrying what it is about: the member's name, the
 * change, the chosen team (`null` for no team, and for a cancellation) and the
 * DATE, so what is confirmed is exactly what is sent. `history` is
 * {@link teamBlockKey} when it was armed.
 */
export interface TeamConfirmation {
  readonly name: string;
  readonly change: TeamChange;
  readonly team: TeamChoice | null;
  readonly day: string;
  readonly history: string;
}

/** The prompt key for an armed team confirmation, worded by its date. */
export function teamPromptKeyOf(
  confirmation: Pick<TeamConfirmation, 'change' | 'team' | 'day'>,
  today: string,
): ReturnType<typeof teamPromptMessageKey> {
  return teamPromptMessageKey(
    confirmation.change,
    confirmation.team === null,
    confirmation.day > today,
  );
}

/** The team block's fingerprint: the member and their whole team history. */
export function teamBlockKey(member: MemberListRow): string {
  return [
    member.id,
    ...member.teamVersions.map(
      // THE NAME IS PART OF THE KEY: a confirmation armed before a rename would
      // otherwise name the team as it no longer is.
      (version) =>
        `${version.effectiveFrom}:${version.team?.id ?? NO_TEAM_VALUE}:${version.team?.name ?? ''}`,
    ),
  ].join('|');
}

/**
 * The armed team confirmation that still stands, or `null` — cleared by a
 * refetch that changes the member's team history, kept while its own write is
 * pending. {@link standingConfirmation}'s rule.
 */
export function standingTeamConfirmation(
  armed: TeamConfirmation | null,
  member: MemberListRow | null,
  pending: boolean,
): TeamConfirmation | null {
  if (armed === null) return null;
  if (pending || member === null) return armed;

  return teamBlockKey(member) === armed.history ? armed : null;
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
  DEACTIVATE,
  LEAVE_ALLOWANCE_MAX,
  MESSAGE_SEPARATOR,
  MEMBER_ACCOUNT_STRANDED,
  MEMBER_CREATED,
  MEMBER_PASSWORD_NOT_APPLIED,
  MEMBER_READ_REFUSED,
  MEMBER_STATUS_DATE_TAKEN,
  MEMBER_STATUS_IN_EFFECT,
  MEMBER_STATUS_IN_PAST,
  MEMBER_STATUS_OUT_OF_ORDER,
  MEMBER_STATUS_SELF,
  MEMBER_STATUS_STALE,
  MEMBER_STATUS_UNCHANGED,
  MEMBER_TEAM_ARCHIVED,
  MEMBER_TEAM_DATE_TAKEN,
  MEMBER_TEAM_IN_EFFECT,
  MEMBER_TEAM_IN_PAST,
  MEMBER_TEAM_OUT_OF_ORDER,
  MEMBER_TEAM_SCHEDULED,
  MEMBER_TEAM_STALE,
  MEMBER_TEAM_UNCHANGED,
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
  PASSWORD_RESET,
  REACTIVATE,
  WITHDRAW,
  RESET_PASSWORD_OPERATION,
  UPDATE_USER_OPERATION,
  USERNAME_CHANGED,
  WIRE_CODES,
  editFailureOf,
  memberWriteFailureOf,
  memberWriteMessageKey,
  memberWriteMessageKeys,
  statusConfirmMessageKey,
  statusOfferMessageKey,
  statusPromptMessageKey,
  statusScheduledMessageKey,
  statusTodayMessageKey,
  TEAM_MOVE,
  teamConfirmMessageKey,
  teamOfferMessageKey,
  teamPromptMessageKey,
  teamScheduledMessageKey,
  type TeamChange,
  type MemberWriteFailure,
  type MemberWriteMessageKey,
  type MemberWriteRefusal,
  type PostgrestFailure,
  type StatusChange,
} from '@/members/wire';
