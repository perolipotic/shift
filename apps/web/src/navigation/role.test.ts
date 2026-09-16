import type { Session } from '@supabase/supabase-js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { destinationsFor } from '@/navigation/destinations';
import {
  MEMBERS_TABLE,
  MEMBER_ROLE_COLUMNS,
  MEMBER_ROLE_KEY,
  MEMBER_ROLE_REFUSED,
  MEMBER_ROLE_UNAVAILABLE,
  MEMBER_ROLE_UNRECOGNISED,
  memberRoleOf,
  readMemberRole,
  type MemberTable,
  type PostgrestAnswer,
} from '@/navigation/role';

/**
 * The role read's I/O matrix, EXECUTED.
 *
 * AD-15 bans jsdom, so the chrome itself cannot be rendered — which is precisely
 * why the decision that matters was put in a `.ts` module with both of its
 * dependencies as parameters. Every row below runs against a stub with nothing
 * running: no browser, no stack, no environment, no network.
 *
 * The claim that matters most is the NEGATIVE one, and it is the row a
 * row-by-row suite tends to skip: an unrecognised role must not be answered with
 * an empty destination list. Filtering `'supervisor'` to nothing renders an
 * empty bar, an empty bar is what a member with no access would see, and the two
 * must never look alike. So the last block below asserts the two outcomes are
 * distinguishable rather than only that each one maps somewhere.
 */

/** Enough of a session to carry the one field the read uses. */
const SESSION = {
  access_token: 'token',
  user: { id: 'auth-user-id' },
} as unknown as Session;

const signedIn = (): Promise<Session | null> => Promise.resolve(SESSION);
const signedOut = (): Promise<Session | null> => Promise.resolve(null);
const unreadable = (): Promise<Session | null> => Promise.reject(new Error('SecurityError'));

/** What the stub was asked for, so the query itself can be asserted. */
interface Asked {
  readonly columns: string[];
  readonly filters: { column: string; operator: string; value: string }[];
  readonly limits: number[];
}

/** A table that answers with whatever PostgREST would have answered. */
function answering(answer: PostgrestAnswer): { table: MemberTable; asked: Asked } {
  const asked: Asked = { columns: [], filters: [], limits: [] };

  return {
    asked,
    table: {
      select: (columns) => {
        asked.columns.push(columns);

        return {
          filter: (column, operator, value) => {
            asked.filters.push({ column, operator, value });

            return {
              limit: (count) => {
                asked.limits.push(count);

                return Promise.resolve(answer);
              },
            };
          },
        };
      },
    },
  };
}

/** A table whose call never completes — the offline case. */
function rejecting(): MemberTable {
  return {
    select: () => ({
      filter: () => ({ limit: () => Promise.reject(new TypeError('Failed to fetch')) }),
    }),
  };
}

const silenced = vi.spyOn(console, 'error').mockImplementation(() => undefined);

afterEach(() => {
  silenced.mockClear();
});

describe('a recognised role comes back as a role', () => {
  it.each([
    { row: 'an admin', stored: 'admin', destinations: 8 },
    { row: 'a member', stored: 'member_role', destinations: 4 },
  ])('reads $row off its own row', async ({ stored, destinations }) => {
    const { table } = answering({ data: [{ role: stored }], error: null });

    const outcome = await readMemberRole(table, signedIn);

    expect(outcome).toEqual({ ok: true, role: stored });
    // Followed one step further out, to the thing the chrome actually renders:
    // the point of reading the role at all is which destinations it reaches, and
    // a mapping that returned the wrong role would satisfy the line above only
    // by returning some OTHER valid role — which this catches.
    expect(outcome.ok ? destinationsFor(outcome.role) : []).toHaveLength(destinations);
  });

  it('asks for one column, its own row, and one row more than it wants', async () => {
    // WHAT NOTHING ELSE BINDS. Filtering on `id` type-checks, lints and returns
    // somebody else's row or none at all; `select('*')` puts every member field
    // into a cache entry that answers one question; and `limit(1)` would make a
    // widened policy invisible, because a truncated answer looks exactly like a
    // correct one.
    const { table, asked } = answering({ data: [{ role: 'admin' }], error: null });

    await readMemberRole(table, signedIn);

    expect(asked.columns).toEqual([MEMBER_ROLE_COLUMNS]);
    expect(asked.filters).toEqual([
      { column: 'auth_user_id', operator: 'eq', value: 'auth-user-id' },
    ]);
    expect(asked.limits).toEqual([2]);
  });

  it('ignores every other column the row happens to carry', async () => {
    const { table } = answering({
      data: [{ role: 'member_role', name: 'Ivan Marić', leave_allowance_days: 20 }],
      error: null,
    });

    expect(await readMemberRole(table, signedIn)).toEqual({ ok: true, role: 'member_role' });
  });
});

describe('a role the application does not recognise is reported, never filtered away', () => {
  it.each([
    { row: 'a level a later migration added', stored: 'supervisor' },
    { row: 'the forbidden synonym for the member level', stored: 'member' },
    { row: 'a capitalized spelling', stored: 'Admin' },
    { row: 'an empty string', stored: '' },
  ])('reports $row rather than answering with a role', async ({ stored }) => {
    const { table } = answering({ data: [{ role: stored }], error: null });

    expect(await readMemberRole(table, signedIn)).toEqual({
      ok: false,
      code: MEMBER_ROLE_UNRECOGNISED,
    });
  });

  it.each([
    { row: 'a null column', stored: null },
    { row: 'a number where text was expected', stored: 7 },
  ])('reports $row as the service fault it is, not as an unknown level', async ({ stored }) => {
    // THE DISTINCTION THIS ROW EXISTS FOR. A row carrying no `role` STRING is a
    // schema or transport fault — a renamed column, a partial response, a proxy
    // answering with something that is not JSON — and calling it "a permission
    // level this build does not recognise" sends whoever reads the log looking
    // for a migration that does not exist. It also logged the literal `null` as
    // the offending value, which is the least actionable thing it could say.
    const { table } = answering({ data: [{ role: stored }], error: null });

    expect(await readMemberRole(table, signedIn)).toEqual({
      ok: false,
      code: MEMBER_ROLE_UNAVAILABLE,
    });
    expect(silenced).toHaveBeenCalledWith(MEMBER_ROLE_UNAVAILABLE, { role: stored });
  });

  it('reports a row that is not a row at all the same way', async () => {
    const { table } = answering({ data: ['not a row'], error: null });

    expect(await readMemberRole(table, signedIn)).toEqual({
      ok: false,
      code: MEMBER_ROLE_UNAVAILABLE,
    });
  });

  it('logs the value, which is the only place it can be acted on', async () => {
    // The matrix's own row. The person cannot act on `'supervisor'` — it is a
    // fact about the DATABASE — so it must not reach the screen; and without the
    // log the first symptom is navigation that quietly stopped listing anything,
    // which is the kind nobody reports.
    const { table } = answering({ data: [{ role: 'supervisor' }], error: null });

    await readMemberRole(table, signedIn);

    expect(silenced).toHaveBeenCalledWith(MEMBER_ROLE_UNRECOGNISED, 'supervisor');
  });

  it('is distinguishable from a role that reaches nothing, which is the whole point', async () => {
    // THE assertion of this file. A cast instead of the guard would make
    // `'supervisor'` a `MemberRole` the type system believes in,
    // `destinationsFor` would filter it to an empty list, and the chrome would
    // render an empty bar — byte-identical to a member with no access. Nothing
    // else in this repository would be red.
    const { table } = answering({ data: [{ role: 'supervisor' }], error: null });
    const unrecognised = await readMemberRole(table, signedIn);

    expect(unrecognised.ok).toBe(false);
    expect(memberRoleOf('supervisor')).toBeNull();
    // And the other polarity: the two levels that DO exist reach destinations,
    // so "no destinations" is never merely what this function always produces.
    expect(destinationsFor('member_role').length).toBeGreaterThan(0);
  });

  it('narrows by lookup rather than by cast, on both polarities', () => {
    // The guard itself, self-tested: a `memberRoleOf` that returned its argument
    // would satisfy every success row above and none of the refusals.
    expect(memberRoleOf('admin')).toBe('admin');
    expect(memberRoleOf('member_role')).toBe('member_role');
    expect(memberRoleOf('supervisor')).toBeNull();
    expect(memberRoleOf(undefined)).toBeNull();
    expect(memberRoleOf({ role: 'admin' })).toBeNull();
  });
});

describe('a read that reaches no row is a refusal, never an empty success', () => {
  it('maps zero rows to the refusal', async () => {
    // Row level security fails USING, the statement matches nothing and raises
    // nothing — a deactivated account and a missing member row both arrive here.
    const { table } = answering({ data: [], error: null });

    expect(await readMemberRole(table, signedIn)).toEqual({ ok: false, code: MEMBER_ROLE_REFUSED });
  });

  it('maps a null payload to the refusal too', async () => {
    const { table } = answering({ data: null, error: null });

    expect(await readMemberRole(table, signedIn)).toEqual({ ok: false, code: MEMBER_ROLE_REFUSED });
  });

  it('maps a session that is not there to the refusal, without asking the service', async () => {
    // The layout's guard has already redirected a signed-out visitor, so this is
    // the session going away between the guard and the render. It must not
    // render a role, and it must not send a request naming `undefined`.
    const { table, asked } = answering({ data: [{ role: 'admin' }], error: null });

    expect(await readMemberRole(table, signedOut)).toEqual({
      ok: false,
      code: MEMBER_ROLE_REFUSED,
    });
    expect(asked.columns, 'a sessionless read still reached the service').toEqual([]);
  });
});

describe('a service failure is the service’s fault and never the caller’s', () => {
  it('logs the cause of every failure it cannot explain on screen', async () => {
    // A module that argues for never swallowing a cause was swallowing three of
    // them: the transport rejection, the PostgREST error — including the `42703`
    // its own tests exercise — and the impossible second row. One message
    // reaches the person, because there is one thing to do; the console is where
    // "the column was renamed" and "the gateway timed out" stop looking alike.
    const failed = { code: '42703', message: 'column members.role does not exist' };

    await readMemberRole(answering({ data: null, error: failed }).table, signedIn);
    expect(silenced, 'a PostgREST error is discarded').toHaveBeenCalledWith(
      MEMBER_ROLE_UNAVAILABLE,
      failed,
    );

    silenced.mockClear();
    await readMemberRole(rejecting(), signedIn);
    expect(silenced, 'a rejected read is discarded').toHaveBeenCalledWith(
      MEMBER_ROLE_UNAVAILABLE,
      expect.anything(),
    );

    silenced.mockClear();
    await readMemberRole(
      answering({ data: [{ role: 'admin' }, { role: 'member_role' }], error: null }).table,
      signedIn,
    );
    expect(silenced, 'a widened policy is discarded').toHaveBeenCalledWith(
      MEMBER_ROLE_UNAVAILABLE,
      2,
    );
  });

  it('maps a PostgREST error to the try-again code rather than to a refusal', async () => {
    // A refused policy arrives as an EMPTY ROW SET and raises nothing, so an
    // `error` here is a transport or a schema fault. Reporting it as "you have
    // no access" sends somebody to ask for rights they already hold.
    const { table } = answering({
      data: null,
      error: { code: '42703', message: 'column members.role does not exist' },
    });

    expect(await readMemberRole(table, signedIn)).toEqual({
      ok: false,
      code: MEMBER_ROLE_UNAVAILABLE,
    });
  });

  it('maps a rejected call to the try-again code rather than letting it escape', async () => {
    expect(await readMemberRole(rejecting(), signedIn)).toEqual({
      ok: false,
      code: MEMBER_ROLE_UNAVAILABLE,
    });
  });

  it('maps more than one row to the try-again code, and renders nobody’s role', async () => {
    // `auth_user_id` is unique, so two rows cannot happen against today's
    // schema — which is exactly why taking `rows[0]` would be invisible until a
    // policy or a join made it possible, at which point an arbitrary role's
    // navigation would render, internally consistent and wrong.
    const { table } = answering({
      data: [{ role: 'member_role' }, { role: 'admin' }],
      error: null,
    });

    expect(await readMemberRole(table, signedIn)).toEqual({
      ok: false,
      code: MEMBER_ROLE_UNAVAILABLE,
    });
  });

  it('maps an unreadable session to the try-again code and logs the cause', async () => {
    // `currentSession` rejects on a build with no environment and wherever
    // storage is blocked. Neither is evidence about anybody's permissions, and
    // swallowing the cause is how a misconfiguration reads as an outage.
    expect(await readMemberRole(rejecting(), unreadable)).toEqual({
      ok: false,
      code: MEMBER_ROLE_UNAVAILABLE,
    });
    expect(silenced).toHaveBeenCalledWith(MEMBER_ROLE_UNAVAILABLE, expect.anything());
  });

  it('keeps the three codes distinct, so the mapping is not a constant', async () => {
    // Vacuous-pass guard on the whole file: a `readMemberRole` that always
    // returned one code would satisfy every individual row above.
    expect(new Set([MEMBER_ROLE_REFUSED, MEMBER_ROLE_UNRECOGNISED, MEMBER_ROLE_UNAVAILABLE]).size).toBe(
      3,
    );
  });
});

describe('the names the chrome reads through', () => {
  it('names the relation and one query key, so no component holds either', () => {
    // A key written inline at the call site is a second key the moment anything
    // gains a qualifier, and the failure is a second network read answering the
    // same question differently.
    expect(MEMBERS_TABLE).toBe('members');
    // THE VALUE, not the length. A length of one is satisfied by any rename at
    // all, and a renamed key is a cache entry nothing else in the application
    // can find — including the sign-out that clears it and any later surface
    // that invalidates it.
    expect(MEMBER_ROLE_KEY).toEqual(['member-role']);
    expect(MEMBER_ROLE_COLUMNS).toBe('role');
  });
});
