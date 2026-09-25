/**
 * `createUser`, `updateUserById` and `resetPassword` — the three operations the
 * privileged boundary implements.
 *
 * THE TWO-CLIENT DIVISION IS THE WHOLE DESIGN and it is visible in every
 * signature below: the PRIVILEGED client appears only as
 * {@link PrivilegedAccounts}, which names `createUser`, `updateUserById` and
 * `deleteUser` on `auth.admin` and nothing else, so this module structurally
 * cannot make a domain-table write with the secret key. Every `members` and
 * `organizations` touch goes through {@link CallerClient}, which is the caller's
 * own JWT — so row level security, AD-11's `created_by default auth.uid()`
 * attribution and the zero-admins trigger all apply exactly as they would to a
 * PATCH from the browser.
 *
 * NEITHER PAIR OF WRITES IS A TRANSACTION, and this module does not pretend
 * otherwise. GoTrue and PostgREST are two services; nothing spans them. What
 * each pair carries instead is an ORDER chosen so the gate comes first, a
 * COMPENSATING action, and a DISTINCT CODE for the case where the compensation
 * itself fails — so a disagreement between the two stores is visible rather than
 * silent.
 *
 *   * ON CREATE THE ORDER IS FORCED. `members.auth_user_id` is
 *     `not null references auth.users(id)` (`0002:128`), so the account must
 *     exist before the row. The compensation is deleting the account when the
 *     row is refused: without it, a refused insert leaves an account that can
 *     sign in and reach nothing at all — no member row means no
 *     `organization_id` claim (`0003:181-206`) and therefore no policy match
 *     anywhere, which is a blank application with a valid session.
 *   * ON RENAME THE ORDER IS CHOSEN. The `members` row moves FIRST, because
 *     `unique (organization_id, lower(username))` (`0007`) is the real gate:
 *     a collision is refused there, before any auth state has moved. The
 *     compensation is restoring the old username when the address will not
 *     follow.
 *
 * THE SLUG IS READ FROM `organizations` AS THE CALLER, never taken from the
 * payload. The address namespace is the database's choice, and a slug in a
 * request body is a caller choosing which organization's namespace to issue an
 * account into — which the authorization would then have no way to contradict,
 * because it checks the ID.
 *
 * A DUPLICATE ADDRESS IS RECOGNISED BY GoTrue's CODE. `status === 422` is
 * shared by every validation refusal GoTrue makes — a weak password, a
 * malformed address, a disabled signup — so mapping the status would tell an
 * admin to change a username that is not the problem, on the one screen where
 * the username is the thing they are least sure about.
 *
 * NOTHING HERE LOGS THE GENERATED PASSWORD. It is returned once, to be shown
 * once, and `console` is a place it could be read afterwards. That is true of
 * `resetPassword` exactly as it is of `createUser`: the two are the only places
 * a credential exists at all, and both hand over their one copy in the reply.
 *
 * THE RESET IS A SIBLING RATHER THAN A FIELD ON THE RENAME, and the reason is
 * the paragraph above about ORDER. `updateUserById`'s auth call sits after the
 * `members` write and inside the username-restore compensation, so a password
 * hung there would succeed or fail with a rename the reset never performs.
 * {@link resetPassword} reuses what actually matters — the read-then-authorize
 * sequence and the {@link PrivilegedAccounts} seam — and keeps its own failure
 * modes its own. It writes ONE store, so there is no compensation here and no
 * state in which two stores disagree.
 */

import {
  ACCESS_UNREADABLE,
  NOT_AN_ADMIN,
  authorizeAdminOf,
  type AccessReader,
} from './authorize.ts';
import { generatePassword, type ByteSource } from './password.ts';

// -------------------------------------------------------------- the vocabulary

/** A member was created. Carries the issued username and the one credential. */
export const MEMBER_CREATED = 'MEMBER_CREATED';
/** A member's sign-in identity moved, in both stores. */
export const USERNAME_CHANGED = 'USERNAME_CHANGED';
/**
 * A member's credential was replaced, and the reply carries the new one.
 *
 * THE GATE IS THIS VALUE AND NOT THE STATUS. A 200 carrying a password no
 * account received is worse than any refusal — the admin reads it out and the
 * member is locked out of an account nobody can now reach — so this code is
 * emitted only after the auth store has answered with an account, the way
 * {@link createUser} already proves its own write landed.
 */
export const PASSWORD_RESET = 'PASSWORD_RESET';

/** The request body is not the shape this operation accepts. */
export const PAYLOAD_INVALID = 'PAYLOAD_INVALID';
/** The username cannot be the local part of an address (`0007`'s shape rule). */
export const USERNAME_INVALID = 'USERNAME_INVALID';
/** That username is already issued in this organization, in some casing. */
export const USERNAME_TAKEN = 'USERNAME_TAKEN';
/** The organization the caller was authorized against reaches no row. */
export const ORGANIZATION_UNKNOWN = 'ORGANIZATION_UNKNOWN';
/**
 * The organization read could not be PERFORMED.
 *
 * DISTINCT FROM {@link ORGANIZATION_UNKNOWN}, for the reason
 * {@link ACCESS_UNREADABLE} is distinct from {@link NOT_AN_ADMIN}: a transport
 * failure reported as "that organization does not exist" is a 404 about a
 * tenant the caller was authorized against a moment earlier, which points an
 * operator at the wrong thing entirely and leaves nothing in the log.
 */
export const ORGANIZATION_UNREADABLE = 'ORGANIZATION_UNREADABLE';
/** The member id reaches nobody this caller may act on. ITS OWN CODE, never the
 *  refusal — telling a proven admin to sign in again over a stale id is an
 *  instruction that cannot work. */
export const MEMBER_UNKNOWN = 'MEMBER_UNKNOWN';
/** A shape on `members` refused the values — a check, a not-null, a range. */
export const MEMBER_INVALID = 'MEMBER_INVALID';
/** GoTrue would not create the account, for a reason that is not a duplicate. */
export const ACCOUNT_NOT_CREATED = 'ACCOUNT_NOT_CREATED';
/** The compensation itself failed: the `members` insert was refused AND the
 *  account created a moment earlier could not be removed. */
export const ACCOUNT_NOT_REMOVED = 'ACCOUNT_NOT_REMOVED';
/**
 * The credential was NOT replaced, so nothing is shown and nothing changed.
 *
 * Covers both shapes of that failure: GoTrue refusing the set outright, and
 * GoTrue answering `error: null` with no user at all — which `error !== null`
 * alone would let through as a success carrying a password no account holds.
 */
export const PASSWORD_NOT_APPLIED = 'PASSWORD_NOT_APPLIED';
/** The row moved and the address would not follow; the row was restored. */
export const USERNAME_NOT_APPLIED = 'USERNAME_NOT_APPLIED';
/** The compensation itself failed: the address would not follow AND the row
 *  could not be put back, so the two stores now disagree. */
export const USERNAME_NOT_RESTORED = 'USERNAME_NOT_RESTORED';
/** An operation threw. Wrapped so the SPA sees a code rather than a bare 500. */
export const OPERATION_FAILED = 'OPERATION_FAILED';

/**
 * Every code this module can put on the wire, success and failure alike.
 *
 * EXPORTED AS DATA because `test/admin-auth-boundary.test.ts` binds it to the
 * client's own vocabulary: the SPA has its own copy of these strings (it cannot
 * import this tree), so the one contract case there asserts that every code
 * here is a code `memberWriteFailureOf` recognises and that both success gates
 * agree. Written twice and bound by nothing, renaming the VALUE of
 * {@link MEMBER_CREATED} reports a successful create as a failure and throws
 * away the one unrecoverable value in the system, with both suites green.
 */
export const OPERATION_CODES = [
  MEMBER_CREATED,
  USERNAME_CHANGED,
  PASSWORD_RESET,
  NOT_AN_ADMIN,
  ACCESS_UNREADABLE,
  PAYLOAD_INVALID,
  USERNAME_INVALID,
  USERNAME_TAKEN,
  ORGANIZATION_UNKNOWN,
  ORGANIZATION_UNREADABLE,
  MEMBER_UNKNOWN,
  MEMBER_INVALID,
  ACCOUNT_NOT_CREATED,
  ACCOUNT_NOT_REMOVED,
  USERNAME_NOT_APPLIED,
  USERNAME_NOT_RESTORED,
  PASSWORD_NOT_APPLIED,
  OPERATION_FAILED,
] as const;

// ------------------------------------------------------------------ the address

/**
 * The reserved domain every synthesized address sits under (RFC 2606, AD-12).
 *
 * THE SECOND AND LAST HOME OF THIS STRING. `apps/web/src/supabase/address.ts`
 * holds the first, and the two cannot import each other: that file is bundled
 * into the SPA by Vite and this one runs on Deno with a `npm:` specifier. So
 * they are duplicated deliberately and BOUND BY A TEST — the boundary suite can
 * import both trees and asserts that `signInAddress` and
 * {@link synthesizedAddress} build the identical string, which is the only thing
 * that keeps an account issued here signing in there.
 */
export const ADDRESS_DOMAIN = 'shift.invalid';

/** AD-12's address for one member of one organization. The `@` and the domain
 *  appear here and in `apps/web/src/supabase/address.ts`, nowhere else. */
export function synthesizedAddress(username: string, slug: string): string {
  return `${username}@${slug}.${ADDRESS_DOMAIN}`;
}

/**
 * A username as the address builder will take it, or `null`.
 *
 * TRIM AND LOWERCASE, then refuse. The two things a person does to an
 * identifier while typing it are add a space and hold shift, and neither is a
 * mistake worth a refusal — but `0007`'s check refuses both outright, so
 * normalizing here is what stops a perfectly reasonable entry becoming a
 * constraint violation nobody can act on. What is refused is what makes the
 * ADDRESS wrong: nothing at all, whitespace, and a second `@`.
 */
export function normalizedUsername(value: unknown): string | null {
  if (typeof value !== 'string') return null;

  const normalized = value.trim().toLowerCase();

  if (normalized === '' || /[\s@]/.test(normalized)) return null;

  return normalized;
}

// -------------------------------------------------------------------- the seams

/** As much of a PostgREST error as this module reads. */
export interface PostgrestFailure {
  readonly code?: string | undefined;
  readonly message?: string | undefined;
  readonly details?: string | undefined;
}

/** What every PostgREST call below resolves to. */
export interface PostgrestAnswer {
  readonly data: unknown;
  readonly error: PostgrestFailure | null;
}

export interface SelectFilter {
  eq(column: string, value: string): { limit(count: number): PromiseLike<PostgrestAnswer> };
}

export interface UpdateFilter {
  eq(column: string, value: string): { select(columns: string): PromiseLike<PostgrestAnswer> };
}

export interface CallerTable {
  select(columns: string): SelectFilter;
  insert(values: Readonly<Record<string, unknown>>): {
    select(columns: string): PromiseLike<PostgrestAnswer>;
  };
  update(values: Readonly<Record<string, unknown>>): UpdateFilter;
}

/**
 * The caller's client, as narrowly as this module uses it.
 *
 * It extends {@link AccessReader}, so the SAME client that performs the writes
 * is the one the authorization was read through. Two clients here would be two
 * identities, and the authorization would then be about somebody other than the
 * account doing the writing.
 */
export interface CallerClient extends AccessReader {
  from(table: string): CallerTable;
}

/** As much of a GoTrue admin error as this module reads. `code` and not
 *  `status` — see the header. */
export interface AccountFailure {
  readonly code?: string | undefined;
  readonly status?: number | undefined;
  readonly message?: string | undefined;
}

export interface AccountAnswer {
  readonly data: { readonly user?: { readonly id?: unknown } | null } | null;
  readonly error: AccountFailure | null;
}

/**
 * The privileged client, as narrowly as this module uses it.
 *
 * THREE METHODS, ALL OF THEM UNDER `auth.admin`. There is no `from` on this
 * interface and there must never be one: a domain-table write with the secret
 * key is the AD-16 defect, and making it unrepresentable is stronger than a
 * comment asking nobody to do it.
 *
 * THE RESET NEEDS NO FOURTH METHOD, and that is a finding rather than an
 * omission — see {@link RESET_ATTRIBUTES}. GoTrue's admin user update is the
 * ONE call in this API that revokes an account's sessions, and it is the same
 * call that sets the password; there is no per-user session endpoint to name.
 * Naming one anyway would put a member on this interface that the real client
 * does not carry, so every reset in a browser would throw out of the cast and
 * answer `OPERATION_FAILED` while a stubbed suite stayed green — the exact
 * class of defect the narrow interfaces exist to prevent. The revocation is
 * asserted where it can actually be observed: `test/rls-isolation.test.ts`
 * holds a session before the reset and requires it to stop authenticating
 * after it, against the running stack rather than against a stub.
 */
export interface PrivilegedAccounts {
  readonly auth: {
    readonly admin: {
      createUser(attributes: Readonly<Record<string, unknown>>): PromiseLike<AccountAnswer>;
      updateUserById(
        id: string,
        attributes: Readonly<Record<string, unknown>>,
      ): PromiseLike<AccountAnswer>;
      deleteUser(id: string): PromiseLike<{ readonly error: AccountFailure | null }>;
    };
  };
}

// ------------------------------------------------------------- the reply shape

/** One operation's answer: an HTTP status and the `{ code, ...operands }` body
 *  the transport already knows how to send. */
export interface OperationReply {
  readonly status: number;
  readonly body: { code: string; [operand: string]: unknown };
}

/** The relations this module touches. Constants because they cross a wire. */
export const MEMBERS_TABLE = 'members';
export const ORGANIZATIONS_TABLE = 'organizations';

/** The permission levels `members.role`'s check constraint admits (`0002:140`).
 *  Pinned against that constraint in the boundary suite, never against itself. */
export const MEMBER_ROLES = ['admin', 'member_role'] as const;

/**
 * The largest leave allowance `members.leave_allowance_days` can hold.
 *
 * `0002:145` types the column `smallint`, so 32768 is not a large allowance: it
 * is `22003 numeric_value_out_of_range`, a refusal about a storage type that
 * names nothing an admin can act on. Refused as a PAYLOAD shape here, it is the
 * same "correct a value" every other bad entry is — and `members/wire.ts`
 * carries the same bound for the controls, bound to this one in the file that
 * can import both trees.
 */
export const LEAVE_ALLOWANCE_MAX = 32767;

/**
 * GoTrue's own code for "an account already holds this address".
 *
 * THE CODE AND NOT THE STATUS. Every validation refusal GoTrue makes carries
 * 422, so `status === 422` would report a weak password, a malformed address
 * and a disabled signup as "that username is taken" — and send an admin to
 * change the one field that was correct.
 */
export const EMAIL_EXISTS = 'email_exists';

/** SQLSTATEs this module distinguishes. Exported so `members/write.ts`'s own
 *  copy can be pinned against them in the file that can import both trees. */
export const UNIQUE_VIOLATION = '23505';
export const INSUFFICIENT_PRIVILEGE = '42501';

/**
 * The SQLSTATE classes that mean the ROW was wrong rather than the service.
 *
 * `22` is `data_exception` and `23` is `integrity_constraint_violation`.
 * BY CLASS RATHER THAN BY A LIST, the identical rule `members/write.ts`'s
 * `editFailureOf` applies — a list names the refusals somebody thought of and
 * falls through on `22003` from an allowance that overflows `smallint`, which
 * is a value on the form reported as an outage.
 */
export const VALUE_CLASSES = ['22', '23'];

function namesAValue(code: string | undefined): boolean {
  return code !== undefined && VALUE_CLASSES.includes(code.slice(0, 2));
}

/**
 * A PostgREST refusal on `members`, as a code and a status.
 *
 * `42501` IS THE INSERT POLICY. `members_insert_by_own_active_admin`
 * (`0003:306-317`) has no USING clause to fail silently, so a refused insert
 * RAISES — which is the one write refusal on this table that is not silence.
 *
 * `23505` IS THE USERNAME, and it is the only unique constraint on this table a
 * write from here can reach: `id` and `auth_user_id` carry values this module
 * just generated, so the collision is always `0007`'s per-organization index.
 * It is also the ONE case `members/write.ts` deliberately does not share — that
 * path's update never writes `username`, so it could not honestly say a
 * username was taken.
 *
 * EVERYTHING ELSE IN CLASS 22 OR 23 IS A VALUE ON THE FORM — a not-null, a
 * check, an allowance that overflows `smallint` — and all of them mean the same
 * thing to the person in front of it: correct a value.
 *
 * AND EVERYTHING ELSE IS THE SERVICE. The fall-through used to be
 * `MEMBER_INVALID`, which is the OPPOSITE of what `editFailureOf` answered for
 * the same SQLSTATE — so one connection failure said "correct a value" and
 * another said "try again" depending only on whether the username happened to
 * change in the same edit. `test/admin-auth-boundary.test.ts` holds the two
 * mappings to the same message key over a list of SQLSTATEs including ones
 * neither names explicitly.
 */
export function membersRefusal(error: PostgrestFailure): OperationReply {
  if (error.code === UNIQUE_VIOLATION) return { status: 409, body: { code: USERNAME_TAKEN } };
  if (error.code === INSUFFICIENT_PRIVILEGE) return { status: 403, body: { code: NOT_AN_ADMIN } };
  if (namesAValue(error.code)) return { status: 409, body: { code: MEMBER_INVALID } };

  return { status: 502, body: { code: OPERATION_FAILED } };
}

/** The reply an authorization failure produces. `ACCESS_UNREADABLE` is an
 *  outage and says so with a 503; the refusal is a 403. */
function authorizationRefusal(code: typeof NOT_AN_ADMIN | typeof ACCESS_UNREADABLE): OperationReply {
  return code === NOT_AN_ADMIN
    ? { status: 403, body: { code: NOT_AN_ADMIN } }
    : { status: 503, body: { code: ACCESS_UNREADABLE } };
}

/** A PostgREST answer's rows, or an empty list. `null` data is not a row. */
function rowsOf(answer: PostgrestAnswer): readonly unknown[] {
  return Array.isArray(answer.data) ? answer.data : [];
}

function fieldsOf(row: unknown): Record<string, unknown> | null {
  if (typeof row !== 'object' || row === null || Array.isArray(row)) return null;

  return row as Record<string, unknown>;
}

function textAt(row: Record<string, unknown>, column: string): string | null {
  const value = row[column];

  return typeof value === 'string' && value !== '' ? value : null;
}

/** The id GoTrue answered with, or `null` — validated rather than cast, because
 *  a missing id would be written into `members.auth_user_id` as `undefined` and
 *  refused with a not-null violation naming nothing useful. */
function accountIdOf(answer: AccountAnswer): string | null {
  const id = answer.data?.user?.id;

  return typeof id === 'string' && id !== '' ? id : null;
}

// ----------------------------------------------------------------- the payloads

/** The create payload, validated. */
export interface CreatePayload {
  readonly organizationId: string;
  readonly name: string;
  readonly username: string;
  readonly email: string | null;
  readonly role: (typeof MEMBER_ROLES)[number];
  readonly leaveAllowanceDays: number;
}

export type PayloadOutcome<T> =
  | { readonly ok: true; readonly payload: T }
  | { readonly ok: false; readonly code: typeof PAYLOAD_INVALID | typeof USERNAME_INVALID };

/**
 * The request body as a create payload, or which of the two ways it was wrong.
 *
 * SEPARATED FROM THE SHAPE FAILURE, because a badly shaped username is the one
 * refusal an admin can act on — every other field on that form is a label they
 * just filled in. `handler.ts` validates `operation` and nothing else by design,
 * so each operation owns its own payload, and this is the whole of it for
 * `createUser`.
 */
export function createPayloadOf(body: unknown): PayloadOutcome<CreatePayload> {
  const fields = fieldsOf(body);

  if (fields === null) return { ok: false, code: PAYLOAD_INVALID };

  const organizationId = textAt(fields, 'organizationId');
  const rawName = fields['name'];
  const name = typeof rawName === 'string' ? rawName.trim() : '';
  const rawEmail = fields['email'];
  const role = MEMBER_ROLES.find((known) => known === fields['role']);
  const leaveAllowanceDays = fields['leaveAllowanceDays'];

  if (organizationId === null || name === '' || role === undefined) {
    return { ok: false, code: PAYLOAD_INVALID };
  }
  if (
    typeof leaveAllowanceDays !== 'number' ||
    !Number.isInteger(leaveAllowanceDays) ||
    leaveAllowanceDays < 0 ||
    leaveAllowanceDays > LEAVE_ALLOWANCE_MAX
  ) {
    return { ok: false, code: PAYLOAD_INVALID };
  }
  // ABSENT AND EMPTY ARE BOTH `null`. `members.email` is nullable by
  // requirement (`0002:135`) and an empty string is not an address — storing one
  // would make a member "have" an email that is not one, which every later read
  // would treat as present.
  if (rawEmail !== undefined && rawEmail !== null && typeof rawEmail !== 'string') {
    return { ok: false, code: PAYLOAD_INVALID };
  }
  const email = typeof rawEmail === 'string' && rawEmail.trim() !== '' ? rawEmail.trim() : null;

  const username = normalizedUsername(fields['username']);

  if (username === null) return { ok: false, code: USERNAME_INVALID };

  return {
    ok: true,
    payload: { organizationId, name, username, email, role, leaveAllowanceDays },
  };
}

/** The rename payload, validated. */
export interface RenamePayload {
  readonly memberId: string;
  readonly username: string;
}

export function renamePayloadOf(body: unknown): PayloadOutcome<RenamePayload> {
  const fields = fieldsOf(body);

  if (fields === null) return { ok: false, code: PAYLOAD_INVALID };

  const memberId = textAt(fields, 'memberId');

  if (memberId === null) return { ok: false, code: PAYLOAD_INVALID };

  const username = normalizedUsername(fields['username']);

  if (username === null) return { ok: false, code: USERNAME_INVALID };

  return { ok: true, payload: { memberId, username } };
}

/** The reset payload, validated. It names ONE field, because that is all a
 *  reset is: an admin-typed password is forbidden (AD-12) and the organization
 *  is read off the row rather than taken from the request. */
export interface ResetPayload {
  readonly memberId: string;
}

/**
 * The request body as a reset payload, or `PAYLOAD_INVALID`.
 *
 * CHECKED BEFORE ANY READ, exactly as the other two payloads are: a body with
 * no `memberId` in it cannot name a row, so reading one would be a query built
 * out of nothing and an authorization pointed at whatever came back.
 *
 * `USERNAME_INVALID` is unreachable from here by construction — this operation
 * touches no username — which is why the outcome is narrowed to the one code.
 */
export function resetPayloadOf(body: unknown): PayloadOutcome<ResetPayload> {
  const fields = fieldsOf(body);

  if (fields === null) return { ok: false, code: PAYLOAD_INVALID };

  const memberId = textAt(fields, 'memberId');

  if (memberId === null) return { ok: false, code: PAYLOAD_INVALID };

  return { ok: true, payload: { memberId } };
}

// ---------------------------------------------------------------- the slug read

/** The one column read off `organizations`, and the column a row is found by. */
const SLUG_COLUMN = 'slug';
const ID_COLUMN = 'id';
const ONE_ROW = 1;

type SlugOutcome =
  | { readonly ok: true; readonly slug: string }
  | { readonly ok: false; readonly reply: OperationReply };

/**
 * The organization's slug, or WHICH of the two ways the read did not produce
 * one.
 *
 * UNREADABLE IS NOT UNKNOWN. Collapsed into one `null` this answered
 * `404 ORGANIZATION_UNKNOWN` for a transport failure — a 404 about a tenant the
 * caller was authorized against one statement earlier — and logged nothing at
 * all, so an operator had a 404 and no trace. It is the same distinction
 * `authorizeAdminOf` already makes between `NOT_AN_ADMIN` and
 * `ACCESS_UNREADABLE`, and for the same reason.
 */
async function slugOf(caller: CallerClient, organization: string): Promise<SlugOutcome> {
  const answered = await caller
    .from(ORGANIZATIONS_TABLE)
    .select(SLUG_COLUMN)
    .eq(ID_COLUMN, organization)
    .limit(ONE_ROW);

  if (answered.error !== null) {
    console.error(ORGANIZATION_UNREADABLE, answered.error.code);

    return { ok: false, reply: { status: 503, body: { code: ORGANIZATION_UNREADABLE } } };
  }

  const fields = fieldsOf(rowsOf(answered)[0] ?? null);
  const slug = fields === null ? null : textAt(fields, SLUG_COLUMN);

  if (slug === null) return { ok: false, reply: { status: 404, body: { code: ORGANIZATION_UNKNOWN } } };

  return { ok: true, slug };
}

// --------------------------------------------------------------- the operations

/** What `createUser` is handed. The byte source travels with it so the boundary
 *  suite can prove the generator consumes it. */
export interface CreateDependencies {
  readonly privileged: PrivilegedAccounts;
  readonly caller: CallerClient;
  readonly randomBytes?: ByteSource | undefined;
}

/** The columns read back after the insert. `id` is what the surface needs; the
 *  rest is what proves the row is the one that was asked for. */
const MEMBER_WRITE_COLUMNS = 'id,username';
const USERNAME_COLUMN = 'username';
const AUTH_USER_COLUMN = 'auth_user_id';
const ORGANIZATION_COLUMN = 'organization_id';

/**
 * Issue an account and the member row that gives it an organization.
 *
 * THE ONLY COPY OF THE PASSWORD LEAVES IN THE REPLY. It is not stored, not
 * logged, and not written to `raw_user_meta_data`; the admin sees it once and
 * {@link resetPassword} — story 1.5's acceptance clause 1, not story 1.6's — is
 * what replaces it if they lose it.
 */
export async function createUser(
  dependencies: CreateDependencies,
  body: unknown,
): Promise<OperationReply> {
  const validated = createPayloadOf(body);

  if (!validated.ok) return { status: 400, body: { code: validated.code } };

  const payload = validated.payload;

  // AUTHORIZED BEFORE ANYTHING IS READ, let alone written. The organization in
  // the body is a claim; this is what turns it into a fact about the caller.
  const authorized = await authorizeAdminOf(dependencies.caller, payload.organizationId);

  if (!authorized.ok) return authorizationRefusal(authorized.code);

  const namespace = await slugOf(dependencies.caller, payload.organizationId);

  if (!namespace.ok) return namespace.reply;

  const address = synthesizedAddress(payload.username, namespace.slug);
  const password = generatePassword(dependencies.randomBytes);

  // THE ACCOUNT FIRST, because the foreign key forces it (`0002:128`).
  // `email_confirm` is what makes the address usable immediately: nothing is
  // ever sent to a `.invalid` address, so a confirmation step would be a link
  // nobody can ever receive.
  const created = await dependencies.privileged.auth.admin.createUser({
    email: address,
    password,
    email_confirm: true,
  });

  if (created.error !== null) {
    // BY CODE, NEVER BY STATUS — see the header.
    if (created.error.code === EMAIL_EXISTS) {
      return { status: 409, body: { code: USERNAME_TAKEN } };
    }

    console.error(ACCOUNT_NOT_CREATED, created.error.code, created.error.status);

    return { status: 502, body: { code: ACCOUNT_NOT_CREATED } };
  }

  const accountId = accountIdOf(created);

  if (accountId === null) {
    console.error(ACCOUNT_NOT_CREATED);

    return { status: 502, body: { code: ACCOUNT_NOT_CREATED } };
  }

  // THE ROW, THROUGH THE CALLER'S CLIENT. The secret key would bypass
  // `members_insert_by_own_active_admin` and AD-11's attribution default in one
  // stroke, which is the defect AD-16 exists to prevent.
  const inserted = await dependencies.caller
    .from(MEMBERS_TABLE)
    .insert({
      organization_id: payload.organizationId,
      auth_user_id: accountId,
      name: payload.name,
      username: payload.username,
      email: payload.email,
      role: payload.role,
      leave_allowance_days: payload.leaveAllowanceDays,
    })
    .select(MEMBER_WRITE_COLUMNS);

  const member = fieldsOf(rowsOf(inserted)[0] ?? null);

  if (inserted.error !== null || member === null) {
    // THE COMPENSATION. Without it the account survives, can sign in, carries
    // no `organization_id` claim and therefore matches no policy anywhere: a
    // valid session looking at an empty application, with nothing on any screen
    // to say why.
    const removed = await dependencies.privileged.auth.admin.deleteUser(accountId);

    if (removed.error !== null) {
      console.error(ACCOUNT_NOT_REMOVED, accountId);

      // THE ID STAYS IN THE LOG AND OUT OF THE REPLY. The browser maps the code
      // and discards every operand, so shipping an internal identifier to it
      // buys nothing and hands an unauthenticated-at-this-point response an
      // `auth.users` primary key. The operator needs it, and the line above is
      // where they read it.
      return { status: 500, body: { code: ACCOUNT_NOT_REMOVED } };
    }

    return inserted.error === null
      ? { status: 409, body: { code: MEMBER_INVALID } }
      : membersRefusal(inserted.error);
  }

  return {
    status: 201,
    body: {
      code: MEMBER_CREATED,
      memberId: textAt(member, 'id') ?? '',
      username: payload.username,
      address,
      password,
    },
  };
}

export interface RenameDependencies {
  readonly privileged: PrivilegedAccounts;
  readonly caller: CallerClient;
}

/** What the member row has to say for a rename to be possible at all. */
const MEMBER_RENAME_COLUMNS = `${ORGANIZATION_COLUMN},${AUTH_USER_COLUMN},${USERNAME_COLUMN}`;

/**
 * Move a member's sign-in identity: the row first, then the address.
 *
 * THE ROW FIRST because `unique (organization_id, lower(username))` is the gate
 * — a collision is refused before any auth state moves — and because restoring
 * a row is something this caller is permitted to do, where un-renaming an
 * account is not.
 */
export async function updateUserById(
  dependencies: RenameDependencies,
  body: unknown,
): Promise<OperationReply> {
  const validated = renamePayloadOf(body);

  if (!validated.ok) return { status: 400, body: { code: validated.code } };

  const payload = validated.payload;

  // THE TARGET'S OWN ORGANIZATION, read as the caller. `members_select_own_organization`
  // (`0003:289-300`, narrowed by `0011`) shows an active admin their own
  // organization and anyone else only their own row — so a member of another
  // tenant, or a colleague read by a member-role caller, simply is not there.
  // The authorization below cannot be pointed at somebody else's row, and such
  // an id is indistinguishable from an id that never existed.
  const found = await dependencies.caller
    .from(MEMBERS_TABLE)
    .select(MEMBER_RENAME_COLUMNS)
    .eq(ID_COLUMN, payload.memberId)
    .limit(ONE_ROW);

  if (found.error !== null) {
    console.error(ACCESS_UNREADABLE, found.error.code);

    return { status: 503, body: { code: ACCESS_UNREADABLE } };
  }

  const member = fieldsOf(rowsOf(found)[0] ?? null);
  const organization = member === null ? null : textAt(member, ORGANIZATION_COLUMN);
  const accountId = member === null ? null : textAt(member, AUTH_USER_COLUMN);
  const previous = member === null ? null : textAt(member, USERNAME_COLUMN);

  if (organization === null || accountId === null || previous === null) {
    return { status: 404, body: { code: MEMBER_UNKNOWN } };
  }

  const authorized = await authorizeAdminOf(dependencies.caller, organization);

  if (!authorized.ok) return authorizationRefusal(authorized.code);

  const namespace = await slugOf(dependencies.caller, organization);

  if (!namespace.ok) return namespace.reply;

  const moved = await dependencies.caller
    .from(MEMBERS_TABLE)
    .update({ [USERNAME_COLUMN]: payload.username })
    .eq(ID_COLUMN, payload.memberId)
    .select(MEMBER_WRITE_COLUMNS);

  if (moved.error !== null) return membersRefusal(moved.error);

  // ZERO ROWS IS THE UPDATE POLICY'S SILENT REFUSAL: `members_update_by_own_active_admin`
  // fails USING, which matches nothing and raises nothing.
  if (rowsOf(moved).length === 0) return { status: 403, body: { code: NOT_AN_ADMIN } };

  const address = synthesizedAddress(payload.username, namespace.slug);
  const applied = await dependencies.privileged.auth.admin.updateUserById(accountId, {
    email: address,
    email_confirm: true,
  });

  if (applied.error !== null) {
    // THE COMPENSATION, and a code of its own for the case where it fails too.
    const restored = await dependencies.caller
      .from(MEMBERS_TABLE)
      .update({ [USERNAME_COLUMN]: previous })
      .eq(ID_COLUMN, payload.memberId)
      .select(MEMBER_WRITE_COLUMNS);

    if (restored.error !== null || rowsOf(restored).length === 0) {
      console.error(USERNAME_NOT_RESTORED, payload.memberId);

      // Logged, not returned — see the note on `ACCOUNT_NOT_REMOVED` above.
      return { status: 500, body: { code: USERNAME_NOT_RESTORED } };
    }

    if (applied.error.code === EMAIL_EXISTS) {
      return { status: 409, body: { code: USERNAME_TAKEN } };
    }

    console.error(USERNAME_NOT_APPLIED, applied.error.code, applied.error.status);

    return { status: 502, body: { code: USERNAME_NOT_APPLIED } };
  }

  return { status: 200, body: { code: USERNAME_CHANGED, username: payload.username, address } };
}

// ------------------------------------------------------------------ the reset

/**
 * What `resetPassword` is handed.
 *
 * ITS OWN INTERFACE rather than a shared one, and it carries
 * `randomBytes?: ByteSource` for the reason {@link CreateDependencies} does:
 * the generator takes its entropy as a parameter, so the boundary suite can
 * hand it a source and prove the reset CONSUMES it. A reset that quietly grew a
 * second generator — or fell back to `Math.random` — answers a different string
 * and fails there rather than shipping a guessable credential.
 */
export interface ResetDependencies {
  readonly privileged: PrivilegedAccounts;
  readonly caller: CallerClient;
  readonly randomBytes?: ByteSource | undefined;
}

/** What the member row has to say for a reset to be possible at all: whose
 *  organization it is, and which account carries the credential. No username —
 *  this operation does not touch the sign-in identity. */
const MEMBER_RESET_COLUMNS = `${ORGANIZATION_COLUMN},${AUTH_USER_COLUMN}`;

/**
 * The one attribute a reset sends GoTrue, named so it can be pinned.
 *
 * `password` AND NOTHING ELSE. `email_confirm` belongs to the address and the
 * rename owns it; `ban_duration` is nobody's, since story 1.6 deactivates in a
 * domain table and never bans; and `user_metadata` is the one
 * place a credential must never be written, because every later admin read can
 * see it. The boundary suite pins these keys exactly, so an attribute added
 * here is a failing case rather than a value in the auth store nobody chose.
 *
 * IT IS ALSO THE REVOCATION. GoTrue's admin user update logs an account out of
 * every session it holds when a password is set through it — the access token
 * stops being accepted and the refresh token is gone — which is what makes a
 * reset issued against a compromised credential worth anything. There is no
 * per-user session endpoint in the admin API to call instead, so this is not a
 * shortcut: it is the mechanism. `test/rls-isolation.test.ts` holds a live
 * session across a reset and requires it to stop authenticating, against the
 * running stack, because a stub cannot answer that question at all.
 */
export function resetAttributes(password: string): Readonly<Record<string, unknown>> {
  return { password };
}

/**
 * Issue a member a new credential, and revoke every session the old one minted.
 *
 * THE ORDER IS THE ONE THE RENAME ALREADY USES (`updateUserById` above): read
 * the target row AS THE CALLER, take the organization off the ROW, and
 * authorize against that. The member id in the body is a claim; the row is what
 * turns it into a fact, and `members_select_own_organization` (`0003:289-300`,
 * narrowed by `0011` to an admin's organization or the caller's own row) means
 * another tenant's member — or, to a member-role caller, a colleague — simply is
 * not there, so such an id is indistinguishable from one that never existed.
 *
 * THE PASSWORD IS GENERATED AFTER THE GATE, so a refused caller never causes a
 * credential to exist at all, and it travels to GoTrue and to the reply and
 * nowhere else — never a log argument, never `user_metadata`.
 *
 * AN ACCOUNT HAS TO COME BACK BEFORE THIS ANSWERS 200. `error === null` alone
 * is not proof: `{ data: { user: null }, error: null }` would be read as a
 * success and put a password on screen that no account received — and the admin
 * reads it out to somebody who is then locked out of an account with a
 * credential nobody knows. {@link createUser} proves its own write the same way,
 * through {@link accountIdOf}.
 *
 * NO COMPENSATION AND NO `saved` FLAG. One store is written, so a disagreement
 * between two stores is unrepresentable here — which is why this operation has
 * no analogue to `USERNAME_NOT_RESTORED` and never reports a partial save.
 */
export async function resetPassword(
  dependencies: ResetDependencies,
  body: unknown,
): Promise<OperationReply> {
  const validated = resetPayloadOf(body);

  if (!validated.ok) return { status: 400, body: { code: validated.code } };

  const payload = validated.payload;

  const found = await dependencies.caller
    .from(MEMBERS_TABLE)
    .select(MEMBER_RESET_COLUMNS)
    .eq(ID_COLUMN, payload.memberId)
    .limit(ONE_ROW);

  if (found.error !== null) {
    console.error(ACCESS_UNREADABLE, found.error.code);

    return { status: 503, body: { code: ACCESS_UNREADABLE } };
  }

  const member = fieldsOf(rowsOf(found)[0] ?? null);
  const organization = member === null ? null : textAt(member, ORGANIZATION_COLUMN);
  const accountId = member === null ? null : textAt(member, AUTH_USER_COLUMN);

  if (organization === null || accountId === null) {
    return { status: 404, body: { code: MEMBER_UNKNOWN } };
  }

  // AGAINST THE ROW'S OWN ORGANIZATION, never against anything in the request.
  // A caller who is an admin somewhere else, a `member_role` caller and a
  // deactivated one all answer the same single code — no oracle.
  const authorized = await authorizeAdminOf(dependencies.caller, organization);

  if (!authorized.ok) return authorizationRefusal(authorized.code);

  // AFTER THE GATE. A credential generated before it would exist for a caller
  // that was about to be refused, which is one more copy than this system ever
  // wants of the one value it cannot recover.
  const password = generatePassword(dependencies.randomBytes);

  const applied = await dependencies.privileged.auth.admin.updateUserById(
    accountId,
    resetAttributes(password),
  );

  if (applied.error !== null) {
    // THE CAUSE, NEVER THE CREDENTIAL. `code` and `status` point an operator at
    // what GoTrue refused; the password is the one argument that may not appear
    // on this line, because `console` outlives the one showing.
    console.error(PASSWORD_NOT_APPLIED, applied.error.code, applied.error.status);

    return { status: 502, body: { code: PASSWORD_NOT_APPLIED } };
  }

  // THE PROOF THE WRITE LANDED, and the reason this is not `if (error !== null)`
  // and nothing else. Nothing was written to `members`, so there is nothing to
  // compensate — what there is to do is refuse to show a password no account
  // holds.
  if (accountIdOf(applied) === null) {
    console.error(PASSWORD_NOT_APPLIED);

    return { status: 502, body: { code: PASSWORD_NOT_APPLIED } };
  }

  // THE ONLY COPY LEAVES HERE. No `members` row was written and none will be:
  // the credential lives in `auth.users` and the reply, and the reply is shown
  // once.
  return { status: 200, body: { code: PASSWORD_RESET, password } };
}
