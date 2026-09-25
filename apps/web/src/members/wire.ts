/**
 * The member write path's WIRE VOCABULARY — the SPA's copy of what
 * `supabase/functions/admin-auth/operations.ts` puts on the wire.
 *
 * WHY THIS IS ITS OWN MODULE AND IMPORTS NOTHING. The two trees cannot import
 * each other: one is bundled into the SPA by Vite and the other runs on Deno
 * with an `npm:` specifier. So the vocabulary is written twice, and written
 * twice it drifts — renaming the VALUE of {@link MEMBER_CREATED} on one side
 * reports a successful create as a service failure and throws away the
 * generated password, the one unrecoverable value in this system, with both
 * suites green.
 *
 * `test/admin-auth-boundary.test.ts` is the one file that can import both, and
 * it can only do so because THIS module reaches nothing else. `members/write.ts`
 * pulls in `@/members/list`, which pulls in `@/supabase/client`, which pulls in
 * `@supabase/supabase-js` — and pnpm's isolated linker (`.npmrc`) means the
 * root project cannot resolve that at all. A leaf is what makes the contract
 * case possible; folding these constants back into `write.ts` would make the
 * binding unwritable and the drift invisible again.
 *
 * `members/write.ts` re-exports every name below, so no caller has to know this
 * file exists.
 */

/** The Edge Function this module calls, by name (`supabase/functions/admin-auth`). */
export const MEMBER_WRITE_FUNCTION = 'admin-auth';

/** The three operations `OPERATIONS` declares as implemented. */
export const CREATE_USER_OPERATION = 'createUser';
export const UPDATE_USER_OPERATION = 'updateUserById';
/**
 * The admin-issued reset, by the name the function dispatches on.
 *
 * ITS VALUE IS A DISPATCH KEY, not a label. Misspelt here and nowhere else,
 * every reset a browser sends arrives as an unknown operation, the transport
 * answers `OPERATION_UNKNOWN`, {@link memberWriteFailureOf} maps that to
 * {@link MEMBER_WRITE_UNAVAILABLE}, and an administrator whose member has no
 * other recovery route is told to try again for ever — with both suites green,
 * because each side compares the reply to the constant it imported. So
 * `write.test.ts` pins the outbound body against the LITERAL `'resetPassword'`,
 * the way it already does for the two siblings, and the contract case in
 * `test/admin-auth-boundary.test.ts` binds this list to `OPERATIONS`.
 */
export const RESET_PASSWORD_OPERATION = 'resetPassword';

/** The success gate for a create. Its VALUE crosses the wire, so it is bound to
 *  the function's own constant by the contract case in the boundary suite. */
export const MEMBER_CREATED = 'MEMBER_CREATED';
/** The success gate for a rename. Same contract, same binding. */
export const USERNAME_CHANGED = 'USERNAME_CHANGED';
/**
 * The success gate for a reset. Same contract, same binding.
 *
 * A REPLY IS A SUCCESS ONLY WHEN IT CARRIES THIS CODE AND A PASSWORD. The
 * function refuses to emit it unless the auth store answered with an account,
 * and {@link MEMBER_PASSWORD_NOT_APPLIED} is what it says instead — because a
 * panel showing a credential no account received locks the member out of the
 * one account nobody can now recover.
 */
export const PASSWORD_RESET = 'PASSWORD_RESET';

// ------------------------------------------------------------- the refusals

/** The database declined this session. Not an outage — asking again asks the
 *  same question of the same claim. */
export const MEMBER_WRITE_REFUSED = 'MEMBER_WRITE_REFUSED';
/** A shape on `members` refused a value: a not-null, a check, a range. */
export const MEMBER_WRITE_INVALID = 'MEMBER_WRITE_INVALID';
/** That username is already issued in this organization, in some casing. */
export const MEMBER_USERNAME_TAKEN = 'MEMBER_USERNAME_TAKEN';
/** The username cannot be the local part of a sign-in address. */
export const MEMBER_USERNAME_INVALID = 'MEMBER_USERNAME_INVALID';
/**
 * The member id reaches nobody.
 *
 * ITS OWN CODE, and that is the finding it closes rather than a nicety.
 * Collapsed into {@link MEMBER_WRITE_REFUSED} it renders "sign out and sign in
 * again" — an instruction that cannot work — to an administrator whose session
 * is perfectly good and who followed a stale link or a row that was deleted
 * while they were looking at it.
 */
export const MEMBER_UNKNOWN = 'MEMBER_UNKNOWN';
/** The sign-in identity did not move; the row was put back and nothing changed. */
export const MEMBER_USERNAME_NOT_APPLIED = 'MEMBER_USERNAME_NOT_APPLIED';
/** The compensation failed: the two stores now disagree about this member's
 *  username, and only an operator can settle it. */
export const MEMBER_USERNAME_UNSETTLED = 'MEMBER_USERNAME_UNSETTLED';
/**
 * The credential did not change, so the old one still works and nothing is
 * shown.
 *
 * ITS OWN CODE rather than the service fallback, and the distinction is what
 * the admin does next. "Try again" happens to be the right move here too — but
 * the SENTENCE matters: this surface is the only recovery an account with no
 * email address has, so "the password was not changed" is the fact the admin
 * needs before they tell somebody a credential they were never given.
 */
export const MEMBER_PASSWORD_NOT_APPLIED = 'MEMBER_PASSWORD_NOT_APPLIED';
/** The account was created and could not be removed after its row was refused. */
export const MEMBER_ACCOUNT_STRANDED = 'MEMBER_ACCOUNT_STRANDED';
/** `0002:193-223`'s deferred trigger: the organization would have no admin. */
export const ORGANIZATION_WOULD_HAVE_NO_ADMIN = 'ORGANIZATION_WOULD_HAVE_NO_ADMIN';
/**
 * The list read this surface is seeded from reached no row.
 *
 * DISTINCT FROM {@link MEMBER_WRITE_REFUSED}, which is about a write. `/ljudi/$id`
 * is reachable by URL, so a bookmarked link opened with a stale or claim-less
 * session reaches a permanent RLS refusal — and "Spremanje trenutačno nije
 * moguće. Pokušaj ponovno." is an instruction that cannot work, because asking
 * again asks the same question of the same claim. It renders the LIST's own
 * refusal, which already names the action that can change the answer.
 */
export const MEMBER_READ_REFUSED = 'MEMBER_READ_REFUSED';
/**
 * The maximum leave allowance the column can physically hold.
 *
 * `0002:145` types `leave_allowance_days` as `smallint`, so 32768 is not "a
 * large allowance" — it is `22003 numeric_value_out_of_range`, a refusal about
 * a storage type that names nothing the admin can act on. UX-DR34 and AD-3 both
 * prefer a control that cannot EXPRESS the broken case to a refusal explaining
 * it afterwards, which is the argument `0002:106` already makes about the leave
 * year's day. Shared by both forms and by the parse below so the control, the
 * parser and the function's payload check cannot disagree.
 */
export const LEAVE_ALLOWANCE_MAX = 32767;
/** The service could not be reached, or answered something that is not a reply. */
export const MEMBER_WRITE_UNAVAILABLE = 'MEMBER_WRITE_UNAVAILABLE';

// ------------------------------------------------- deactivation (story 1.6)

/**
 * A status version dated before the organization's today.
 *
 * `0008`'s insert policy refuses it as `42501` like every other rule on that
 * write, so the code is the surface's own reading of what it sent: the date
 * field is the value to correct, and a past date would rewrite past rosters.
 */
export const MEMBER_STATUS_IN_PAST = 'MEMBER_STATUS_IN_PAST';
/** An admin naming their own row. The control is never offered there; this is
 *  what a stale screen or a direct call is told. */
export const MEMBER_STATUS_SELF = 'MEMBER_STATUS_SELF';
/** A version already exists for this member on that date: the policy's
 *  date-order rule, or `23505` on `unique (member_id, effective_from)`. */
export const MEMBER_STATUS_DATE_TAKEN = 'MEMBER_STATUS_DATE_TAKEN';
/** A version dated BEFORE the member's latest one. Versions append in date
 *  order (`0008`), so the later change has to be cancelled first. */
export const MEMBER_STATUS_OUT_OF_ORDER = 'MEMBER_STATUS_OUT_OF_ORDER';
/** A version that changes nothing: deactivating a member whose latest state
 *  is inactive, or reactivating an active one. */
export const MEMBER_STATUS_UNCHANGED = 'MEMBER_STATUS_UNCHANGED';
/** Cancelling a version already in effect — dated today or earlier. It has
 *  decided some day's status, and removing it would rewrite that day. */
export const MEMBER_STATUS_IN_EFFECT = 'MEMBER_STATUS_IN_EFFECT';
/**
 * The member's status changed since this screen read it: a cancellation names
 * a version that is no longer the latest, or the database refused a change the
 * list says it would admit. The thing to do next is look again, so the screen
 * refetches the list whenever a status change is refused.
 */
export const MEMBER_STATUS_STALE = 'MEMBER_STATUS_STALE';

/** Deactivate: a version with `active = false`. */
export const DEACTIVATE = 'deactivate';
/** Reactivate: a version with `active = true`. */
export const REACTIVATE = 'reactivate';
/** Cancel the scheduled change: delete the member's latest version, which is
 *  dated after today. */
export const WITHDRAW = 'withdraw';

export type StatusChange = typeof DEACTIVATE | typeof REACTIVATE | typeof WITHDRAW;

/** The offer's label, naming the member it acts on. */
export function statusOfferMessageKey(
  change: StatusChange,
): 'ljudi.status.deactivate' | 'ljudi.status.reactivate' | 'ljudi.status.withdraw' {
  if (change === DEACTIVATE) return 'ljudi.status.deactivate';
  if (change === REACTIVATE) return 'ljudi.status.reactivate';
  if (change === WITHDRAW) return 'ljudi.status.withdraw';

  const unhandled: never = change;

  return unhandled;
}

/**
 * The confirmation's sentence, naming the member and the date.
 *
 * TENSE FOLLOWS THE DATE: a change from today is worded in the present, one
 * from a later date in the future, because it has not happened yet and the
 * member can still sign in until then. A cancellation is only ever of a change
 * dated after today, so it has one sentence.
 */
export function statusPromptMessageKey(
  change: StatusChange,
  future: boolean,
):
  | 'ljudi.status.deactivatePrompt'
  | 'ljudi.status.deactivatePromptFuture'
  | 'ljudi.status.reactivatePrompt'
  | 'ljudi.status.reactivatePromptFuture'
  | 'ljudi.status.withdrawPrompt' {
  if (change === DEACTIVATE) {
    return future ? 'ljudi.status.deactivatePromptFuture' : 'ljudi.status.deactivatePrompt';
  }
  if (change === REACTIVATE) {
    return future ? 'ljudi.status.reactivatePromptFuture' : 'ljudi.status.reactivatePrompt';
  }
  if (change === WITHDRAW) return 'ljudi.status.withdrawPrompt';

  const unhandled: never = change;

  return unhandled;
}

/**
 * The key of the line stating a member's status TODAY — present tense:
 * "inactive from …" when the member is out, "active" otherwise.
 */
export function statusTodayMessageKey(
  activeToday: boolean,
): 'ljudi.status.active' | 'ljudi.status.inactiveFrom' {
  return activeToday ? 'ljudi.status.active' : 'ljudi.status.inactiveFrom';
}

/**
 * The key of the line stating the SCHEDULED change — future tense, because it
 * has not happened: "will be inactive from …", "will be active again from …".
 */
export function statusScheduledMessageKey(
  active: boolean,
): 'ljudi.status.scheduledActive' | 'ljudi.status.scheduledInactive' {
  return active ? 'ljudi.status.scheduledActive' : 'ljudi.status.scheduledInactive';
}

/** The confirm control, naming the member — the second press is a distinct,
 *  more specific decision than the first. */
export function statusConfirmMessageKey(
  change: StatusChange,
):
  | 'ljudi.status.deactivateConfirm'
  | 'ljudi.status.reactivateConfirm'
  | 'ljudi.status.withdrawConfirm' {
  if (change === DEACTIVATE) return 'ljudi.status.deactivateConfirm';
  if (change === REACTIVATE) return 'ljudi.status.reactivateConfirm';
  if (change === WITHDRAW) return 'ljudi.status.withdrawConfirm';

  const unhandled: never = change;

  return unhandled;
}

// ------------------------------------------------- team membership (story 1.7b)

/**
 * The team refusals, the surface's reading of what it sent — `0010`'s insert
 * and delete policies refuse every one of them as `42501` (or zero rows),
 * exactly as `0008`'s do, so each is named here against the entered values.
 */
/** A membership version dated before the organization's today. */
export const MEMBER_TEAM_IN_PAST = 'MEMBER_TEAM_IN_PAST';
/** A version already exists for this member on that date. */
export const MEMBER_TEAM_DATE_TAKEN = 'MEMBER_TEAM_DATE_TAKEN';
/** A version dated before the member's latest one. */
export const MEMBER_TEAM_OUT_OF_ORDER = 'MEMBER_TEAM_OUT_OF_ORDER';
/** The chosen team is the one the member is already on (or "no team" for a
 *  member on none). */
export const MEMBER_TEAM_UNCHANGED = 'MEMBER_TEAM_UNCHANGED';
/** The chosen team AND position are the ones the member already has (team
 *  position, `0015`): a position-only change must change the position. */
export const MEMBER_TEAM_POSITION_UNCHANGED = 'MEMBER_TEAM_POSITION_UNCHANGED';
/** A team was chosen with no position while the organization uses positions
 *  (`0015`) — or the setting changed since the screen read it. */
export const MEMBER_TEAM_POSITION_REQUIRED = 'MEMBER_TEAM_POSITION_REQUIRED';
/** A move is already scheduled; the only thing to do is cancel it first. */
export const MEMBER_TEAM_SCHEDULED = 'MEMBER_TEAM_SCHEDULED';
/** Cancelling a move already in effect — dated today or earlier. */
export const MEMBER_TEAM_IN_EFFECT = 'MEMBER_TEAM_IN_EFFECT';
/** The chosen team is archived. */
export const MEMBER_TEAM_ARCHIVED = 'MEMBER_TEAM_ARCHIVED';
/** The member's team history, or the teams, changed since the screen read
 *  them. Look again. */
export const MEMBER_TEAM_STALE = 'MEMBER_TEAM_STALE';

/** Move the member onto a team, or onto no team, from a date. */
export const TEAM_MOVE = 'move';

/** A team change: a move from a date, or cancelling the scheduled one. */
export type TeamChange = typeof TEAM_MOVE | typeof WITHDRAW;

/** The offer's label, naming the member it acts on. */
export function teamOfferMessageKey(
  change: TeamChange,
): 'smjene.membership.move' | 'smjene.membership.withdraw' {
  if (change === TEAM_MOVE) return 'smjene.membership.move';
  if (change === WITHDRAW) return 'smjene.membership.withdraw';

  const unhandled: never = change;

  return unhandled;
}

/** The confirmation names no position: none is offered, or no team is chosen. */
export const PROMPT_TEAM_ONLY = 'team';
/** The confirmation names the team and the position it is joined in. */
export const PROMPT_WITH_POSITION = 'withPosition';
/** The team stays; only the position changes, and the sentence says so. */
export const PROMPT_POSITION_ONLY = 'positionOnly';

/** How a team confirmation names the position (team position, `0015`). */
export type TeamPromptPosition =
  | typeof PROMPT_TEAM_ONLY
  | typeof PROMPT_WITH_POSITION
  | typeof PROMPT_POSITION_ONLY;

/**
 * The confirmation's sentence. TENSE FOLLOWS THE DATE, as the status prompt's
 * does, and a move to no team is its own sentence rather than a team name
 * that is not one. A cancellation is only ever of a later date.
 *
 * THE POSITION IS NAMED WHEN IT CHANGES: a move while positions are in use
 * names the position it is made in, and a change that keeps the team is its
 * own sentence about the position.
 */
export function teamPromptMessageKey(
  change: TeamChange,
  toNoTeam: boolean,
  future: boolean,
  position: TeamPromptPosition = PROMPT_TEAM_ONLY,
):
  | 'smjene.membership.movePrompt'
  | 'smjene.membership.movePromptFuture'
  | 'smjene.membership.movePositionPrompt'
  | 'smjene.membership.movePositionPromptFuture'
  | 'smjene.membership.positionPrompt'
  | 'smjene.membership.positionPromptFuture'
  | 'smjene.membership.removePrompt'
  | 'smjene.membership.removePromptFuture'
  | 'smjene.membership.withdrawPrompt' {
  if (change === TEAM_MOVE) {
    if (toNoTeam) {
      return future ? 'smjene.membership.removePromptFuture' : 'smjene.membership.removePrompt';
    }
    if (position === PROMPT_POSITION_ONLY) {
      return future ? 'smjene.membership.positionPromptFuture' : 'smjene.membership.positionPrompt';
    }
    if (position === PROMPT_WITH_POSITION) {
      return future
        ? 'smjene.membership.movePositionPromptFuture'
        : 'smjene.membership.movePositionPrompt';
    }

    return future ? 'smjene.membership.movePromptFuture' : 'smjene.membership.movePrompt';
  }
  if (change === WITHDRAW) return 'smjene.membership.withdrawPrompt';

  const unhandled: never = change;

  return unhandled;
}

/** The confirm control, naming the member. */
export function teamConfirmMessageKey(
  change: TeamChange,
): 'smjene.membership.moveConfirm' | 'smjene.membership.withdrawConfirm' {
  if (change === TEAM_MOVE) return 'smjene.membership.moveConfirm';
  if (change === WITHDRAW) return 'smjene.membership.withdrawConfirm';

  const unhandled: never = change;

  return unhandled;
}

/**
 * The line stating the SCHEDULED change — future tense, onto a team or none,
 * and with the position it is made in when positions are shown and it carries
 * one. A change that KEEPS THE TEAM is never worded as a move onto the team the
 * member is already on: with positions shown it states the new position, and
 * without them it is a neutral "a change is scheduled".
 */
export function teamScheduledMessageKey(
  toNoTeam: boolean,
  withPosition = false,
  keepsTeam = false,
):
  | 'smjene.membership.scheduled'
  | 'smjene.membership.scheduledPosition'
  | 'smjene.membership.scheduledPositionOnly'
  | 'smjene.membership.scheduledChange'
  | 'smjene.membership.scheduledNone' {
  if (toNoTeam) return 'smjene.membership.scheduledNone';
  if (keepsTeam) {
    return withPosition
      ? 'smjene.membership.scheduledPositionOnly'
      : 'smjene.membership.scheduledChange';
  }

  return withPosition ? 'smjene.membership.scheduledPosition' : 'smjene.membership.scheduled';
}

/** The line stating the team today, with the position when one is shown. */
export function teamCurrentMessageKey(
  withPosition: boolean,
): 'smjene.membership.current' | 'smjene.membership.currentPosition' {
  return withPosition ? 'smjene.membership.currentPosition' : 'smjene.membership.current';
}

export type MemberWriteFailure =
  | typeof MEMBER_WRITE_REFUSED
  | typeof MEMBER_WRITE_INVALID
  | typeof MEMBER_USERNAME_TAKEN
  | typeof MEMBER_USERNAME_INVALID
  | typeof MEMBER_UNKNOWN
  | typeof MEMBER_USERNAME_NOT_APPLIED
  | typeof MEMBER_USERNAME_UNSETTLED
  | typeof MEMBER_PASSWORD_NOT_APPLIED
  | typeof MEMBER_ACCOUNT_STRANDED
  | typeof ORGANIZATION_WOULD_HAVE_NO_ADMIN
  | typeof MEMBER_READ_REFUSED
  | typeof MEMBER_STATUS_IN_PAST
  | typeof MEMBER_STATUS_SELF
  | typeof MEMBER_STATUS_DATE_TAKEN
  | typeof MEMBER_STATUS_OUT_OF_ORDER
  | typeof MEMBER_STATUS_UNCHANGED
  | typeof MEMBER_STATUS_IN_EFFECT
  | typeof MEMBER_STATUS_STALE
  | typeof MEMBER_TEAM_IN_PAST
  | typeof MEMBER_TEAM_DATE_TAKEN
  | typeof MEMBER_TEAM_OUT_OF_ORDER
  | typeof MEMBER_TEAM_UNCHANGED
  | typeof MEMBER_TEAM_POSITION_UNCHANGED
  | typeof MEMBER_TEAM_POSITION_REQUIRED
  | typeof MEMBER_TEAM_SCHEDULED
  | typeof MEMBER_TEAM_IN_EFFECT
  | typeof MEMBER_TEAM_ARCHIVED
  | typeof MEMBER_TEAM_STALE
  | typeof MEMBER_WRITE_UNAVAILABLE;

/**
 * Every code the function can put on the wire, in the SPA's own spelling.
 *
 * DATA rather than a type alone, because the contract case in
 * `test/admin-auth-boundary.test.ts` iterates it: it imports
 * `OPERATION_CODES` from the function tree and asserts this list recognises
 * every entry. A code the function gained and this module never learned would
 * render as {@link MEMBER_WRITE_UNAVAILABLE} — "try again" for something that
 * will never succeed.
 */
export const WIRE_CODES = [
  // THE TRANSPORT'S OWN FIVE, which `handler.ts` answers with BEFORE any
  // operation runs. They were missing from this list and from the mapping
  // below, so every one of them fell through to `MEMBER_WRITE_UNAVAILABLE` —
  // and the one that matters is `AUTHORIZATION_MISSING`: a session that expired
  // while the form was open rendered "try again", for ever, when the one thing
  // that fixes it is signing in again.
  'AUTHORIZATION_MISSING',
  'METHOD_NOT_ALLOWED',
  'BODY_NOT_JSON',
  'OPERATION_UNKNOWN',
  'CLIENT_CONSTRUCTION_FAILED',
  'MEMBER_CREATED',
  'USERNAME_CHANGED',
  'PASSWORD_RESET',
  'NOT_AN_ADMIN',
  'ACCESS_UNREADABLE',
  'ORGANIZATION_UNREADABLE',
  'PAYLOAD_INVALID',
  'USERNAME_INVALID',
  'USERNAME_TAKEN',
  'ORGANIZATION_UNKNOWN',
  'MEMBER_UNKNOWN',
  'MEMBER_INVALID',
  'ACCOUNT_NOT_CREATED',
  'ACCOUNT_NOT_REMOVED',
  'USERNAME_NOT_APPLIED',
  'USERNAME_NOT_RESTORED',
  'PASSWORD_NOT_APPLIED',
  'OPERATION_FAILED',
] as const;

/**
 * One wire code as this application's own failure.
 *
 * TOTAL BY CONSTRUCTION: anything it has not been taught is
 * {@link MEMBER_WRITE_UNAVAILABLE}, which is the honest answer for a reply this
 * build does not understand. The contract case is what stops that fallback
 * quietly absorbing a code the function actually emits — it iterates the
 * function's own list and fails on the first one that lands here.
 *
 * The two SUCCESS codes are deliberately absent from the mapping: reaching this
 * function with one means a caller treated a success as a failure, and the
 * fallback is the only honest thing left to say about that.
 */
export function memberWriteFailureOf(code: string): MemberWriteFailure {
  // THE TRANSPORT'S OWN, and this one is not an outage: the request carried no
  // Authorization header at all, which from a signed-in screen means the
  // session went away underneath it. Telling somebody to try again is telling
  // them to repeat the request that has no credential on it.
  if (code === 'AUTHORIZATION_MISSING') return MEMBER_READ_REFUSED;
  if (code === 'NOT_AN_ADMIN') return MEMBER_WRITE_REFUSED;
  if (code === 'USERNAME_TAKEN') return MEMBER_USERNAME_TAKEN;
  if (code === 'USERNAME_INVALID') return MEMBER_USERNAME_INVALID;
  if (code === 'PAYLOAD_INVALID') return MEMBER_WRITE_INVALID;
  if (code === 'MEMBER_INVALID') return MEMBER_WRITE_INVALID;
  if (code === 'MEMBER_UNKNOWN') return MEMBER_UNKNOWN;
  if (code === 'USERNAME_NOT_APPLIED') return MEMBER_USERNAME_NOT_APPLIED;
  if (code === 'USERNAME_NOT_RESTORED') return MEMBER_USERNAME_UNSETTLED;
  if (code === 'PASSWORD_NOT_APPLIED') return MEMBER_PASSWORD_NOT_APPLIED;
  if (code === 'ACCOUNT_NOT_REMOVED') return MEMBER_ACCOUNT_STRANDED;

  // `ACCESS_UNREADABLE`, `ORGANIZATION_UNKNOWN`, `ORGANIZATION_UNREADABLE`,
  // `ACCOUNT_NOT_CREATED`, `OPERATION_FAILED` and the remaining transport codes
  // all land here, and every one of them is the same thing to the person in
  // front of the form: the service could not complete the request, and trying
  // again is a reasonable next move. They are separate CODES because they point
  // an operator at completely different things in the log.
  return MEMBER_WRITE_UNAVAILABLE;
}

// ---------------------------------------------------------------------------
// WHAT EACH CODE MEANS, and it lives here rather than in `members/write.ts` for
// the reason the codes themselves do: `test/admin-auth-boundary.test.ts` is the
// one file that can import both trees, and it has to hold the FUNCTION's
// SQLSTATE mapping and this one to the same answer. `write.ts` reaches
// `@supabase/supabase-js` transitively and pnpm's isolated linker (`.npmrc`)
// means the root project cannot resolve that at all — so a mapping written
// there is a mapping nothing can bind, and the two paths' fall-throughs were
// opposites for exactly that long.
//
// `members/write.ts` re-exports every name below.
// ---------------------------------------------------------------------------

/** As much of a PostgREST error as the mapping below reads. */
export interface PostgrestFailure {
  // `| undefined` on every member, for the reason `members/list.ts`'s identical
  // interface records: `exactOptionalPropertyTypes` is on and postgrest-js
  // declares these as present-and-possibly-undefined.
  readonly code?: string | undefined;
  readonly message?: string | undefined;
  readonly details?: string | undefined;
}

/** An edit that failed, and whether anything was written before it did. */
export interface MemberWriteRefusal {
  readonly code: MemberWriteFailure;
  /**
   * Whether the ordinary fields reached the database before the failure.
   *
   * THE PARTIAL SAVE. The four fields are written before the username moves, so
   * a refused rename leaves name, address, level and allowance genuinely in the
   * database and the sign-in identity genuinely unchanged. A flat failure is not
   * wrong about the username and is silent about the rest — and the admin's next
   * move, reopening the form, shows them the new values with nothing to explain
   * why the username is not among them. Human decision 2026-09-18.
   */
  readonly saved: boolean;
}

/**
 * The SQLSTATE the policy raises, and the two CLASSES that mean "correct a
 * value".
 *
 * BY CLASS RATHER THAN BY A LIST OF CODES, and that is the finding this closes.
 * A list names the refusals somebody thought of — `23502`, `23514`, `23505` —
 * and falls through on the ones they did not: `22003 numeric_value_out_of_range`
 * from a leave allowance that overflows `smallint`, `22001` from a value too
 * long for its column. Every one of those is a value on the form, and the
 * fall-through said "try again", which invites pressing Save on a write that is
 * refused every single time.
 *
 * Class `22` is `data_exception` and class `23` is
 * `integrity_constraint_violation`; between them they are the SQLSTATEs that
 * mean the ROW was wrong. Everything else — connection failures, serialization
 * failures, a renamed column — is the service, not the person.
 *
 * `supabase/functions/admin-auth/operations.ts` applies the identical rule, and
 * `test/admin-auth-boundary.test.ts` — the one file that can import both trees —
 * asserts the two agree over a list of SQLSTATEs including ones NEITHER names
 * explicitly. Without that, the same mistake read as two different problems
 * depending on whether the username happened to change in the same edit.
 */
const INSUFFICIENT_PRIVILEGE = '42501';
const VALUE_CLASSES = ['22', '23'];

/** Whether a SQLSTATE says the row was wrong rather than the service. */
function namesAValue(code: string | undefined): boolean {
  return code !== undefined && VALUE_CLASSES.includes(code.slice(0, 2));
}

/** As much of a PostgREST error as this module reads. */
export interface PostgrestFailure {
  // `| undefined` on every member, for the reason `members/list.ts`'s identical
  // interface records: `exactOptionalPropertyTypes` is on and postgrest-js
  // declares these as present-and-possibly-undefined.
  readonly code?: string | undefined;
  readonly message?: string | undefined;
  readonly details?: string | undefined;
}

/**
 * A PostgREST refusal on `members`, as this application's own failure.
 *
 * `23502` IS "CORRECT A VALUE", not "try again", and it is mapped here for the
 * same reason the function maps it: a not-null violation is a field the form
 * left empty, and a message inviting a retry would have somebody press Save
 * four more times on a form that will be refused every time. The two paths have
 * to agree, or the same mistake reads as two different problems depending on
 * whether the username happened to change in the same edit.
 *
 * THE ZERO-ADMINS TRIGGER ARRIVES AS A MESSAGE, not as a SQLSTATE of its own:
 * `refuse_organization_with_no_admin` (`0002:193-223`) raises `check_violation`
 * with the stable code in MESSAGE, because Postgres accepts only a five
 * character SQLSTATE there. So it is recognised before the general check
 * mapping, or demoting the last admin would read as "correct a value" with no
 * value on the form to correct.
 */
export function editFailureOf(error: PostgrestFailure): MemberWriteFailure {
  // BOTH FIELDS, because PostgREST does not promise which one carries it.
  // `refuse_organization_with_no_admin` puts the stable code in MESSAGE and the
  // organization in DETAIL, and a guard reading one field is a guard that stops
  // working the day the other carries it — silently, with demoting the last
  // administrator then reading as "correct a value" and no value on the form to
  // correct.
  const raised = `${error.message ?? ''} ${error.details ?? ''}`;

  if (raised.includes(ORGANIZATION_WOULD_HAVE_NO_ADMIN)) {
    return ORGANIZATION_WOULD_HAVE_NO_ADMIN;
  }
  if (error.code === INSUFFICIENT_PRIVILEGE) return MEMBER_WRITE_REFUSED;
  // NO `23505` CASE, deliberately, and its absence is a finding rather than an
  // omission: this path's update writes `name`, `email`, `role` and
  // `leave_allowance_days` and NEVER `username`, so "that username is already
  // issued" is a sentence this path cannot honestly say. A unique violation
  // here would be some other constraint entirely, and class `23` already
  // reports it as a value to correct. The FUNCTION keeps its own `23505` case,
  // because `updateUserById` is the one write that does move the column.
  if (namesAValue(error.code)) return MEMBER_WRITE_INVALID;

  return MEMBER_WRITE_UNAVAILABLE;
}

// -------------------------------------------------------------- the messages

/**
 * The edge, and the only place one of these codes becomes Croatian.
 *
 * EXHAUSTIVE, with `never` at the end — the idiom `@/organization/messages`
 * records. A fall-through would answer "try again" for a code it had not been
 * taught, which is wrong in the one direction that matters: it calls a
 * permanent refusal transient.
 *
 * NEITHER REFUSAL SAYS "you need administrator rights". Both screens are
 * reachable only through `/ljudi`'s guard, which has already read this session's
 * level and found it to be an administrator's — so telling the person they lack
 * the rights would be false on the one path that reaches them, exactly as
 * `membersMessageKey` argues for the list.
 */
export function memberWriteMessageKey(
  failure: MemberWriteFailure,
):
  | 'ljudi.error.refused'
  | 'ljudi.form.error.refused'
  | 'ljudi.form.error.invalid'
  | 'ljudi.form.error.usernameTaken'
  | 'ljudi.form.error.usernameInvalid'
  | 'ljudi.form.error.unknown'
  | 'ljudi.form.error.notApplied'
  | 'ljudi.form.error.unsettled'
  | 'ljudi.form.error.resetNotApplied'
  | 'ljudi.form.error.stranded'
  | 'ljudi.form.error.lastAdmin'
  | 'ljudi.form.error.statusPast'
  | 'ljudi.form.error.statusSelf'
  | 'ljudi.form.error.statusTaken'
  | 'ljudi.form.error.statusOrder'
  | 'ljudi.form.error.statusUnchanged'
  | 'ljudi.form.error.statusInEffect'
  | 'ljudi.form.error.statusStale'
  | 'smjene.membership.error.past'
  | 'smjene.membership.error.taken'
  | 'smjene.membership.error.order'
  | 'smjene.membership.error.unchanged'
  | 'smjene.membership.error.positionUnchanged'
  | 'smjene.membership.error.positionRequired'
  | 'smjene.membership.error.scheduled'
  | 'smjene.membership.error.inEffect'
  | 'smjene.membership.error.archived'
  | 'smjene.membership.error.stale'
  | 'ljudi.form.error.unavailable' {
  if (failure === MEMBER_WRITE_REFUSED) return 'ljudi.form.error.refused';
  if (failure === MEMBER_WRITE_INVALID) return 'ljudi.form.error.invalid';
  if (failure === MEMBER_USERNAME_TAKEN) return 'ljudi.form.error.usernameTaken';
  if (failure === MEMBER_USERNAME_INVALID) return 'ljudi.form.error.usernameInvalid';
  if (failure === MEMBER_UNKNOWN) return 'ljudi.form.error.unknown';
  if (failure === MEMBER_USERNAME_NOT_APPLIED) return 'ljudi.form.error.notApplied';
  if (failure === MEMBER_USERNAME_UNSETTLED) return 'ljudi.form.error.unsettled';
  if (failure === MEMBER_PASSWORD_NOT_APPLIED) return 'ljudi.form.error.resetNotApplied';
  if (failure === MEMBER_ACCOUNT_STRANDED) return 'ljudi.form.error.stranded';
  if (failure === ORGANIZATION_WOULD_HAVE_NO_ADMIN) return 'ljudi.form.error.lastAdmin';
  // THE LIST'S OWN REFUSAL, reused rather than reworded. This surface is
  // reachable by URL, so the read it is seeded from can be refused outright —
  // and `ljudi.error.refused` already names the action that can change that
  // answer, where every `ljudi.form.error.*` message is about a WRITE and would
  // be false here.
  if (failure === MEMBER_READ_REFUSED) return 'ljudi.error.refused';
  if (failure === MEMBER_STATUS_IN_PAST) return 'ljudi.form.error.statusPast';
  if (failure === MEMBER_STATUS_SELF) return 'ljudi.form.error.statusSelf';
  if (failure === MEMBER_STATUS_DATE_TAKEN) return 'ljudi.form.error.statusTaken';
  if (failure === MEMBER_STATUS_OUT_OF_ORDER) return 'ljudi.form.error.statusOrder';
  if (failure === MEMBER_STATUS_UNCHANGED) return 'ljudi.form.error.statusUnchanged';
  if (failure === MEMBER_STATUS_IN_EFFECT) return 'ljudi.form.error.statusInEffect';
  if (failure === MEMBER_STATUS_STALE) return 'ljudi.form.error.statusStale';
  // STORY 1.7b, under `smjene.*`: the one namespace whose messages may say
  // the Team.
  if (failure === MEMBER_TEAM_IN_PAST) return 'smjene.membership.error.past';
  if (failure === MEMBER_TEAM_DATE_TAKEN) return 'smjene.membership.error.taken';
  if (failure === MEMBER_TEAM_OUT_OF_ORDER) return 'smjene.membership.error.order';
  if (failure === MEMBER_TEAM_UNCHANGED) return 'smjene.membership.error.unchanged';
  if (failure === MEMBER_TEAM_POSITION_UNCHANGED) {
    return 'smjene.membership.error.positionUnchanged';
  }
  if (failure === MEMBER_TEAM_POSITION_REQUIRED) return 'smjene.membership.error.positionRequired';
  if (failure === MEMBER_TEAM_SCHEDULED) return 'smjene.membership.error.scheduled';
  if (failure === MEMBER_TEAM_IN_EFFECT) return 'smjene.membership.error.inEffect';
  if (failure === MEMBER_TEAM_ARCHIVED) return 'smjene.membership.error.archived';
  if (failure === MEMBER_TEAM_STALE) return 'smjene.membership.error.stale';
  if (failure === MEMBER_WRITE_UNAVAILABLE) return 'ljudi.form.error.unavailable';

  const unhandled: never = failure;

  return unhandled;
}

/**
 * The message key one failure renders as.
 *
 * DERIVED FROM THE FUNCTION rather than declared beside it, which is what keeps
 * the union in the SIGNATURE where `prijava.test.ts` reads keys from: a named
 * alias in the return position makes every one of these keys invisible to the
 * "every key declared is rendered" comparison, so `hr.json` would be free to
 * hold ten messages nothing renders.
 */
export type MemberWriteMessageKey = ReturnType<typeof memberWriteMessageKey>;

/** The key that says the ordinary fields DID land. Rendered only beside the
 *  reason the username did not — see {@link memberWriteMessageKeys}. */
export const PARTIAL_SAVE_KEY = 'ljudi.form.error.saved';

/**
 * The space between two sentences in one alert.
 *
 * NAMED HERE because `routes/ljudi.$id.tsx` may hold no string literal of its
 * own — `prijava.test.ts` sweeps every screen for a literal that is neither a
 * `t()` key nor a structural attribute value, and a single space is still one.
 */
export const MESSAGE_SEPARATOR = ' ';

/** An edit that failed, and whether anything was written before it did. */
export interface MemberWriteRefusal {
  readonly code: MemberWriteFailure;
  /**
   * Whether the ordinary fields reached the database before the failure.
   *
   * THE PARTIAL SAVE. The four fields are written before the username moves, so
   * a refused rename leaves name, address, level and allowance genuinely in the
   * database and the sign-in identity genuinely unchanged. A flat failure is not
   * wrong about the username and is silent about the rest — and the admin's next
   * move, reopening the form, shows them the new values with nothing to explain
   * why the username is not among them. Human decision 2026-09-18.
   */
  readonly saved: boolean;
}

/**
 * What one refused edit says, as one or two keys.
 *
 * TWO SENTENCES RATHER THAN TWENTY KEYS. The partial case needs to name both
 * halves — what was written and what was not — and the reason the rename failed
 * is one of five things the admin may be able to act on. Pairing a fixed "the
 * rest was saved" sentence with the reason keeps one key per reason instead of
 * two, and keeps the PAIRING in a module a test can execute rather than in a
 * component nothing runs.
 */
export function memberWriteMessageKeys(
  refusal: MemberWriteRefusal,
): readonly (MemberWriteMessageKey | typeof PARTIAL_SAVE_KEY)[] {
  const reason = memberWriteMessageKey(refusal.code);

  return refusal.saved ? [PARTIAL_SAVE_KEY, reason] : [reason];
}
