import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MemberListRow, MembersSurfaceState } from '@/members/list';
import {
  DEFAULT_MEMBER_ROLE,
  LEAVE_ALLOWANCE_MAX,
  MEMBER_ACCOUNT_STRANDED,
  MEMBER_CREATED,
  MEMBER_PASSWORD_NOT_APPLIED,
  MEMBER_READ_REFUSED,
  MEMBER_EDIT_COLUMNS,
  MEMBER_STATUS_DATE_TAKEN,
  MEMBER_STATUS_IN_EFFECT,
  MEMBER_STATUS_IN_PAST,
  MEMBER_STATUS_OUT_OF_ORDER,
  MEMBER_STATUS_SELF,
  MEMBER_STATUS_STALE,
  MEMBER_STATUS_TABLE,
  MEMBER_STATUS_UNCHANGED,
  MEMBER_UNKNOWN,
  MEMBER_USERNAME_INVALID,
  MEMBER_USERNAME_NOT_APPLIED,
  MEMBER_USERNAME_TAKEN,
  MEMBER_USERNAME_UNSETTLED,
  MEMBER_WRITE_FUNCTION,
  MEMBER_WRITE_INVALID,
  MEMBER_WRITE_REFUSED,
  MEMBER_WRITE_UNAVAILABLE,
  MESSAGE_SEPARATOR,
  ORGANIZATION_WOULD_HAVE_NO_ADMIN,
  PARTIAL_SAVE_KEY,
  PASSWORD_RESET,
  DEACTIVATE,
  REACTIVATE,
  WITHDRAW,
  RESET_ARMED,
  RESET_BUSY,
  RESET_IDLE,
  RESET_SHOWN,
  SESSION_SUBJECT_KEY,
  STATUS_ARMED,
  STATUS_BUSY,
  STATUS_IDLE,
  USERNAME_CHANGED,
  WIRE_CODES,
  changeMemberStatus,
  chosenRole,
  createFormStateOf,
  createMember,
  editFailureOf,
  enteredAllowance,
  memberFormKey,
  memberFormRefusalOf,
  memberWriteFailureOf,
  memberWriteMessageKey,
  memberWriteMessageKeys,
  raisedForMember,
  readSessionSubject,
  renameMember,
  replyCodeOf,
  resetPassword,
  resetStageOf,
  saveMember,
  standingConfirmation,
  statusBlockKey,
  statusConfirmMessageKey,
  statusFailureOf,
  statusOfferMessageKey,
  statusOfferOf,
  statusPreflightOf,
  statusPromptKeyOf,
  statusPromptMessageKey,
  statusScheduledMessageKey,
  statusSinceOf,
  statusStageOf,
  statusTodayMessageKey,
  storedEmail,
  usernameChanged,
  type FunctionsAnswer,
  type MemberStatusTable,
  type StatusChange,
  type StatusContext,
  type MemberEdits,
  type MemberFunctions,
  type MemberWriteFailure,
  type MemberWriteTable,
  type PostgrestAnswer,
  MEMBER_TEAM_ARCHIVED,
  MEMBER_TEAM_DATE_TAKEN,
  MEMBER_TEAM_IN_EFFECT,
  MEMBER_TEAM_IN_PAST,
  MEMBER_TEAM_OUT_OF_ORDER,
  MEMBER_TEAM_SCHEDULED,
  MEMBER_TEAM_STALE,
  MEMBER_TEAM_TABLE,
  MEMBER_TEAM_UNCHANGED,
  NO_TEAM_VALUE,
  TEAM_MOVE,
  changeMemberTeam,
  chosenTeam,
  standingTeamConfirmation,
  teamBlockKey,
  teamConfirmMessageKey,
  teamFailureOf,
  teamOfferMessageKey,
  teamOfferOf,
  teamPickerDefault,
  teamPreflightOf,
  teamPromptKeyOf,
  teamScheduledMessageKey,
  type MemberTeamTable,
  type TeamConfirmation,
  type TeamContext,
} from '@/members/write';

/**
 * The member write path's rules, EXECUTED (story 1.5b).
 *
 * This file exists because `routes/ljudi.novi.tsx` and `routes/ljudi.$id.tsx`
 * cannot be tested at all: AD-15 bans jsdom and `apps/web/vitest.config.ts`
 * collects `src/**\/*.test.ts` only, so a rule written in either screen is
 * asserted by nothing but a regex over its own source. Story 1.5a's review
 * proved what that is worth by mutating code and watching the suite stay green,
 * and 1.5b's first iteration reproduced it four more times.
 *
 * THE CENTRAL CASE IN THIS FILE is the branch: an edit that changes only the
 * name, the address, the level or the allowance must NOT reach the privileged
 * function, and an edit that moves the username must. It is asserted by
 * COUNTING WHAT THE STUB WAS ASKED — a source-level check would pass on a screen
 * that calls the function every time, which widens the secret-key boundary's
 * blast radius to every edit in the application.
 */

/** A member row, with everything but the interesting field held still. */
function member(fields: Partial<MemberListRow> = {}): MemberListRow {
  return {
    id: 'member-1',
    organizationId: 'organization-1',
    name: 'Ana Kovač',
    username: 'ana.kovac',
    email: null,
    role: 'member_role',
    leaveAllowanceDays: 20,
    fireRank: null,
    authUserId: 'account-1',
    statusVersions: [],
    teamVersions: [],
    timeZone: 'Europe/Zagreb',
    ...fields,
  };
}

/** The organization's today in every status case. */
const TODAY = '2026-09-23';

/** The fixture admin who is doing the deactivating. */
const CALLER = member({ id: 'admin-1', authUserId: 'account-admin', role: 'admin', name: 'Ivan' });

/** A status change about `target`, judged against an organization of the
 *  caller, the target and whoever else is passed. */
function statusContext(
  target: MemberListRow = member(),
  others: readonly MemberListRow[] = [],
): StatusContext {
  return {
    member: target,
    members: [CALLER, target, ...others],
    callerAuthUserId: CALLER.authUserId,
    today: TODAY,
  };
}

/** The edits a form collects, defaulted to "nothing changed". */
function edits(fields: Partial<MemberEdits> = {}): MemberEdits {
  return {
    name: 'Ana Kovač',
    email: null,
    role: 'member_role',
    leaveAllowanceDays: 20,
    username: 'ana.kovac',
    ...fields,
  };
}

interface TableCall {
  readonly values: Readonly<Record<string, unknown>>;
  readonly column: string;
  readonly id: string;
  readonly columns: string;
}

/** A `members` table that answers the queued answers in order, recording each
 *  call. A second update on the same stub is the compensating restore. */
function tableThat(...answers: readonly (PostgrestAnswer | Error)[]): {
  table: MemberWriteTable;
  calls: TableCall[];
} {
  const calls: TableCall[] = [];
  let index = 0;

  return {
    calls,
    table: {
      update(values) {
        return {
          eq(column, id) {
            return {
              select(columns) {
                calls.push({ values, column, id, columns });
                const answer = answers[index] ?? answers[answers.length - 1];
                index += 1;

                if (answer instanceof Error) throw answer;

                return Promise.resolve(
                  answer ?? { data: [{ id: 'member-1' }], error: null },
                );
              },
            };
          },
        };
      },
    },
  };
}

interface FunctionCall {
  readonly name: string;
  readonly body: Readonly<Record<string, unknown>>;
}

/** An Edge Function seam that answers the queued answers in order. */
function functionsThat(...answers: readonly (FunctionsAnswer | Error)[]): {
  functions: MemberFunctions;
  calls: FunctionCall[];
} {
  const calls: FunctionCall[] = [];
  let index = 0;

  return {
    calls,
    functions: {
      invoke(name, options) {
        calls.push({ name, body: options.body });
        const answer = answers[index] ?? answers[answers.length - 1];
        index += 1;

        if (answer instanceof Error) throw answer;

        return Promise.resolve(answer ?? { data: null, error: null });
      },
    },
  };
}

/** A reply the way supabase-js delivers a 2xx: the body on `data`. */
function replied(body: Readonly<Record<string, unknown>>): FunctionsAnswer {
  return { data: body, error: null };
}

/**
 * A reply the way supabase-js delivers a NON-2xx: an error carrying the
 * `Response` on `context`, and `data` left null.
 *
 * THE SHAPE THAT MATTERS MOST IN THIS FILE. Every refusal this story defines
 * arrives like this, so a module reading only `data` would see all of them as
 * "something went wrong" and none of the codes — which is "try again" rendered
 * over a username that will never be free.
 */
function refused(body: Readonly<Record<string, unknown>>): FunctionsAnswer {
  return { data: null, error: { message: 'non-2xx', context: { json: () => Promise.resolve(body) } } };
}

/**
 * The same refusal carrying a REAL `Response`, which is what supabase-js
 * actually puts on `context`.
 *
 * THE HAND-BUILT STUB ABOVE CANNOT SEE THE DEFECT THIS EXISTS FOR, and that is
 * the whole point of having both. Its `json` is an arrow closure, so it never
 * touches `this` and works detached; `Response.prototype.json` is brand-checked
 * and throws `TypeError: Illegal invocation` the moment it is called off its
 * receiver. A reader that pulled the method off the object and called it bare
 * therefore returned `null` for EVERY refusal in this story — every one of them
 * rendering "try again" over a username that will never be free — while every
 * case built on the closure stayed green.
 *
 * `Response` is a global in the node environment, so this needs no browser and
 * no jsdom (AD-15).
 */
function refusedForReal(body: Readonly<Record<string, unknown>>): FunctionsAnswer {
  return {
    data: null,
    error: {
      message: 'non-2xx',
      context: new Response(JSON.stringify(body), {
        status: 409,
        headers: { 'content-type': 'application/json' },
      }),
    },
  };
}

const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

afterEach(() => {
  logged.mockClear();
});

describe('the wire vocabulary is total, so no reply reads as an outage it is not', () => {
  it.each(WIRE_CODES)('recognises %s', (code) => {
    // EVERY code, and the two SUCCESS ones are here deliberately: they reach
    // this function only if a caller treated a success as a failure, and the
    // fallback is the honest answer to that. What must not happen is a genuine
    // REFUSAL landing on the fallback, which is what the cases below pin.
    expect(typeof memberWriteFailureOf(code)).toBe('string');
  });

  it.each([
    ['NOT_AN_ADMIN', MEMBER_WRITE_REFUSED],
    ['USERNAME_TAKEN', MEMBER_USERNAME_TAKEN],
    ['USERNAME_INVALID', MEMBER_USERNAME_INVALID],
    ['PAYLOAD_INVALID', MEMBER_WRITE_INVALID],
    ['MEMBER_INVALID', MEMBER_WRITE_INVALID],
    ['MEMBER_UNKNOWN', MEMBER_UNKNOWN],
    ['USERNAME_NOT_APPLIED', MEMBER_USERNAME_NOT_APPLIED],
    ['USERNAME_NOT_RESTORED', MEMBER_USERNAME_UNSETTLED],
    ['ACCOUNT_NOT_REMOVED', MEMBER_ACCOUNT_STRANDED],
  ] as const)('maps %s to %s rather than to the fallback', (wire, failure) => {
    // Written out rather than derived, which is the point: a mapping tested by
    // feeding it its own table asserts that a table is a table. These nine are
    // the refusals an admin can act on, and folding any of them into
    // `MEMBER_WRITE_UNAVAILABLE` would render "try again" over something that
    // will never succeed.
    expect(memberWriteFailureOf(wire)).toBe(failure);
  });

  it.each(['ACCESS_UNREADABLE', 'ORGANIZATION_UNKNOWN', 'ACCOUNT_NOT_CREATED', 'OPERATION_FAILED'])(
    'reports %s as a service failure, which is what it is',
    (wire) => {
      expect(memberWriteFailureOf(wire)).toBe(MEMBER_WRITE_UNAVAILABLE);
    },
  );

  it('reports a code this build has never heard of as a service failure', () => {
    // The fallback's own case. A newer function emitting a code this bundle
    // does not know is an ordinary state — a static SPA and a forward-only
    // function are not promoted at the same instant.
    expect(memberWriteFailureOf('SOMETHING_ELSE_ENTIRELY')).toBe(MEMBER_WRITE_UNAVAILABLE);
  });
});

describe('a PostgREST refusal means the same thing on both write paths', () => {
  it.each([
    ['42501', MEMBER_WRITE_REFUSED],
    ['23502', MEMBER_WRITE_INVALID],
    ['23514', MEMBER_WRITE_INVALID],
    // `22003` is `numeric_value_out_of_range` — a leave allowance past what a
    // `smallint` holds. Named by neither mapping before, so it fell through to
    // "try again" and invited pressing Save on a write refused every time.
    ['22003', MEMBER_WRITE_INVALID],
    // NAMED BY NOTHING, and mapped by CLASS: `22001` is a value too long for
    // its column, which is still a value on the form.
    ['22001', MEMBER_WRITE_INVALID],
    // Class 40 is a serialization failure — the service, not the person.
    ['40001', MEMBER_WRITE_UNAVAILABLE],
  ] as const)('maps SQLSTATE %s to %s', (code, failure) => {
    expect(editFailureOf({ code })).toBe(failure);
  });

  it('never claims a username is taken on the path that does not write one', () => {
    // `saveMember`'s update writes `name`, `email`, `role` and
    // `leave_allowance_days` and NEVER `username`, so "Ovo korisničko ime već
    // postoji" is a sentence this path cannot honestly say — it could only
    // misdirect an admin to a field that was not involved. The FUNCTION keeps
    // its own `23505` case, because `updateUserById` is the write that moves
    // the column.
    expect(editFailureOf({ code: '23505' })).not.toBe(MEMBER_USERNAME_TAKEN);
    expect(editFailureOf({ code: '23505' })).toBe(MEMBER_WRITE_INVALID);
  });

  it('recognises the zero-admins refusal in details as well as in message', () => {
    // PostgREST does not promise which field a raised message lands in —
    // `refuse_organization_with_no_admin` puts the code in MESSAGE and the
    // organization in DETAIL, and a guard reading one field stops working the
    // day the other carries it. Silently: demoting the last administrator would
    // then read as "correct a value" with no value on the form to correct.
    expect(editFailureOf({ code: '23514', details: 'ORGANIZATION_WOULD_HAVE_NO_ADMIN' })).toBe(
      ORGANIZATION_WOULD_HAVE_NO_ADMIN,
    );
  });

  it('reports a not-null refusal as "correct a value" rather than "try again"', () => {
    // THE PAIRING THE FUNCTION MAKES TOO. `23502` is a field the form left
    // empty; inviting a retry would have somebody press Save four more times on
    // a write that is refused every time. The two paths have to agree, or the
    // same mistake reads as two different problems depending on whether the
    // username happened to change in the same edit.
    expect(memberWriteMessageKey(editFailureOf({ code: '23502' }))).toBe(
      memberWriteMessageKey(memberWriteFailureOf('MEMBER_INVALID')),
    );
  });

  it('recognises the zero-admins trigger, which arrives as a MESSAGE not a SQLSTATE', () => {
    // `refuse_organization_with_no_admin` (`0002:193-223`) raises
    // `check_violation` with the stable code in MESSAGE, because Postgres
    // accepts only a five-character SQLSTATE there. Read by SQLSTATE alone,
    // demoting the last administrator reads as "correct a value" with no value
    // on the form to correct.
    expect(
      editFailureOf({
        code: '23514',
        message: 'ORGANIZATION_WOULD_HAVE_NO_ADMIN',
      }),
    ).toBe(ORGANIZATION_WOULD_HAVE_NO_ADMIN);
  });

  it('reports an unrecognised SQLSTATE as a service failure', () => {
    expect(editFailureOf({ code: '08006' })).toBe(MEMBER_WRITE_UNAVAILABLE);
    expect(editFailureOf({})).toBe(MEMBER_WRITE_UNAVAILABLE);
  });
});

/**
 * Every team refusal `teamFailureOf` can name, each reached from the answer and
 * the history that produces it (story 1.7b).
 */
function teamFailuresReached(): MemberWriteFailure[] {
  const a = { id: 'team-a', name: 'Alfa' };
  const b = { id: 'team-b', name: 'Beta' };
  const teams = [
    { ...a, archived: false },
    { ...b, archived: false },
    { id: 'team-old', name: 'Stara', archived: true },
  ];
  const onA = member({ teamVersions: [{ team: a, effectiveFrom: '2026-09-01' }] });
  const onAToday = member({ teamVersions: [{ team: a, effectiveFrom: TODAY }] });
  const scheduled = member({
    teamVersions: [
      { team: a, effectiveFrom: '2026-09-01' },
      { team: b, effectiveFrom: '2026-10-01' },
    ],
  });
  const on = (target: MemberListRow) => ({ member: target, teams, today: TODAY });

  return [
    teamFailureOf({ code: '42501' }, TEAM_MOVE, '2026-09-22', b.id, on(onA)),
    teamFailureOf({ code: '23505' }, TEAM_MOVE, TODAY, b.id, on(onA)),
    teamFailureOf({ code: '42501' }, TEAM_MOVE, '2026-09-25', a.id, on(scheduled)),
    teamFailureOf({ code: '42501' }, TEAM_MOVE, TODAY, a.id, on(onA)),
    teamFailureOf({ code: '42501' }, TEAM_MOVE, '2026-10-05', b.id, on(scheduled)),
    teamFailureOf(null, WITHDRAW, TODAY, null, on(onAToday)),
    teamFailureOf({ code: '42501' }, TEAM_MOVE, TODAY, 'team-old', on(onA)),
    teamFailureOf(null, WITHDRAW, '2026-10-01', null, on(scheduled)),
  ];
}

describe('every failure becomes exactly one message, and no two share one', () => {
  const EVERY_FAILURE: readonly MemberWriteFailure[] = [
    MEMBER_WRITE_REFUSED,
    MEMBER_WRITE_INVALID,
    MEMBER_USERNAME_TAKEN,
    MEMBER_USERNAME_INVALID,
    MEMBER_UNKNOWN,
    MEMBER_USERNAME_NOT_APPLIED,
    MEMBER_USERNAME_UNSETTLED,
    MEMBER_PASSWORD_NOT_APPLIED,
    MEMBER_ACCOUNT_STRANDED,
    ORGANIZATION_WOULD_HAVE_NO_ADMIN,
    MEMBER_STATUS_IN_PAST,
    MEMBER_STATUS_SELF,
    MEMBER_STATUS_DATE_TAKEN,
    MEMBER_STATUS_OUT_OF_ORDER,
    MEMBER_STATUS_UNCHANGED,
    MEMBER_STATUS_IN_EFFECT,
    MEMBER_STATUS_STALE,
    MEMBER_TEAM_IN_PAST,
    MEMBER_TEAM_DATE_TAKEN,
    MEMBER_TEAM_OUT_OF_ORDER,
    MEMBER_TEAM_UNCHANGED,
    MEMBER_TEAM_SCHEDULED,
    MEMBER_TEAM_IN_EFFECT,
    MEMBER_TEAM_ARCHIVED,
    MEMBER_TEAM_STALE,
    MEMBER_WRITE_UNAVAILABLE,
  ];

  it('holds every failure but the one whose message belongs to the LIST', () => {
    // WHAT THE `never` AT `wire.ts`'s EXHAUSTIVENESS CHECK CANNOT SAY. It forces
    // a branch to EXIST for each failure and says nothing about which key that
    // branch returns — so a code omitted from the list below is a code whose
    // message is observed by neither the distinctness check nor the prefix
    // sweep, and pointing it at `ljudi.form.error.unavailable` leaves this file
    // and `prijava.test.ts` completely green. That is the "collapse into the
    // service-failure fallback" every one of those three files argues must
    // never happen, and it went unnoticed for exactly one story — the list was
    // hand-written and the reset's code was simply not added to it.
    //
    // DERIVED FROM BOTH PRODUCERS rather than counted, so the next failure is
    // added here by a failing test rather than by somebody remembering. Both,
    // because a failure reaches this surface two ways: as a CODE off the
    // function (`memberWriteFailureOf`) and as a SQLSTATE or a raised message
    // off PostgREST (`editFailureOf`) — and `ORGANIZATION_WOULD_HAVE_NO_ADMIN`
    // arrives only the second way, so a derivation over `WIRE_CODES` alone
    // would report it as one this list should not hold.
    //
    // `MEMBER_READ_REFUSED` is the ONE deliberate absence: its message is the
    // LIST's own refusal, `ljudi.error.refused`, reused rather than reworded
    // because `/ljudi/$id` is reachable by URL — so it is the one failure the
    // prefix sweep below would rightly refuse.
    // STORY 1.6 IS THE THIRD PRODUCER: a refused status write, read by
    // `statusFailureOf` against what was sent. Its SEVEN codes — a past date,
    // the caller's own row, a date already taken, a date before the latest
    // version, a change that changes nothing, a cancellation of a change in
    // effect, and a list behind the database — are reached only that way.
    const context = statusContext();
    const scheduledOut = statusContext(
      member({ statusVersions: [{ active: false, effectiveFrom: '2026-09-30' }] }),
    );
    const outToday = statusContext(
      member({ statusVersions: [{ active: false, effectiveFrom: TODAY }] }),
    );
    const mapped = new Set<MemberWriteFailure>([
      ...WIRE_CODES.map((code) => memberWriteFailureOf(code)),
      editFailureOf({ message: ORGANIZATION_WOULD_HAVE_NO_ADMIN }),
      statusFailureOf({ code: '42501' }, DEACTIVATE, '2026-09-22', context),
      statusFailureOf({ code: '42501' }, DEACTIVATE, TODAY, {
        ...context,
        callerAuthUserId: context.member.authUserId,
      }),
      statusFailureOf({ code: '23505' }, DEACTIVATE, TODAY, context),
      statusFailureOf({ code: '42501' }, REACTIVATE, '2026-09-25', scheduledOut),
      statusFailureOf({ code: '42501' }, REACTIVATE, TODAY, context),
      statusFailureOf(null, WITHDRAW, TODAY, outToday),
      statusFailureOf(null, WITHDRAW, '2026-10-01', scheduledOut),
      // STORY 1.7b IS THE FOURTH: a refused team write, read by
      // `teamFailureOf` against what was sent. Its EIGHT codes are reached only
      // that way.
      ...teamFailuresReached(),
    ]);

    mapped.delete(MEMBER_READ_REFUSED);

    expect([...mapped].sort(), 'a failure this surface can reach is swept by nothing').toEqual(
      [...EVERY_FAILURE].sort(),
    );
  });

  it('gives each of the eighteen its own key', () => {
    // A MAPPING RATHER THAN A LIST, and distinctness is the claim: two codes
    // sharing a message is two different things to do next collapsed into one,
    // which is the cost `@/organization/messages` argues about at length.
    const keys = EVERY_FAILURE.map((failure) => memberWriteMessageKey(failure));

    expect(new Set(keys).size).toBe(EVERY_FAILURE.length);
  });

  it('never tells an administrator they need administrator rights', () => {
    // Both screens are reachable only through a guard that has already read
    // this session's level and found it to be an administrator's, so
    // `organization.error.refused`'s wording would be false on the one path
    // that reaches them.
    // The team refusals (story 1.7b) live under `smjene.membership.error.*`,
    // the one namespace whose messages may say the Team, and are held to the
    // same rule.
    for (const failure of EVERY_FAILURE) {
      expect(memberWriteMessageKey(failure)).toMatch(
        /^(ljudi\.form\.error\.|smjene\.membership\.error\.)/,
      );
    }
  });

  it('says one thing when nothing was written and two when something was', () => {
    // THE PARTIAL SAVE. The four ordinary fields are written before the username
    // moves, so a refused rename leaves them genuinely in the database — and a
    // flat failure is not wrong about the username while being silent about the
    // rest. The admin's next move is to reopen the form, which shows them the
    // new values with nothing explaining why the username is not among them.
    expect(memberWriteMessageKeys({ code: MEMBER_USERNAME_TAKEN, saved: false })).toEqual([
      memberWriteMessageKey(MEMBER_USERNAME_TAKEN),
    ]);
    expect(memberWriteMessageKeys({ code: MEMBER_USERNAME_TAKEN, saved: true })).toEqual([
      PARTIAL_SAVE_KEY,
      memberWriteMessageKey(MEMBER_USERNAME_TAKEN),
    ]);
  });

  it('puts the half that landed first, so the sentence reads in that order', () => {
    // Order is content here: "the rest was saved, the username was not" is a
    // report; the reverse reads as a failure with an excuse after it.
    expect(memberWriteMessageKeys({ code: MEMBER_WRITE_UNAVAILABLE, saved: true })[0]).toBe(
      PARTIAL_SAVE_KEY,
    );
    expect(MESSAGE_SEPARATOR).toBe(' ');
  });
});

describe('what the form collected, as the database stores it', () => {
  it('stores an emptied address as null rather than as an empty string', () => {
    // `members.email` is nullable by requirement (`0002:135`). An empty string
    // is not an address, and storing one would make a member "have" an email
    // every later read treats as present — the address column on the list would
    // render a blank cell that is not the same thing as no address at all.
    expect(storedEmail('')).toBeNull();
    expect(storedEmail('   ')).toBeNull();
    expect(storedEmail('  ana@dvd.hr ')).toBe('ana@dvd.hr');
  });

  it('opens a new member at the level that grants the least', () => {
    // A default that fell out of array order would be `MEMBER_ROLES[0]`, which
    // is the ADMINISTERING level — and an admin issuing several hundred
    // accounts in a sitting leaves most of them on whatever the control opened
    // at. That is the failure nobody notices, because every screen works.
    expect(DEFAULT_MEMBER_ROLE).toBe('member_role');
    expect(DEFAULT_MEMBER_ROLE).not.toBe('admin');
  });

  it('narrows a select value with a guard, and falls back to the lesser level', () => {
    expect(chosenRole('admin')).toBe('admin');
    expect(chosenRole('member_role')).toBe('member_role');
    // A value outside the vocabulary — a stale option after a deploy, an
    // extension rewriting the control — must not cast through into
    // `members.role`, where `0002:140`'s check refuses it with a message about
    // a constraint. Falling back grants LESS, which is the harmless direction.
    expect(chosenRole('supervisor')).toBe(DEFAULT_MEMBER_ROLE);
    expect(chosenRole('')).toBe(DEFAULT_MEMBER_ROLE);
  });

  it('reports a field holding no whole number as holding nothing', () => {
    expect(enteredAllowance('20')).toBe(20);
    expect(enteredAllowance(' 0 ')).toBe(0);
    // `Number('')` is 0, which would silently write a zero-day allowance for an
    // empty field — a policy nobody chose, which `0002:145` refuses to default
    // for exactly this reason.
    expect(enteredAllowance('')).toBeNull();
    expect(enteredAllowance('   ')).toBeNull();
    expect(enteredAllowance('twenty')).toBeNull();
    expect(enteredAllowance('-1')).toBeNull();
    expect(enteredAllowance('20.5')).toBeNull();
    // ABOVE WHAT THE COLUMN HOLDS. `leave_allowance_days` is a `smallint`
    // (`0002:145`), so one past the ceiling is `22003` — a refusal about a
    // storage type naming nothing an admin can act on. Both sides of the bound,
    // because `>=` and `>` are one character apart and one of them refuses a
    // legal value.
    expect(enteredAllowance(String(LEAVE_ALLOWANCE_MAX))).toBe(LEAVE_ALLOWANCE_MAX);
    expect(enteredAllowance(String(LEAVE_ALLOWANCE_MAX + 1))).toBeNull();
  });

  it('does not treat a recased or padded username as a rename', () => {
    // `0007`'s unique index is case-insensitive and the address builder
    // lowercases, so `Ana.Kovac` and `ana.kovac` are ONE identity. Treating the
    // difference as a rename would reach GoTrue with the address the account
    // already holds — and would touch the secret-key boundary for an edit that
    // changes nothing.
    expect(usernameChanged('ana.kovac', 'Ana.Kovac')).toBe(false);
    expect(usernameChanged('ana.kovac', '  ana.kovac  ')).toBe(false);
    expect(usernameChanged('ana.kovac', 'ana.kovacic')).toBe(true);
  });
});

describe('the reply code is read from wherever supabase-js put it', () => {
  it('reads it off data on a 2xx', async () => {
    expect(await replyCodeOf(replied({ code: USERNAME_CHANGED }))).toBe(USERNAME_CHANGED);
  });

  it('reads it off the response hidden on the error context, which is every refusal', async () => {
    // THE CASE A MODULE READING ONLY `data` GETS WRONG, and it gets every
    // refusal wrong at once: supabase-js reports a non-2xx as an ERROR with the
    // `Response` on `context` and leaves `data` null.
    expect(await replyCodeOf(refused({ code: 'USERNAME_TAKEN' }))).toBe('USERNAME_TAKEN');
  });

  it('reads it off a REAL Response, which is what supabase-js actually hands over', async () => {
    // THE CASE THE CLOSURE STUB STRUCTURALLY CANNOT MAKE. `Response.prototype.json`
    // is brand-checked: pulled off the object and called bare it throws
    // `TypeError: Illegal invocation`, which a `catch` around the read swallows
    // into `null` — so every refusal this story defines collapsed into "the
    // service is unavailable, try again", in the browser only, with the whole
    // suite green because the stub's `json` is an arrow that never touches
    // `this`.
    expect(await replyCodeOf(refusedForReal({ code: 'USERNAME_TAKEN' }))).toBe('USERNAME_TAKEN');
  });

  it('reports no code where there is none, rather than inventing one', async () => {
    expect(await replyCodeOf({ data: null, error: null })).toBeNull();
    expect(await replyCodeOf({ data: 'not an object', error: null })).toBeNull();
    expect(await replyCodeOf({ data: null, error: { message: 'network' } })).toBeNull();
    expect(await replyCodeOf({ data: { code: 7 }, error: null })).toBeNull();
  });

  it('survives a body that is not JSON at all', async () => {
    // A proxy, a gateway or a crashed runtime answers HTML. Reading it throws
    // inside a function whose whole contract is that it returns a code.
    const answer: FunctionsAnswer = {
      data: null,
      error: { context: { json: () => Promise.reject(new Error('not json')) } },
    };

    expect(await replyCodeOf(answer)).toBeNull();
  });
});

describe('a rename goes through the privileged boundary and reports what it did', () => {
  it('calls the one function, by name, with the operation and the member', async () => {
    const { functions, calls } = functionsThat(replied({ code: USERNAME_CHANGED }));

    expect(await renameMember(functions, 'member-1', 'ana.kovacic')).toEqual({ ok: true });
    expect(calls).toEqual([
      {
        name: MEMBER_WRITE_FUNCTION,
        body: { operation: 'updateUserById', memberId: 'member-1', username: 'ana.kovacic' },
      },
    ]);
  });

  it('treats any reply that is not the success gate as a failure', async () => {
    // THE GATE IS THE VALUE, and this is the case the contract test in
    // `test/admin-auth-boundary.test.ts` binds to the function's own constant:
    // renaming the value on one side only reports a successful rename as a
    // failure with both suites green.
    const { functions } = functionsThat(replied({ code: 'SOMETHING_ELSE' }));
    const outcome = await renameMember(functions, 'member-1', 'ana.kovacic');

    expect(outcome).toEqual({
      ok: false,
      refusal: { code: MEMBER_WRITE_UNAVAILABLE, saved: false },
    });
  });

  it.each([
    ['USERNAME_TAKEN', MEMBER_USERNAME_TAKEN],
    ['USERNAME_NOT_APPLIED', MEMBER_USERNAME_NOT_APPLIED],
    ['USERNAME_NOT_RESTORED', MEMBER_USERNAME_UNSETTLED],
    ['NOT_AN_ADMIN', MEMBER_WRITE_REFUSED],
    ['MEMBER_UNKNOWN', MEMBER_UNKNOWN],
  ] as const)('reports a %s refusal as %s', async (wire, failure) => {
    const { functions } = functionsThat(refused({ code: wire }));

    expect(await renameMember(functions, 'member-1', 'ana.kovacic')).toEqual({
      ok: false,
      refusal: { code: failure, saved: false },
    });
  });

  it('logs the code it returns, and not a different one', async () => {
    // A handler that logged one code and returned another is a console that
    // disagrees with the screen, which is worse than no log at all: whoever is
    // debugging searches for the wrong string and concludes the path was never
    // taken.
    const { functions } = functionsThat(refused({ code: 'USERNAME_TAKEN' }));
    const outcome = await renameMember(functions, 'member-1', 'ana.kovacic');

    expect(outcome.ok).toBe(false);
    expect(logged).toHaveBeenCalledWith(
      outcome.ok ? '' : outcome.refusal.code,
      expect.anything(),
    );
  });

  it('reports a seam that rejects rather than letting it escape', async () => {
    const { functions } = functionsThat(new Error('SUPABASE_ENVIRONMENT_MISSING'));

    expect(await renameMember(functions, 'member-1', 'ana.kovacic')).toEqual({
      ok: false,
      refusal: { code: MEMBER_WRITE_UNAVAILABLE, saved: false },
    });
    expect(logged).toHaveBeenCalled();
  });

  it('reads a refusal delivered on a REAL Response, not only on a closure stub', async () => {
    // See `refusedForReal`. Without this the rename path reported every refusal
    // as a service failure in the browser and nowhere else.
    const { functions } = functionsThat(refusedForReal({ code: 'USERNAME_TAKEN' }));

    expect(await renameMember(functions, 'member-1', 'ana.kovacic')).toEqual({
      ok: false,
      refusal: { code: MEMBER_USERNAME_TAKEN, saved: false },
    });
  });
});

describe('an edit reaches the privileged function only when the identity moves', () => {
  it('writes the four ordinary fields through PostgREST and calls nothing else', async () => {
    // THE STORY'S CENTRAL BRANCH, and it is asserted by COUNTING WHAT THE STUB
    // WAS ASKED. `members_update_by_own_active_admin` (`0003:331-351`) already
    // admits an active admin to every column of every row in their
    // organization, so routing an ordinary edit through the secret-key boundary
    // would widen that boundary's blast radius to every edit in the
    // application — and a source-level check passes on a screen that calls the
    // function every time.
    const { table, calls } = tableThat({ data: [{ id: 'member-1' }], error: null });
    const { functions, calls: invoked } = functionsThat(replied({ code: USERNAME_CHANGED }));

    const outcome = await saveMember(
      table,
      functions,
      member(),
      edits({ name: 'Ana Kovač-Babić', leaveAllowanceDays: 25, role: 'admin' }),
    );

    expect(outcome).toEqual({ ok: true });
    expect(invoked, 'an ordinary edit reached the privileged boundary').toEqual([]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.values).toEqual({
      name: 'Ana Kovač-Babić',
      email: null,
      role: 'admin',
      leave_allowance_days: 25,
    });
    // THE USERNAME IS NOT IN THE PATCH. Sent here it would move `members`
    // without moving `auth.users.email`, which is the disagreement the whole
    // compensating-write design exists to keep visible.
    expect(Object.keys(calls[0]?.values ?? {})).not.toContain('username');
    expect(calls[0]?.id).toBe('member-1');
    expect(calls[0]?.columns).toBe(MEMBER_EDIT_COLUMNS);
  });

  it('writes the rank in the same PATCH, null for no rank, and leaves it alone when absent', async () => {
    // MEMBER RANK. The empty choice stores `null`; a form with no rank control
    // (the setting off) sends no `fire_rank` at all, so stored ranks survive.
    for (const [fireRank, expected] of [
      ['nco', 'nco'],
      [null, null],
    ] as const) {
      const { table, calls } = tableThat({ data: [{ id: 'member-1' }], error: null });
      const { functions } = functionsThat(replied({ code: USERNAME_CHANGED }));

      await saveMember(table, functions, member(), edits({ fireRank }));

      expect(calls).toHaveLength(1);
      expect(Object.keys(calls[0]?.values ?? {})).toContain('fire_rank');
      expect(calls[0]?.values['fire_rank']).toBe(expected);
    }

    const { table, calls } = tableThat({ data: [{ id: 'member-1' }], error: null });
    const { functions } = functionsThat(replied({ code: USERNAME_CHANGED }));

    await saveMember(table, functions, member(), edits());

    expect(Object.keys(calls[0]?.values ?? {})).not.toContain('fire_rank');
  });

  it('reports a rank the check constraint refuses as a value to correct', async () => {
    // A direct write of a code outside `0014`'s list is refused by the
    // database with 23514; nothing is written, and it reads as INVALID.
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { table } = tableThat({
      data: null,
      error: { code: '23514', message: 'members_fire_rank_check' },
    });
    const { functions } = functionsThat(replied({ code: USERNAME_CHANGED }));

    expect(await saveMember(table, functions, member(), edits({ fireRank: 'general' }))).toEqual({
      ok: false,
      refusal: { code: MEMBER_WRITE_INVALID, saved: false },
    });
  });

  it('calls the function once when the username moves, after the fields landed', async () => {
    const { table, calls } = tableThat({ data: [{ id: 'member-1' }], error: null });
    const { functions, calls: invoked } = functionsThat(replied({ code: USERNAME_CHANGED }));

    expect(
      await saveMember(table, functions, member(), edits({ username: 'ana.kovacic' })),
    ).toEqual({ ok: true });
    expect(calls, 'the ordinary fields were not written first').toHaveLength(1);
    expect(invoked).toHaveLength(1);
    expect(invoked[0]?.body).toMatchObject({ username: 'ana.kovacic', memberId: 'member-1' });
  });

  it('reports a PARTIAL SAVE when the fields landed and the rename was refused', async () => {
    // Human decision 2026-09-18. The four values really are in the database and
    // the sign-in identity really is unchanged; a flat failure is silent about
    // the first half, and reopening the form then shows the new values with
    // nothing explaining why the username is not among them.
    const { table } = tableThat({ data: [{ id: 'member-1' }], error: null });
    const { functions } = functionsThat(refused({ code: 'USERNAME_TAKEN' }));

    expect(
      await saveMember(table, functions, member(), edits({ username: 'ivan.maric' })),
    ).toEqual({ ok: false, refusal: { code: MEMBER_USERNAME_TAKEN, saved: true } });
  });

  it('reports NOTHING saved when the ordinary write itself was refused', async () => {
    // The other polarity, and the one that makes `saved` a fact rather than a
    // constant: a refusal before the PostgREST write landed must not claim four
    // fields reached the database.
    const { table } = tableThat({ data: [], error: null });
    const { functions, calls: invoked } = functionsThat(replied({ code: USERNAME_CHANGED }));

    expect(
      await saveMember(table, functions, member(), edits({ username: 'ivan.maric' })),
    ).toEqual({ ok: false, refusal: { code: MEMBER_WRITE_REFUSED, saved: false } });
    expect(invoked, 'the rename ran over a write that was refused').toEqual([]);
  });

  it('reads zero rows as the policy refusing silently, which is what it is', async () => {
    // `members_update_by_own_active_admin` fails USING: the statement matches
    // nothing and raises nothing, so zero rows is the only signal there is.
    const { table } = tableThat({ data: [], error: null });
    const { functions } = functionsThat(replied({ code: USERNAME_CHANGED }));

    expect(await saveMember(table, functions, member(), edits())).toEqual({
      ok: false,
      refusal: { code: MEMBER_WRITE_REFUSED, saved: false },
    });
  });

  it('maps a refused write through the same mapping the direct path uses', async () => {
    const { table } = tableThat({
      data: null,
      error: { code: '23514', message: 'ORGANIZATION_WOULD_HAVE_NO_ADMIN' },
    });
    const { functions } = functionsThat(replied({ code: USERNAME_CHANGED }));

    expect(
      await saveMember(table, functions, member(), edits({ role: 'member_role' })),
    ).toEqual({
      ok: false,
      refusal: { code: ORGANIZATION_WOULD_HAVE_NO_ADMIN, saved: false },
    });
  });

  it('reports a transport that rejects rather than letting it escape', async () => {
    const { table } = tableThat(new Error('SUPABASE_ENVIRONMENT_MISSING'));
    const { functions } = functionsThat(replied({ code: USERNAME_CHANGED }));

    expect(await saveMember(table, functions, member(), edits())).toEqual({
      ok: false,
      refusal: { code: MEMBER_WRITE_UNAVAILABLE, saved: false },
    });
  });
});

describe('creating a member issues one credential and reports it once', () => {
  const creation = {
    organizationId: 'organization-1',
    name: 'Marko Novak',
    username: 'marko.novak',
    email: null,
    role: 'member_role' as const,
    leaveAllowanceDays: 20,
  };

  it('sends the whole payload to the one function, by name', async () => {
    const { functions, calls } = functionsThat(
      replied({ code: MEMBER_CREATED, username: 'marko.novak', password: 'Xy7kPq2mRt4vLn8s' }),
    );

    const outcome = await createMember(functions, creation);

    expect(outcome).toEqual({
      ok: true,
      credential: { username: 'marko.novak', password: 'Xy7kPq2mRt4vLn8s' },
    });
    expect(calls).toEqual([
      {
        name: MEMBER_WRITE_FUNCTION,
        body: {
          operation: 'createUser',
          organizationId: 'organization-1',
          name: 'Marko Novak',
          username: 'marko.novak',
          email: null,
          role: 'member_role',
          leaveAllowanceDays: 20,
        },
      },
    ]);
    expect(Object.keys(calls[0]?.body ?? {}), 'an absent rank reached the payload').not.toContain(
      'fireRank',
    );
  });

  it('carries the rank in the one create payload, null included', async () => {
    // MEMBER RANK. The row is inserted with its rank in one insert.
    for (const fireRank of ['nco', null] as const) {
      const { functions, calls } = functionsThat(
        replied({ code: MEMBER_CREATED, username: 'marko.novak', password: 'Xy7kPq2mRt4vLn8s' }),
      );

      await createMember(functions, { ...creation, fireRank });

      expect(calls[0]?.body).toMatchObject({ operation: 'createUser', fireRank });
    }
  });

  it('refuses a success that carries no credential, because nobody could sign in', async () => {
    // The account exists either way, and no later read can recover the
    // password — so a blank panel would be the worst of both: an account nobody
    // can use and a screen claiming it was issued.
    const { functions } = functionsThat(replied({ code: MEMBER_CREATED, username: 'marko.novak' }));

    expect(await createMember(functions, creation)).toEqual({
      ok: false,
      refusal: { code: MEMBER_WRITE_UNAVAILABLE, saved: false },
    });
  });

  it.each([
    ['USERNAME_TAKEN', MEMBER_USERNAME_TAKEN],
    ['USERNAME_INVALID', MEMBER_USERNAME_INVALID],
    ['NOT_AN_ADMIN', MEMBER_WRITE_REFUSED],
    ['MEMBER_INVALID', MEMBER_WRITE_INVALID],
    ['ACCOUNT_NOT_REMOVED', MEMBER_ACCOUNT_STRANDED],
    ['ACCOUNT_NOT_CREATED', MEMBER_WRITE_UNAVAILABLE],
  ] as const)('reports a %s refusal as %s', async (wire, failure) => {
    const { functions } = functionsThat(refused({ code: wire }));

    expect(await createMember(functions, creation)).toEqual({
      ok: false,
      refusal: { code: failure, saved: false },
    });
  });

  it('never logs the reply body, which is where the credential is', async () => {
    const { functions } = functionsThat(replied({ code: MEMBER_CREATED, username: 'marko.novak' }));

    await createMember(functions, creation);

    for (const call of logged.mock.calls) {
      expect(JSON.stringify(call)).not.toContain('marko.novak');
    }
  });

  it('reports a seam that rejects rather than letting it escape', async () => {
    const { functions } = functionsThat(new Error('SUPABASE_ENVIRONMENT_MISSING'));

    expect(await createMember(functions, creation)).toEqual({
      ok: false,
      refusal: { code: MEMBER_WRITE_UNAVAILABLE, saved: false },
    });
  });

  it('reads a refusal delivered on a REAL Response, not only on a closure stub', async () => {
    // The create path reads the WHOLE body rather than just the code, so it has
    // its own reader and needed its own case: both were detaching the method.
    const { functions } = functionsThat(refusedForReal({ code: 'USERNAME_TAKEN' }));

    expect(await createMember(functions, creation)).toEqual({
      ok: false,
      refusal: { code: MEMBER_USERNAME_TAKEN, saved: false },
    });
  });
});

describe('a reset issues one credential, and a reply without one is not a success', () => {
  it('calls the one function, by name, with the operation spelled out and the member', async () => {
    // THE OPERATION NAME AS A LITERAL, the way the two siblings above pin
    // theirs. Asserted against `RESET_PASSWORD_OPERATION` this compares the
    // constant to itself and passes on any spelling at all — and a misspelt one
    // arrives at the transport as an unknown operation, falls through to
    // `MEMBER_WRITE_UNAVAILABLE`, and shows "try again" for ever to an admin
    // whose member has no other recovery route.
    const { functions, calls } = functionsThat(
      replied({ code: PASSWORD_RESET, password: 'Xy7kPq2mRt4vLn8s' }),
    );

    expect(await resetPassword(functions, 'member-1')).toEqual({
      ok: true,
      credential: { password: 'Xy7kPq2mRt4vLn8s' },
    });
    expect(calls).toEqual([
      { name: MEMBER_WRITE_FUNCTION, body: { operation: 'resetPassword', memberId: 'member-1' } },
    ]);
  });

  it('sends the member id and nothing else, because a reset chooses nothing', async () => {
    // No password, no username, no organization. An admin-typed password is
    // forbidden (the credential is generated in `admin-auth`), and an
    // organization in the body is a caller choosing which tenant to act in.
    const { functions, calls } = functionsThat(
      replied({ code: PASSWORD_RESET, password: 'Xy7kPq2mRt4vLn8s' }),
    );

    await resetPassword(functions, 'member-1');

    expect(Object.keys(calls[0]?.body ?? {}).sort()).toEqual(['memberId', 'operation']);
  });

  it('treats any reply that is not the success gate as a failure', async () => {
    const { functions } = functionsThat(replied({ code: 'SOMETHING_ELSE', password: 'x' }));

    expect(await resetPassword(functions, 'member-1')).toEqual({
      ok: false,
      refusal: { code: MEMBER_WRITE_UNAVAILABLE, saved: false },
    });
  });

  it.each([
    ['absent', { code: PASSWORD_RESET }],
    ['empty', { code: PASSWORD_RESET, password: '' }],
    ['not a string', { code: PASSWORD_RESET, password: 42 }],
    ['null', { code: PASSWORD_RESET, password: null }],
  ])('refuses a success whose password is %s', async (_label, body) => {
    // THE ACCOUNT'S CREDENTIAL HAS ALREADY CHANGED when this reply arrives, so
    // a panel rendering a blank line is the worst outcome this surface has: the
    // member is locked out of the one account with no self-service recovery and
    // the admin has been told it worked.
    const { functions } = functionsThat(replied(body));

    expect(await resetPassword(functions, 'member-1')).toEqual({
      ok: false,
      refusal: { code: MEMBER_WRITE_UNAVAILABLE, saved: false },
    });
  });

  it.each([
    ['PASSWORD_NOT_APPLIED', MEMBER_PASSWORD_NOT_APPLIED],
    ['NOT_AN_ADMIN', MEMBER_WRITE_REFUSED],
    ['MEMBER_UNKNOWN', MEMBER_UNKNOWN],
    ['PAYLOAD_INVALID', MEMBER_WRITE_INVALID],
    ['ACCESS_UNREADABLE', MEMBER_WRITE_UNAVAILABLE],
    ['AUTHORIZATION_MISSING', MEMBER_READ_REFUSED],
  ] as const)('reports a %s refusal as %s', async (wire, failure) => {
    const { functions } = functionsThat(refused({ code: wire }));

    expect(await resetPassword(functions, 'member-1')).toEqual({
      ok: false,
      refusal: { code: failure, saved: false },
    });
  });

  it('never reports a partial save, because a reset writes one store', async () => {
    // There is no `members` row behind a reset, so there is no state in which
    // two stores disagree and nothing honest `saved: true` could mean.
    const { functions } = functionsThat(refused({ code: 'PASSWORD_NOT_APPLIED' }));
    const outcome = await resetPassword(functions, 'member-1');

    expect(outcome.ok).toBe(false);
    expect(outcome.ok ? true : outcome.refusal.saved).toBe(false);
  });

  it('logs the code it returns, and not a different one', async () => {
    const { functions } = functionsThat(refused({ code: 'PASSWORD_NOT_APPLIED' }));
    const outcome = await resetPassword(functions, 'member-1');

    expect(outcome.ok).toBe(false);
    expect(logged).toHaveBeenCalledWith(outcome.ok ? '' : outcome.refusal.code, expect.anything());
  });

  it('never logs the reply body, which is where the credential is', async () => {
    const { functions } = functionsThat(
      replied({ code: PASSWORD_RESET, password: 'Xy7kPq2mRt4vLn8s' }),
    );

    await resetPassword(functions, 'member-1');

    for (const call of logged.mock.calls) {
      expect(JSON.stringify(call)).not.toContain('Xy7kPq2mRt4vLn8s');
    }
  });

  it('reports a seam that rejects rather than letting it escape', async () => {
    const { functions } = functionsThat(new Error('SUPABASE_ENVIRONMENT_MISSING'));

    expect(await resetPassword(functions, 'member-1')).toEqual({
      ok: false,
      refusal: { code: MEMBER_WRITE_UNAVAILABLE, saved: false },
    });
    expect(logged).toHaveBeenCalled();
  });

  it('reads a refusal delivered on a REAL Response, not only on a closure stub', async () => {
    // This path reads the WHOLE body rather than just the code, so it has its
    // own reader and needs its own case — the brand-checked `Response.json` is
    // invisible to every stub built on an arrow closure.
    const { functions } = functionsThat(refusedForReal({ code: 'PASSWORD_NOT_APPLIED' }));

    expect(await resetPassword(functions, 'member-1')).toEqual({
      ok: false,
      refusal: { code: MEMBER_PASSWORD_NOT_APPLIED, saved: false },
    });
  });
});

describe('the reset has four stages, and the in-flight one is the one that gets lost', () => {
  const credential = { password: 'Xy7kPq2mRt4vLn8s' };

  it('offers a reset when nothing is armed, nothing is in flight and nothing is shown', () => {
    expect(resetStageOf(false, false, null)).toBe(RESET_IDLE);
  });

  it('shows the confirmation once the offer is armed', () => {
    expect(resetStageOf(true, false, null)).toBe(RESET_ARMED);
  });

  it('KEEPS THE CONFIRMATION while the request is outstanding, rather than the offer', () => {
    // THE DEFECT THIS EXISTS FOR. A three-stage model has to clear `armed`
    // before awaiting, which unmounts the confirm pair and renders the plain,
    // ENABLED offer for the whole request — so the pending flag is read by no
    // control at all and a second press starts a second reset.
    expect(resetStageOf(true, true, null)).toBe(RESET_BUSY);
    expect(resetStageOf(true, true, null)).not.toBe(RESET_IDLE);
  });

  it('is busy even if the armed flag was cleared underneath it', () => {
    // The other half of the same claim: the stage may not fall back to the
    // offer because somebody disarmed early. `pending` decides.
    expect(resetStageOf(false, true, null)).toBe(RESET_BUSY);
  });

  it.each([
    ['nothing else is happening', false, false],
    ['the offer is still armed', true, false],
    ['a request is still in flight', true, true],
  ])('shows the credential when %s, because it is the only copy', (_label, armed, pending) => {
    // IT OUTRANKS EVERY OTHER CONSIDERATION. Everything else on that screen can
    // be recovered by looking again; the password cannot.
    expect(resetStageOf(armed, pending, credential)).toBe(RESET_SHOWN);
  });

  it('returns to the offer only when the credential is dismissed', () => {
    // The ONLY transition out of `shown`, and until it happens a second reset
    // is impossible — which is what stops one credential overwriting another
    // before anybody has read it.
    expect(resetStageOf(false, false, credential)).toBe(RESET_SHOWN);
    expect(resetStageOf(false, false, null)).toBe(RESET_IDLE);
  });

  it('names four distinct stages, so none of them is a synonym for another', () => {
    // Non-vacuity: two constants sharing a value would make the cases above
    // pass while the screen could not tell the states apart.
    expect(new Set([RESET_IDLE, RESET_ARMED, RESET_BUSY, RESET_SHOWN]).size).toBe(4);
  });
});

describe('whether either form may render at all', () => {
  function listState(fields: Partial<MembersSurfaceState> = {}): MembersSurfaceState {
    return { members: null, refusal: null, loading: false, ...fields };
  }

  it('hands over the member the id names', () => {
    const wanted = member({ id: 'member-2', name: 'Petra Babić' });
    const state = listState({ members: [member(), wanted] });

    expect(memberFormRefusalOf(state, 'member-2')).toEqual({
      member: wanted,
      refusal: null,
      loading: false,
    });
  });

  it('reports a still-loading list as loading, with no refusal to render', () => {
    // A SKELETON, never a message: a list that has not answered yet says
    // nothing about whether this member exists.
    expect(memberFormRefusalOf(listState({ loading: true }), 'member-1')).toEqual({
      member: null,
      refusal: null,
      loading: true,
    });
  });

  it('tells a read the database REFUSED apart from one that merely failed', () => {
    // COLLAPSING THE TWO WAS THE DEFECT. `/ljudi/$id` is reachable by URL — a
    // bookmark, a link in a message — so a stale or claim-less session lands
    // here with `MEMBERS_REFUSED`, which is the database declining this session
    // permanently. Reported as "try again" it invites reloading a page that
    // refuses identically for ever; the action that can change the answer is
    // signing in again, which the LIST's own refusal already says.
    expect(memberFormRefusalOf(listState({ refusal: 'MEMBERS_REFUSED' }), 'member-1')).toEqual({
      member: null,
      refusal: MEMBER_READ_REFUSED,
      loading: false,
    });
    expect(memberFormRefusalOf(listState({ refusal: 'MEMBERS_UNAVAILABLE' }), 'member-1')).toEqual({
      member: null,
      refusal: MEMBER_WRITE_UNAVAILABLE,
      loading: false,
    });
    // TWO CODES, TWO MESSAGES, and the refusal's is the list's own rather than
    // any `ljudi.form.error.*`: every one of those is about a WRITE.
    expect(memberWriteMessageKey(MEMBER_READ_REFUSED)).toBe('ljudi.error.refused');
    expect(memberWriteMessageKey(MEMBER_READ_REFUSED)).not.toBe(
      memberWriteMessageKey(MEMBER_WRITE_UNAVAILABLE),
    );
  });

  it('gives an id that reaches nobody its OWN code, not the policy refusal', () => {
    // THE FINDING THIS CLOSES. Collapsed into `MEMBER_WRITE_REFUSED` the screen
    // renders "sign out and sign in again" — an instruction that cannot work —
    // to an administrator whose session is perfectly good and who followed a
    // stale link or a row somebody deleted while they were looking at it.
    const state = listState({ members: [member()] });

    expect(memberFormRefusalOf(state, 'member-404')).toEqual({
      member: null,
      refusal: MEMBER_UNKNOWN,
      loading: false,
    });
    expect(memberWriteMessageKey(MEMBER_UNKNOWN)).not.toBe(
      memberWriteMessageKey(MEMBER_WRITE_REFUSED),
    );
  });

  it('seeds the create form from a settled organization read', () => {
    expect(
      createFormStateOf({
        isPending: false,
        isError: false,
        data: { ok: true, snapshot: { id: 'organization-1' } },
      }),
    ).toEqual({ organizationId: 'organization-1', refusal: null, loading: false });
  });

  it('draws a skeleton while that read is still pending, and no form', () => {
    expect(
      createFormStateOf({ isPending: true, isError: false, data: undefined }),
    ).toEqual({ organizationId: null, refusal: null, loading: true });
  });

  it.each([
    ['the query rejected', { isPending: false, isError: true, data: undefined }],
    ['the read refused', { isPending: false, isError: false, data: { ok: false } }],
  ])('renders a message and NO form when %s', (_label, answer) => {
    // THE CASE A NAIVE VERSION GETS WRONG, and it is the story's own acceptance
    // criterion: gated on "there is no organization id" alone the screen draws
    // a skeleton for ever, indistinguishable from a slow read. Worse still is
    // the version that renders the form anyway — fully usable, completely
    // inert, because Save returns at its own guard.
    expect(createFormStateOf(answer)).toEqual({
      organizationId: null,
      refusal: MEMBER_WRITE_UNAVAILABLE,
      loading: false,
    });
  });
});

describe('what the edit screen raised, and the member it was raised about', () => {
  it('shows it over the member it belongs to', () => {
    expect(raisedForMember({ member: 'member-1', raised: 'x' }, 'member-1')).toBe('x');
  });

  it('shows NOTHING over a different member', () => {
    // ONE COMPONENT INSTANCE SERVES EVERY ROW. Navigating from one member's form
    // to another's changes a route PARAM, not the component, so React state
    // survives the move — and the form itself remounts (`memberFormKey`) while
    // the alert above it did not. A refusal raised on Ana therefore stood over
    // Marko's form, naming a problem with a record nobody was looking at; a
    // CONFIRMATION doing the same is worse, because "saved" over a form that
    // was never submitted is a lie the admin has no reason to doubt.
    expect(raisedForMember({ member: 'member-1', raised: 'x' }, 'member-2')).toBeNull();
    expect(raisedForMember(null, 'member-1')).toBeNull();
  });

  it('is not satisfied by any member, which a dropped comparison would be', () => {
    // The mutation this refuses: returning `raised.raised` unconditionally.
    const raised = { member: 'member-1', raised: true } as const;

    expect([raisedForMember(raised, 'member-1'), raisedForMember(raised, 'member-2')]).toEqual([
      true,
      null,
    ]);
  });
});

describe('the edit form remounts when its row changes', () => {
  it.each(['name', 'username', 'email', 'role', 'leaveAllowanceDays', 'fireRank'] as const)(
    'changes the form identity when %s changes',
    (field) => {
      // EVERY WRITTEN FIELD IS IN THE FINGERPRINT. Keying on `id` alone never
      // changes for a row being edited in place — which is the only case that
      // matters — so the fields would keep showing what the row held when the
      // screen opened, and `Odustani` would snap them back to that.
      const before = member();
      const after = member(
        field === 'leaveAllowanceDays'
          ? { leaveAllowanceDays: 25 }
          : ({ [field]: field === 'role' ? 'admin' : 'changed' } as Partial<MemberListRow>),
      );

      expect(memberFormKey(before)).not.toBe(memberFormKey(after));
    },
  );

  it('keeps the same identity for the same row', () => {
    expect(memberFormKey(member())).toBe(memberFormKey(member()));
  });

  it('treats no address and an emptied one as the same seed, because they are', () => {
    // The form seeds that field with `member.email ?? ''`, so the two produce
    // an identical control — and a key that told them apart would remount the
    // whole form on a refetch that changed nothing anybody can see.
    expect(memberFormKey(member({ email: null }))).toBe(memberFormKey(member({ email: '' })));
  });
});

describe('a status change is one appended version or one cancelled one, judged before and after it is sent (story 1.6)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  type Answer = { error: { code?: string } | null; data?: readonly unknown[] | null };

  /** A status table that answers once and records what it was asked. */
  function statusTable(answer: Answer | Error = { error: null, data: [{}] }): {
    table: MemberStatusTable;
    sent: Readonly<Record<string, unknown>>[];
    deleted: [string, string][][];
  } {
    const sent: Readonly<Record<string, unknown>>[] = [];
    const deleted: [string, string][][] = [];
    const settle = () =>
      answer instanceof Error
        ? Promise.reject(answer)
        : Promise.resolve({ data: answer.data ?? null, error: answer.error });

    return {
      sent,
      deleted,
      table: {
        insert(values) {
          sent.push(values);

          return settle();
        },
        delete() {
          const filters: [string, string][] = [];

          deleted.push(filters);

          return {
            eq(column, value) {
              filters.push([column, value]);

              return {
                eq(second, secondValue) {
                  filters.push([second, secondValue]);

                  return { select: () => settle() };
                },
              };
            },
          };
        },
      },
    };
  }

  const version = (active: boolean, effectiveFrom: string) => ({ active, effectiveFrom });

  it('names the relation 0008 creates', () => {
    expect(MEMBER_STATUS_TABLE).toBe('member_status_versions');
  });

  it('offers deactivation for an active member and reactivation for one inactive today', () => {
    expect(statusOfferOf(member(), CALLER.authUserId, TODAY)).toMatchObject({
      change: DEACTIVATE,
      today: TODAY,
      minimum: TODAY,
      status: { activeToday: true, scheduled: null },
    });
    expect(
      statusOfferOf(
        member({ statusVersions: [version(false, '2026-09-01')] }),
        CALLER.authUserId,
        TODAY,
      ),
    ).toMatchObject({ change: REACTIVATE, minimum: TODAY, status: { since: '2026-09-01' } });
  });

  it('sets the minimum to the day after a latest version dated today', () => {
    // Versions append in date order: a version today leaves tomorrow as the
    // first date anything else may carry.
    expect(
      statusOfferOf(member({ statusVersions: [version(false, TODAY)] }), CALLER.authUserId, TODAY),
    ).toMatchObject({ change: REACTIVATE, minimum: '2026-09-24' });
  });

  it('offers only the cancellation while a change is scheduled, in either direction', () => {
    const outNextWeek = member({ statusVersions: [version(false, '2026-09-30')] });
    const backNextWeek = member({
      statusVersions: [version(false, '2026-09-01'), version(true, '2026-09-30')],
    });

    expect(statusOfferOf(outNextWeek, CALLER.authUserId, TODAY)).toEqual({
      change: WITHDRAW,
      today: TODAY,
      scheduled: version(false, '2026-09-30'),
      status: { activeToday: true, since: null, scheduled: version(false, '2026-09-30') },
    });
    expect(statusOfferOf(backNextWeek, CALLER.authUserId, TODAY)).toMatchObject({
      change: WITHDRAW,
      scheduled: version(true, '2026-09-30'),
      status: { activeToday: false, since: '2026-09-01' },
    });
  });

  it("offers nothing on the caller's own row, or while today or the caller is unknown", () => {
    expect(statusOfferOf(CALLER, CALLER.authUserId, TODAY)).toBeNull();
    expect(
      statusOfferOf(
        { ...CALLER, statusVersions: [version(false, '2026-09-25'), version(true, '2026-09-30')] },
        CALLER.authUserId,
        TODAY,
      ),
    ).toBeNull();
    expect(statusOfferOf(member(), null, TODAY)).toBeNull();
    expect(statusOfferOf(member(), CALLER.authUserId, null)).toBeNull();
  });

  it('sends one insert of the four facts, and active is the opposite of deactivate', async () => {
    const target = member();
    const away = member({ statusVersions: [version(false, TODAY)] });
    const deactivation = statusTable();
    const reactivation = statusTable();

    expect(
      await changeMemberStatus(deactivation.table, DEACTIVATE, TODAY, statusContext(target)),
    ).toEqual({ ok: true });
    expect(
      await changeMemberStatus(reactivation.table, REACTIVATE, '2026-09-30', statusContext(away)),
    ).toEqual({ ok: true });

    expect(deactivation.sent).toEqual([
      {
        organization_id: target.organizationId,
        member_id: target.id,
        active: false,
        effective_from: TODAY,
      },
    ]);
    expect(deactivation.deleted).toEqual([]);
    expect(reactivation.sent[0]).toMatchObject({ active: true, effective_from: '2026-09-30' });
  });

  it('cancels by deleting exactly the scheduled version, and counts zero rows as refused', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const scheduled = member({ statusVersions: [version(false, '2026-09-30')] });
    const cancelled = statusTable();

    expect(
      await changeMemberStatus(cancelled.table, WITHDRAW, '2026-09-30', statusContext(scheduled)),
    ).toEqual({ ok: true });
    expect(cancelled.sent).toEqual([]);
    expect(cancelled.deleted).toEqual([
      [
        ['member_id', scheduled.id],
        ['effective_from', '2026-09-30'],
      ],
    ]);

    // THE DELETE POLICY MATCHED NOTHING: `[]` and no error is a refusal, never
    // a "saved" — and one the list cannot explain, so the list is behind.
    const nothing = statusTable({ error: null, data: [] });

    expect(
      await changeMemberStatus(nothing.table, WITHDRAW, '2026-09-30', statusContext(scheduled)),
    ).toEqual({ ok: false, refusal: { code: MEMBER_STATUS_STALE, saved: false } });
  });

  it('refuses what it can name without sending anything', async () => {
    const outToday = member({ statusVersions: [version(false, TODAY)] });
    const outLater = member({ statusVersions: [version(false, '2026-09-30')] });
    const cases: readonly [StatusChange, string, StatusContext, MemberWriteFailure][] = [
      [DEACTIVATE, '2026-09-22', statusContext(), MEMBER_STATUS_IN_PAST],
      [DEACTIVATE, '', statusContext(), MEMBER_WRITE_INVALID],
      [DEACTIVATE, '23.09.2026', statusContext(), MEMBER_WRITE_INVALID],
      // IMPOSSIBLE, not merely malformed: the one validator refuses it.
      [DEACTIVATE, '2026-02-31', statusContext(), MEMBER_WRITE_INVALID],
      [DEACTIVATE, TODAY, statusContext(CALLER), MEMBER_STATUS_SELF],
      [REACTIVATE, TODAY, statusContext(outToday), MEMBER_STATUS_DATE_TAKEN],
      [REACTIVATE, '2026-09-25', statusContext(outLater), MEMBER_STATUS_OUT_OF_ORDER],
      // REDUNDANT in both directions, against the LATEST state.
      [DEACTIVATE, '2026-10-05', statusContext(outLater), MEMBER_STATUS_UNCHANGED],
      [REACTIVATE, '2026-09-25', statusContext(), MEMBER_STATUS_UNCHANGED],
      // A CANCELLATION of a version in effect, of one that is not the latest,
      // and on the caller's own row.
      [WITHDRAW, TODAY, statusContext(outToday), MEMBER_STATUS_IN_EFFECT],
      // A CANCELLATION NAMING A VERSION THE LIST DOES NOT HOLD AS LATEST is
      // stale data, not a change in effect — both when there is some other
      // latest version and when there is none at all.
      [WITHDRAW, '2026-10-01', statusContext(outLater), MEMBER_STATUS_STALE],
      [WITHDRAW, '2026-10-01', statusContext(), MEMBER_STATUS_STALE],
      [
        WITHDRAW,
        '2026-09-30',
        statusContext({ ...CALLER, statusVersions: [version(true, '2026-09-30')] }),
        MEMBER_STATUS_SELF,
      ],
    ];

    for (const [change, day, context, expected] of cases) {
      const stub = statusTable();

      expect(statusPreflightOf(change, day, context), `${change} ${day}`).toBe(expected);
      expect(await changeMemberStatus(stub.table, change, day, context)).toEqual({
        ok: false,
        refusal: { code: expected, saved: false },
      });
      expect(stub.sent, `${change} ${day} reached the database`).toEqual([]);
      expect(stub.deleted, `${change} ${day} reached the database`).toEqual([]);
    }
    // Today itself is admitted: the policy's comparison is `>=`.
    expect(statusPreflightOf(DEACTIVATE, TODAY, statusContext())).toBeNull();
    expect(statusPreflightOf(WITHDRAW, '2026-09-30', statusContext(outLater))).toBeNull();
  });

  it('names the last-admin refusal only for a change that makes an ADMIN inactive with nobody covering', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const target = member({ id: 'admin-2', authUserId: 'account-admin-2', role: 'admin' });
    // THE CALLER IS OUT FROM NEXT WEEK and a third admin is out today with a
    // reactivation scheduled: neither is active on every date from today.
    const caller = { ...CALLER, statusVersions: [version(false, '2026-09-30')] };
    const returning = member({
      id: 'admin-3',
      authUserId: 'account-admin-3',
      role: 'admin',
      statusVersions: [version(false, '2026-09-01'), version(true, '2026-10-10')],
    });
    const uncovered: StatusContext = {
      member: target,
      members: [caller, target, returning],
      callerAuthUserId: caller.authUserId,
      today: TODAY,
    };

    expect(statusFailureOf({ code: '42501' }, DEACTIVATE, TODAY, uncovered)).toBe(
      ORGANIZATION_WOULD_HAVE_NO_ADMIN,
    );
    // FROM THE DAY THE THIRD ADMIN RETURNS they cover every date, so the same
    // refusal dated then is not this one.
    expect(statusFailureOf({ code: '42501' }, DEACTIVATE, '2026-10-10', uncovered)).toBe(
      MEMBER_STATUS_STALE,
    );
    // A NON-ADMIN TARGET NEVER EARNS IT, however few admins remain: here no
    // admin at all is active on every date from today.
    const ordinary = member();
    expect(
      statusFailureOf({ code: '42501' }, DEACTIVATE, TODAY, {
        ...uncovered,
        member: ordinary,
        members: [caller, returning, ordinary],
      }),
    ).toBe(MEMBER_STATUS_STALE);
    // A REACTIVATION never reduces the admins.
    const outTarget = { ...target, statusVersions: [version(false, '2026-09-01')] };
    expect(
      statusFailureOf({ code: '42501' }, REACTIVATE, TODAY, { ...uncovered, member: outTarget }),
    ).toBe(MEMBER_STATUS_STALE);
    // CANCELLING AN ADMIN'S REACTIVATION is a deactivation from its date…
    const backTarget = {
      ...target,
      statusVersions: [version(false, '2026-09-01'), version(true, '2026-09-28')],
    };
    expect(
      statusFailureOf(null, WITHDRAW, '2026-09-28', { ...uncovered, member: backTarget }),
    ).toBe(ORGANIZATION_WOULD_HAVE_NO_ADMIN);
    // …and cancelling their deactivation is not.
    const leavingTarget = { ...target, statusVersions: [version(false, '2026-09-28')] };
    expect(
      statusFailureOf(null, WITHDRAW, '2026-09-28', { ...uncovered, member: leavingTarget }),
    ).toBe(MEMBER_STATUS_STALE);
    // Another admin active on every date: the database declined for another reason.
    expect(
      statusFailureOf(
        { code: '42501' },
        DEACTIVATE,
        TODAY,
        statusContext(target, [member({ id: 'admin-4', authUserId: 'a4', role: 'admin' })]),
      ),
    ).toBe(MEMBER_STATUS_STALE);
  });

  it('maps the other codes a status write can raise', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(statusFailureOf({ code: '23505' }, DEACTIVATE, TODAY, statusContext())).toBe(
      MEMBER_STATUS_DATE_TAKEN,
    );
    expect(statusFailureOf({ code: '23503' }, DEACTIVATE, TODAY, statusContext())).toBe(
      MEMBER_WRITE_INVALID,
    );
    expect(statusFailureOf({ code: '08006' }, DEACTIVATE, TODAY, statusContext())).toBe(
      MEMBER_WRITE_UNAVAILABLE,
    );

    const refused = statusTable({ error: { code: '23505' } });

    expect(await changeMemberStatus(refused.table, DEACTIVATE, TODAY, statusContext())).toEqual({
      ok: false,
      refusal: { code: MEMBER_STATUS_DATE_TAKEN, saved: false },
    });

    const thrown = statusTable(new Error('offline'));

    expect(await changeMemberStatus(thrown.table, DEACTIVATE, TODAY, statusContext())).toEqual({
      ok: false,
      refusal: { code: MEMBER_WRITE_UNAVAILABLE, saved: false },
    });
  });

  it('keeps the confirmation mounted while the write is outstanding', () => {
    expect(statusStageOf(false, false)).toBe(STATUS_IDLE);
    expect(statusStageOf(true, false)).toBe(STATUS_ARMED);
    // IN FLIGHT WINS, including with the armed flag already cleared.
    expect(statusStageOf(true, true)).toBe(STATUS_BUSY);
    expect(statusStageOf(false, true)).toBe(STATUS_BUSY);
  });

  it('remounts the block when the history changes and only then', () => {
    const before = member();
    const after = member({ statusVersions: [version(false, TODAY)] });

    expect(statusBlockKey(before)).toBe(statusBlockKey(member()));
    expect(statusBlockKey(after)).not.toBe(statusBlockKey(before));
    expect(statusBlockKey(member({ id: 'other' }))).not.toBe(statusBlockKey(before));
  });

  it('clears an armed confirmation once a refetch changes the member versions', () => {
    const before = member();
    const armed = {
      name: before.name,
      change: DEACTIVATE,
      day: '2026-09-28',
      history: statusBlockKey(before),
    } as const;
    const changed = member({ statusVersions: [version(false, '2026-09-25')] });

    expect(standingConfirmation(armed, member(), false)).toBe(armed);
    expect(standingConfirmation(armed, changed, false)).toBeNull();
    // WHILE ITS OWN WRITE IS PENDING it stands: that write's refetch is what
    // changes the history, and the busy state must outlive it.
    expect(standingConfirmation(armed, changed, true)).toBe(armed);
    // A row that vanished keeps it, so the busy state stays truthful.
    expect(standingConfirmation(armed, null, false)).toBe(armed);
    expect(standingConfirmation(null, before, false)).toBeNull();
  });

  it('states today in the present and the scheduled change in the future', () => {
    expect(statusTodayMessageKey(true)).toBe('ljudi.status.active');
    expect(statusTodayMessageKey(false)).toBe('ljudi.status.inactiveFrom');
    expect(statusScheduledMessageKey(false)).toBe('ljudi.status.scheduledInactive');
    expect(statusScheduledMessageKey(true)).toBe('ljudi.status.scheduledActive');
  });

  it('pairs each change with its own keys, and words a later date in the future', () => {
    expect(statusOfferMessageKey(DEACTIVATE)).toBe('ljudi.status.deactivate');
    expect(statusOfferMessageKey(REACTIVATE)).toBe('ljudi.status.reactivate');
    expect(statusOfferMessageKey(WITHDRAW)).toBe('ljudi.status.withdraw');
    expect(statusPromptMessageKey(DEACTIVATE, false)).toBe('ljudi.status.deactivatePrompt');
    expect(statusPromptMessageKey(DEACTIVATE, true)).toBe('ljudi.status.deactivatePromptFuture');
    expect(statusPromptMessageKey(REACTIVATE, false)).toBe('ljudi.status.reactivatePrompt');
    expect(statusPromptMessageKey(REACTIVATE, true)).toBe('ljudi.status.reactivatePromptFuture');
    expect(statusPromptMessageKey(WITHDRAW, true)).toBe('ljudi.status.withdrawPrompt');
    expect(statusConfirmMessageKey(DEACTIVATE)).toBe('ljudi.status.deactivateConfirm');
    expect(statusConfirmMessageKey(REACTIVATE)).toBe('ljudi.status.reactivateConfirm');
    expect(statusConfirmMessageKey(WITHDRAW)).toBe('ljudi.status.withdrawConfirm');
  });

  it('words a confirmation dated today in the present and one dated after it in the future', () => {
    // `>` AND NOT `>=`: a change dated TODAY happens the moment it is
    // confirmed, so its sentence is the present one.
    expect(statusPromptKeyOf({ change: DEACTIVATE, day: TODAY }, TODAY)).toBe(
      'ljudi.status.deactivatePrompt',
    );
    expect(statusPromptKeyOf({ change: DEACTIVATE, day: '2026-09-24' }, TODAY)).toBe(
      'ljudi.status.deactivatePromptFuture',
    );
    expect(statusPromptKeyOf({ change: REACTIVATE, day: TODAY }, TODAY)).toBe(
      'ljudi.status.reactivatePrompt',
    );
    expect(statusPromptKeyOf({ change: REACTIVATE, day: '2026-10-01' }, TODAY)).toBe(
      'ljudi.status.reactivatePromptFuture',
    );
    expect(statusPromptKeyOf({ change: WITHDRAW, day: '2026-10-01' }, TODAY)).toBe(
      'ljudi.status.withdrawPrompt',
    );
  });

  it("names the date the version in effect took effect, or today for an untouched member", () => {
    expect(statusSinceOf({ activeToday: false, since: '2026-09-01', scheduled: null }, TODAY)).toBe(
      '2026-09-01',
    );
    expect(statusSinceOf({ activeToday: true, since: null, scheduled: null }, TODAY)).toBe(TODAY);
  });

  it('offers no dated change once the latest version is on the last day a date can carry', () => {
    const last = '9999-12-31';

    expect(
      statusOfferOf(
        member({ statusVersions: [{ active: false, effectiveFrom: last }] }),
        CALLER.authUserId,
        last,
      ),
    ).toBeNull();
    // Before that day the same version is simply the scheduled change.
    expect(
      statusOfferOf(
        member({ statusVersions: [{ active: false, effectiveFrom: last }] }),
        CALLER.authUserId,
        TODAY,
      ),
    ).toMatchObject({ change: WITHDRAW });
  });

  it("reads the caller's own account id, and null for no session or a failed read", async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(SESSION_SUBJECT_KEY).toEqual(['session-subject']);
    expect(await readSessionSubject(() => Promise.resolve({ user: { id: 'account' } }))).toBe(
      'account',
    );
    expect(await readSessionSubject(() => Promise.resolve(null))).toBeNull();
    expect(await readSessionSubject(() => Promise.reject(new Error('storage')))).toBeNull();
  });
});

describe('a team change is one appended version or one cancelled one, judged before and after it is sent (story 1.7b)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const A = { id: 'team-a', name: 'Alfa', archived: false };
  const B = { id: 'team-b', name: 'Beta', archived: false };
  const OLD = { id: 'team-old', name: 'Stara', archived: true };
  const TEAMS = [A, B, OLD];

  type Answer = { error: { code?: string } | null; data?: readonly unknown[] | null };

  function teamTable(answer: Answer | Error = { error: null, data: [{}] }): {
    table: MemberTeamTable;
    sent: Readonly<Record<string, unknown>>[];
    deleted: [string, string][][];
  } {
    const sent: Readonly<Record<string, unknown>>[] = [];
    const deleted: [string, string][][] = [];
    const settle = () =>
      answer instanceof Error
        ? Promise.reject(answer)
        : Promise.resolve({ data: answer.data ?? null, error: answer.error });

    return {
      sent,
      deleted,
      table: {
        insert(values) {
          sent.push(values);

          return settle();
        },
        delete() {
          const filters: [string, string][] = [];

          deleted.push(filters);

          return {
            eq(column, value) {
              filters.push([column, value]);

              return {
                eq(second, secondValue) {
                  filters.push([second, secondValue]);

                  return { select: () => settle() };
                },
              };
            },
          };
        },
      },
    };
  }

  const onA = (from = '2026-09-01') =>
    member({ teamVersions: [{ team: { id: A.id, name: A.name }, effectiveFrom: from }] });
  const scheduledB = () =>
    member({
      teamVersions: [
        { team: { id: A.id, name: A.name }, effectiveFrom: '2026-09-01' },
        { team: { id: B.id, name: B.name }, effectiveFrom: '2026-10-01' },
      ],
    });
  const context = (target: MemberListRow): TeamContext => ({ member: target, teams: TEAMS, today: TODAY });

  it('writes to the membership table', () => {
    expect(MEMBER_TEAM_TABLE).toBe('team_membership_versions');
  });

  it('offers active teams but the current one, "no team" only to a member on one, and today as the minimum', () => {
    const fresh = teamOfferOf(member(), TEAMS, TODAY);
    expect(fresh).toMatchObject({
      change: TEAM_MOVE,
      choices: [
        { id: A.id, name: A.name },
        { id: B.id, name: B.name },
      ],
      offersNoTeam: false,
      minimum: TODAY,
    });

    const on = teamOfferOf(onA(), TEAMS, TODAY);
    expect(on).toMatchObject({ choices: [{ id: B.id, name: B.name }], offersNoTeam: true });
    // AN ADMIN'S OWN ROW is offered too: nothing here reads the caller.
    expect(teamOfferOf(member({ role: 'admin' }), TEAMS, TODAY)).not.toBeNull();
    // THE MINIMUM follows the date-order rule: after a version dated today.
    expect(teamOfferOf(onA(TODAY), TEAMS, TODAY)).toMatchObject({ minimum: '2026-09-24' });
  });

  it('offers only the cancellation while a move is scheduled, and nothing without today or teams', () => {
    expect(teamOfferOf(scheduledB(), TEAMS, TODAY)).toMatchObject({
      change: WITHDRAW,
      scheduled: { effectiveFrom: '2026-10-01' },
    });
    expect(teamOfferOf(onA(), TEAMS, null)).toBeNull();
    expect(teamOfferOf(onA(), null, TODAY)).toBeNull();
    // NOTHING TO MOVE ONTO and no team to leave.
    expect(teamOfferOf(member(), [OLD], TODAY)).toBeNull();
  });

  it('reads a picked value by lookup, never by cast', () => {
    const on = teamOfferOf(onA(), TEAMS, TODAY);
    const fresh = teamOfferOf(member(), TEAMS, TODAY);
    if (on === null || fresh === null) throw new Error('no offer');

    expect(chosenTeam(B.id, on)).toEqual({ id: B.id, name: B.name });
    expect(chosenTeam(NO_TEAM_VALUE, on)).toBeNull();
    expect(chosenTeam(NO_TEAM_VALUE, fresh)).toBeUndefined();
    expect(chosenTeam(OLD.id, on)).toBeUndefined();
    expect(chosenTeam(A.id, on)).toBeUndefined();
    expect(teamPickerDefault(on)).toBe(B.id);
  });

  it.each([
    { what: 'a past date', change: TEAM_MOVE, day: '2026-09-22', team: B.id, target: onA, code: MEMBER_TEAM_IN_PAST },
    { what: 'the latest date', change: TEAM_MOVE, day: TODAY, team: B.id, target: () => onA(TODAY), code: MEMBER_TEAM_DATE_TAKEN },
    { what: 'before the latest', change: TEAM_MOVE, day: '2026-09-25', team: B.id, target: () => onA('2026-09-30'), code: MEMBER_TEAM_OUT_OF_ORDER },
    { what: 'the scheduled move\'s own date', change: TEAM_MOVE, day: '2026-10-01', team: A.id, target: scheduledB, code: MEMBER_TEAM_DATE_TAKEN },
    { what: 'the same team', change: TEAM_MOVE, day: TODAY, team: A.id, target: onA, code: MEMBER_TEAM_UNCHANGED },
    { what: 'no team for a member on none', change: TEAM_MOVE, day: TODAY, team: null, target: () => member(), code: MEMBER_TEAM_UNCHANGED },
    { what: 'a second scheduled move', change: TEAM_MOVE, day: '2026-10-05', team: A.id, target: scheduledB, code: MEMBER_TEAM_SCHEDULED },
    { what: 'an archived team', change: TEAM_MOVE, day: TODAY, team: OLD.id, target: onA, code: MEMBER_TEAM_ARCHIVED },
    { what: 'a team the list lacks', change: TEAM_MOVE, day: TODAY, team: 'gone', target: onA, code: MEMBER_TEAM_STALE },
    { what: 'cancelling one in effect', change: WITHDRAW, day: '2026-09-01', team: null, target: onA, code: MEMBER_TEAM_IN_EFFECT },
    { what: 'cancelling one not the latest', change: WITHDRAW, day: '2026-09-02', team: null, target: scheduledB, code: MEMBER_TEAM_STALE },
  ] as const)('refuses $what before sending anything', async ({ change, day, team, target, code }) => {
    const stub = teamTable();

    expect(teamPreflightOf(change, day, team, context(target()))).toBe(code);
    expect(await changeMemberTeam(stub.table, change, day, team, context(target()))).toEqual({
      ok: false,
      refusal: { code, saved: false },
    });
    expect(stub.sent).toEqual([]);
    expect(stub.deleted).toEqual([]);
  });

  it('refuses a date that is not one as a value to correct', () => {
    expect(teamPreflightOf(TEAM_MOVE, '2026-02-31', A.id, context(member()))).toBe(MEMBER_WRITE_INVALID);
  });

  it('sends the four facts of a move, "no team" as null, and a cancellation filtered by member and date', async () => {
    const move = teamTable();
    expect(await changeMemberTeam(move.table, TEAM_MOVE, TODAY, B.id, context(onA()))).toEqual({ ok: true });
    expect(move.sent).toEqual([
      { organization_id: 'organization-1', member_id: 'member-1', team_id: B.id, effective_from: TODAY },
    ]);

    const remove = teamTable();
    expect(await changeMemberTeam(remove.table, TEAM_MOVE, '2026-09-30', null, context(onA()))).toEqual({
      ok: true,
    });
    expect(remove.sent[0]?.['team_id']).toBeNull();

    const cancel = teamTable();
    expect(
      await changeMemberTeam(cancel.table, WITHDRAW, '2026-10-01', null, context(scheduledB())),
    ).toEqual({ ok: true });
    expect(cancel.deleted).toEqual([
      [
        ['member_id', 'member-1'],
        ['effective_from', '2026-10-01'],
      ],
    ]);
  });

  it('reads a cancellation that deleted nothing, or an unexplained 42501, as stale', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const nothing = teamTable({ error: null, data: [] });
    expect(
      await changeMemberTeam(nothing.table, WITHDRAW, '2026-10-01', null, context(scheduledB())),
    ).toEqual({ ok: false, refusal: { code: MEMBER_TEAM_STALE, saved: false } });

    const refused = teamTable({ error: { code: '42501' } });
    expect(await changeMemberTeam(refused.table, TEAM_MOVE, TODAY, B.id, context(onA()))).toEqual({
      ok: false,
      refusal: { code: MEMBER_TEAM_STALE, saved: false },
    });

    const thrown = teamTable(new Error('offline'));
    expect(await changeMemberTeam(thrown.table, TEAM_MOVE, TODAY, B.id, context(onA()))).toEqual({
      ok: false,
      refusal: { code: MEMBER_WRITE_UNAVAILABLE, saved: false },
    });
  });

  it('maps the SQLSTATEs a team write can meet', () => {
    const ctx = context(onA());
    expect(teamFailureOf({ code: '23505' }, TEAM_MOVE, TODAY, B.id, ctx)).toBe(MEMBER_TEAM_DATE_TAKEN);
    expect(teamFailureOf({ code: '23503' }, TEAM_MOVE, TODAY, B.id, ctx)).toBe(MEMBER_TEAM_STALE);
    expect(teamFailureOf({ code: '22007' }, TEAM_MOVE, TODAY, B.id, ctx)).toBe(MEMBER_WRITE_INVALID);
    expect(teamFailureOf({ code: '08006' }, TEAM_MOVE, TODAY, B.id, ctx)).toBe(MEMBER_WRITE_UNAVAILABLE);
    // A 42501 the preflight explains is named: the team archived meanwhile.
    expect(teamFailureOf({ code: '42501' }, TEAM_MOVE, TODAY, OLD.id, ctx)).toBe(MEMBER_TEAM_ARCHIVED);
  });

  it('names every team refusal under smjene.*, never under ljudi.*', () => {
    for (const code of [
      MEMBER_TEAM_IN_PAST,
      MEMBER_TEAM_DATE_TAKEN,
      MEMBER_TEAM_OUT_OF_ORDER,
      MEMBER_TEAM_UNCHANGED,
      MEMBER_TEAM_SCHEDULED,
      MEMBER_TEAM_IN_EFFECT,
      MEMBER_TEAM_ARCHIVED,
      MEMBER_TEAM_STALE,
    ] satisfies MemberWriteFailure[]) {
      expect(memberWriteMessageKey(code)).toMatch(/^smjene\.membership\.error\./);
    }
  });

  it('words the prompt by tense and by whether the move is onto no team', () => {
    const team = { id: B.id, name: B.name };
    expect(teamPromptKeyOf({ change: TEAM_MOVE, team, day: TODAY }, TODAY)).toBe('smjene.membership.movePrompt');
    expect(teamPromptKeyOf({ change: TEAM_MOVE, team, day: '2026-09-30' }, TODAY)).toBe(
      'smjene.membership.movePromptFuture',
    );
    expect(teamPromptKeyOf({ change: TEAM_MOVE, team: null, day: TODAY }, TODAY)).toBe(
      'smjene.membership.removePrompt',
    );
    expect(teamPromptKeyOf({ change: TEAM_MOVE, team: null, day: '2026-09-30' }, TODAY)).toBe(
      'smjene.membership.removePromptFuture',
    );
    expect(teamPromptKeyOf({ change: WITHDRAW, team: null, day: '2026-09-30' }, TODAY)).toBe(
      'smjene.membership.withdrawPrompt',
    );
    expect(teamOfferMessageKey(TEAM_MOVE)).toBe('smjene.membership.move');
    expect(teamOfferMessageKey(WITHDRAW)).toBe('smjene.membership.withdraw');
    expect(teamConfirmMessageKey(TEAM_MOVE)).toBe('smjene.membership.moveConfirm');
    expect(teamConfirmMessageKey(WITHDRAW)).toBe('smjene.membership.withdrawConfirm');
    expect(teamScheduledMessageKey(true)).toBe('smjene.membership.scheduledNone');
    expect(teamScheduledMessageKey(false)).toBe('smjene.membership.scheduled');
  });

  it('keeps an armed confirmation while pending, and clears it when the team history changes', () => {
    const before = onA();
    const armed: TeamConfirmation = {
      name: before.name,
      change: TEAM_MOVE,
      team: { id: B.id, name: B.name },
      day: TODAY,
      history: teamBlockKey(before),
    };

    expect(standingTeamConfirmation(armed, before, false)).toBe(armed);
    expect(standingTeamConfirmation(armed, scheduledB(), false)).toBeNull();
    expect(standingTeamConfirmation(armed, scheduledB(), true)).toBe(armed);
    expect(standingTeamConfirmation(null, before, false)).toBeNull();
  });
});
