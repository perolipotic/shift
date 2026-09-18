import { afterEach, describe, expect, it, vi } from 'vitest';

import type { MemberListRow, MembersSurfaceState } from '@/members/list';
import {
  DEFAULT_MEMBER_ROLE,
  LEAVE_ALLOWANCE_MAX,
  MEMBER_ACCOUNT_STRANDED,
  MEMBER_CREATED,
  MEMBER_READ_REFUSED,
  MEMBER_EDIT_COLUMNS,
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
  USERNAME_CHANGED,
  WIRE_CODES,
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
  renameMember,
  replyCodeOf,
  saveMember,
  storedEmail,
  usernameChanged,
  type FunctionsAnswer,
  type MemberEdits,
  type MemberFunctions,
  type MemberWriteFailure,
  type MemberWriteTable,
  type PostgrestAnswer,
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
    ...fields,
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

describe('every failure becomes exactly one message, and no two share one', () => {
  const EVERY_FAILURE: readonly MemberWriteFailure[] = [
    MEMBER_WRITE_REFUSED,
    MEMBER_WRITE_INVALID,
    MEMBER_USERNAME_TAKEN,
    MEMBER_USERNAME_INVALID,
    MEMBER_UNKNOWN,
    MEMBER_USERNAME_NOT_APPLIED,
    MEMBER_USERNAME_UNSETTLED,
    MEMBER_ACCOUNT_STRANDED,
    ORGANIZATION_WOULD_HAVE_NO_ADMIN,
    MEMBER_WRITE_UNAVAILABLE,
  ];

  it('gives each of the ten its own key', () => {
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
    for (const failure of EVERY_FAILURE) {
      expect(memberWriteMessageKey(failure)).toMatch(/^ljudi\.form\.error\./);
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
  it.each(['name', 'username', 'email', 'role', 'leaveAllowanceDays'] as const)(
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
