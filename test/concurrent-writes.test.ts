import { Client } from 'pg';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * `0023_serialize_organization_writes.sql`, executed with TWO REAL
 * CONNECTIONS. Every other live suite runs one connection per case, so it
 * cannot see a race at all. This one can.
 *
 * DETERMINISTIC, NO SLEEPS AS ORDERING. Each race case runs one fixed order:
 *
 *   1. T1 begins and writes, and stays open.
 *   2. T2 begins and writes. The case proves T2 is WAITING ON THIS
 *      ORGANIZATION'S ADVISORY LOCK by polling `pg_locks` from a third
 *      connection until T2's backend holds that key ungranted. If T2's write
 *      finishes instead, it was not serialized and the case fails there.
 *   3. T1 commits (or, in a control, rolls back).
 *   4. T2 is refused, or proceeds, and the case asserts which.
 *
 * The polling has a deadline, but the deadline only turns a hang into a
 * failure. It never decides the order.
 *
 * Every writer is a REQUEST SESSION (claims injected, `set local role
 * authenticated`), because 0023 serializes request writes and nothing else.
 * The owner connections here only build fixtures, and in the deadlock cases
 * play the operator or the cascade that takes no lock.
 *
 * COMMITTED FIXTURES, because a race needs T1's commit to be real. Each case
 * builds its own throwaway organization under {@link THROWAWAY}, and `afterAll`
 * deletes every one of them and their accounts. Every connection is rolled
 * back and closed in `finally`.
 */

const databaseUrl =
  process.env['SUPABASE_DB_URL'] ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';

/** Connected AND migrated, for the reason `test/rls-isolation.test.ts` gives. */
async function reachable(): Promise<boolean> {
  const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 2000 });
  try {
    await client.connect();
    const { rows } = await client.query<{ migrated: boolean }>(
      `select to_regclass('public.organizations') is not null
                and to_regclass('public.members') is not null as migrated`,
    );
    await client.end();
    return rows[0]?.migrated === true;
  } catch {
    await client.end().catch(() => undefined);
    return false;
  }
}

const noDatabase = !(await reachable());

/** Every organization slug and account address this file issues carries it. */
const THROWAWAY = 'concurrent-writes-test';

/**
 * How long T2 may take to reach the lock before the case calls it unserialized.
 * Under vitest's 5 s case timeout, so the case fails with this file's message
 * and its `finally` still closes every connection.
 */
const BLOCK_DEADLINE_MS = 3_000;

/** The timeout of a case that has to outlast a deadline or a deadlock check. */
const LONG_CASE_MS = 15_000;

async function connect(): Promise<Client> {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  return client;
}

interface Account {
  readonly id: string;
  readonly authUserId: string;
}

/** A committed organization of its own, so no case shares a lock key. */
async function addOrganization(client: Client): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into organizations (
       slug, name, organization_type, timezone, locale,
       leave_year_start_month, leave_year_start_day
     )
     values ($1, 'Concurrent writes', 'test', 'Europe/Zagreb', 'hr', 1, 1)
     returning id`,
    [`${THROWAWAY}-${crypto.randomUUID().slice(0, 8)}`],
  );
  const created = rows[0];
  if (created === undefined) throw new Error('organizations insert returned no row');
  return created.id;
}

/** A bare account with no member row. It never signs in: claims are injected. */
async function addUser(client: Client): Promise<{ id: string; label: string }> {
  const label = `m${crypto.randomUUID().slice(0, 8)}`;
  const { rows } = await client.query<{ id: string }>(
    `insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id`,
    [`${label}@${THROWAWAY}.shift.invalid`],
  );
  const user = rows[0];
  if (user === undefined) throw new Error('auth.users insert returned no row');
  return { id: user.id, label };
}

/** A committed member on a bare account. */
async function addAccount(
  client: Client,
  organization: string,
  role: 'admin' | 'member_role',
): Promise<Account> {
  const user = await addUser(client);
  const { rows } = await client.query<{ id: string }>(
    `insert into members (organization_id, auth_user_id, name, username, role, leave_allowance_days)
     values ($1, $2, $3, $3, $4, 0)
     returning id`,
    [organization, user.id, user.label, role],
  );
  const member = rows[0];
  if (member === undefined) throw new Error('members insert returned no row');
  return { id: member.id, authUserId: user.id };
}

async function addTeam(client: Client, organization: string, createdBy: string): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into teams (organization_id, name, created_by) values ($1, 'Smjena', $2) returning id`,
    [organization, createdBy],
  );
  const team = rows[0];
  if (team === undefined) throw new Error('teams insert returned no row');
  return team.id;
}

/** A status version committed as the OWNER, past every policy: a starting state. */
async function ownerStatus(
  client: Client,
  version: { organization: string; member: string; active: boolean; from: string; by: string },
): Promise<void> {
  await client.query(
    `insert into member_status_versions (organization_id, member_id, active, effective_from, created_by)
     values ($1, $2, $3, $4::date, $5)`,
    [version.organization, version.member, version.active, version.from, version.by],
  );
}

/** The organization's today plus `offset` days, as the policies compute it. */
async function organizationDay(client: Client, organization: string, offset: number): Promise<string> {
  const { rows } = await client.query<{ day: string }>(
    'select (public.organization_today($1) + $2::int)::text as day',
    [organization, offset],
  );
  const day = rows[0]?.day;
  if (day === undefined) throw new Error('organization_today answered nothing');
  return day;
}

/** Claims injected and the request role taken, inside the open transaction. */
async function actAs(client: Client, account: Account, organization: string): Promise<void> {
  await client.query('select set_config($1, $2, true)', [
    'request.jwt.claims',
    JSON.stringify({ sub: account.authUserId, role: 'authenticated', organization_id: organization }),
  ]);
  await client.query('set local role authenticated');
}

async function backendPid(client: Client): Promise<number> {
  const { rows } = await client.query<{ pid: number }>('select pg_backend_pid() as pid');
  const pid = rows[0]?.pid;
  if (pid === undefined) throw new Error('pg_backend_pid answered nothing');
  return pid;
}

type Outcome =
  | { readonly ok: true; readonly rowCount: number | null }
  | { readonly ok: false; readonly code: string; readonly message: string };

/** A query that never rejects, and says whether it has settled yet. */
interface Pending {
  readonly outcome: Promise<Outcome>;
  settled(): boolean;
}

function pending(query: Promise<{ rowCount: number | null }>): Pending {
  let done = false;
  const outcome = query.then(
    (result): Outcome => {
      done = true;
      return { ok: true, rowCount: result.rowCount };
    },
    (cause: unknown): Outcome => {
      done = true;
      const error = cause as { code?: string; message?: string };
      return { ok: false, code: error.code ?? '', message: error.message ?? '' };
    },
  );
  return { outcome, settled: () => done };
}

/**
 * Whether backend `pid` holds (`granted`) or waits for (`!granted`) THIS
 * organization's advisory key: the bigint key 0023 computes, split the way
 * `pg_locks` reports it (high half in `classid`, low half in `objid`,
 * `objsubid` 1 for a bigint key).
 */
async function advisoryKeyLock(
  observer: Client,
  pid: number,
  organization: string,
  granted: boolean,
): Promise<boolean> {
  const { rows } = await observer.query<{ found: boolean }>(
    `with k as (
       select pg_catalog.hashtextextended('shift.organization_writes:' || $2::uuid::text, 0) as key
     )
     select exists (
       select 1
         from pg_locks l, k
        where l.pid = $1
          and l.locktype = 'advisory'
          and l.granted = $3
          and l.objsubid = 1
          and l.classid::text::bigint = ((k.key >> 32) & 4294967295)
          and l.objid::text::bigint = (k.key & 4294967295)
     ) as found`,
    [pid, organization, granted],
  );
  return rows[0]?.found === true;
}

/**
 * Resolve once backend `pid` is waiting on `organization`'s advisory key.
 * Throw if its statement finishes first: then nothing serialized it.
 */
async function waitUntilBlocked(
  observer: Client,
  pid: number,
  organization: string,
  write: Pending,
): Promise<void> {
  const deadline = Date.now() + BLOCK_DEADLINE_MS;
  for (;;) {
    if (await advisoryKeyLock(observer, pid, organization, false)) return;
    if (write.settled()) {
      throw new Error(`T2 finished without waiting on the lock: ${JSON.stringify(await write.outcome)}`);
    }
    if (Date.now() > deadline) throw new Error('T2 neither waited on the lock nor finished');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** Resolve once `write` has settled, or backend `pid` waits on any lock at all. */
async function untilSettledOrWaiting(observer: Client, pid: number, write: Pending): Promise<void> {
  const deadline = Date.now() + BLOCK_DEADLINE_MS;
  for (;;) {
    if (write.settled()) return;
    const { rows } = await observer.query<{ waiting: boolean }>(
      `select coalesce(bool_or(wait_event_type = 'Lock'), false) as waiting
         from pg_stat_activity where pid = $1`,
      [pid],
    );
    if (rows[0]?.waiting === true) return;
    if (Date.now() > deadline) throw new Error('the write neither finished nor waited');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** Two writers and an observer, always rolled back and closed, however far setup got. */
async function race(
  work: (t1: Client, t2: Client, observer: Client) => Promise<void>,
): Promise<void> {
  const clients: Client[] = [];
  try {
    const [t1, t2, observer] = [new Client(databaseUrl), new Client(databaseUrl), new Client(databaseUrl)];
    clients.push(t1, t2, observer);
    await Promise.all(clients.map((client) => client.connect()));
    await work(t1, t2, observer);
  } finally {
    for (const client of clients) await client.query('rollback').catch(() => undefined);
    await Promise.all(clients.map((client) => client.end().catch(() => undefined)));
  }
}

/** Committed fixtures, through one owner connection that is always closed. */
async function fixture<T>(build: (client: Client) => Promise<T>): Promise<T> {
  const client = await connect();
  try {
    return await build(client);
  } finally {
    await client.end();
  }
}

async function insertStatus(
  client: Client,
  version: { organization: string; member: string; active: boolean; from: string },
): Promise<{ rowCount: number | null }> {
  return client.query(
    `insert into member_status_versions (organization_id, member_id, active, effective_from)
     values ($1, $2, $3, $4::date)`,
    [version.organization, version.member, version.active, version.from],
  );
}

async function cancelStatus(
  client: Client,
  member: string,
  from: string,
): Promise<{ rowCount: number | null }> {
  return client.query(
    'delete from member_status_versions where member_id = $1 and effective_from = $2::date',
    [member, from],
  );
}

async function insertMembership(
  client: Client,
  version: { organization: string; member: string; team: string; from: string },
): Promise<{ rowCount: number | null }> {
  return client.query(
    `insert into team_membership_versions (organization_id, member_id, team_id, effective_from)
     values ($1, $2, $3, $4::date)`,
    [version.organization, version.member, version.team, version.from],
  );
}

async function demote(client: Client, member: string): Promise<{ rowCount: number | null }> {
  return client.query(`update members set role = 'member_role' where id = $1`, [member]);
}

async function count(observer: Client, sql: string, parameter: string): Promise<number> {
  const { rows } = await observer.query<{ total: number }>(sql, [parameter]);
  return rows[0]?.total ?? -1;
}

afterAll(async () => {
  if (noDatabase) return;
  const client = await connect();
  try {
    await client.query('delete from organizations where slug like $1', [`${THROWAWAY}-%`]);
    await client.query('delete from auth.users where email like $1', [`%@${THROWAWAY}.shift.invalid`]);
  } finally {
    await client.end();
  }
});

describe('concurrent writes to one organization wait for each other', () => {
  it.skipIf(noDatabase)('refuses the second of two admins deleted concurrently', async () => {
    // Each admin removes their own row, which the delete policy admits. Each
    // commit-time check alone sees the other admin still present.
    const { organization, a, b } = await fixture(async (client) => {
      const organization = await addOrganization(client);
      return {
        organization,
        a: await addAccount(client, organization, 'admin'),
        b: await addAccount(client, organization, 'admin'),
      };
    });

    await race(async (t1, t2, observer) => {
      await t1.query('begin');
      await actAs(t1, a, organization);
      expect((await t1.query('delete from members where id = $1', [a.id])).rowCount).toBe(1);

      const pid = await backendPid(t2);
      await t2.query('begin');
      await actAs(t2, b, organization);
      const second = pending(t2.query('delete from members where id = $1', [b.id]));
      await waitUntilBlocked(observer, pid, organization, second);

      await t1.query('commit');
      expect(await second.outcome, 'the second delete statement itself').toEqual({
        ok: true,
        rowCount: 1,
      });

      // The deferred check runs at commit, after the lock, on a fresh snapshot.
      expect(await pending(t2.query('commit')).outcome).toMatchObject({
        ok: false,
        code: '23514',
        message: 'ORGANIZATION_WOULD_HAVE_NO_ADMIN',
      });

      expect(
        await count(
          observer,
          `select count(*)::int as total from members where organization_id = $1 and role = 'admin'`,
          organization,
        ),
        'the organization was left with no admin',
      ).toBe(1);
    });
  });

  for (const t1Ends of ['commit', 'rollback'] as const) {
    it.skipIf(noDatabase)(
      t1Ends === 'commit'
        ? 'refuses the second of two admins deactivating each other'
        : 'admits the same deactivation once the first is rolled back (the control)',
      async () => {
        const { organization, a, b, from } = await fixture(async (client) => {
          const organization = await addOrganization(client);
          return {
            organization,
            a: await addAccount(client, organization, 'admin'),
            b: await addAccount(client, organization, 'admin'),
            from: await organizationDay(client, organization, 5),
          };
        });

        await race(async (t1, t2, observer) => {
          await t1.query('begin');
          await actAs(t1, a, organization);
          expect(
            (await insertStatus(t1, { organization, member: b.id, active: false, from })).rowCount,
          ).toBe(1);

          const pid = await backendPid(t2);
          await t2.query('begin');
          await actAs(t2, b, organization);
          const second = pending(insertStatus(t2, { organization, member: a.id, active: false, from }));
          await waitUntilBlocked(observer, pid, organization, second);

          await t1.query(t1Ends);

          if (t1Ends === 'commit') {
            // 0008's policy, whose readers are volatile: after the lock it sees B out.
            expect(await second.outcome).toMatchObject({ ok: false, code: '42501' });
          } else {
            // The same write, alone: admitted, so the refusal above is the race's.
            expect(await second.outcome).toEqual({ ok: true, rowCount: 1 });
          }
        });
      },
    );
  }

  it.skipIf(noDatabase)(
    'refuses a deactivation that waited while the only other admin was demoted',
    async () => {
      // THE STALE READ 0023 RE-CHECKS. C is scheduled out from day 3. The
      // policy reads `members` inline, on the statement's snapshot, taken
      // before the wait: A is still an admin to it and covers day 5. The AFTER
      // trigger asks again after the lock, and nobody but B does.
      const { organization, a, b, c, from } = await fixture(async (client) => {
        const organization = await addOrganization(client);
        const a = await addAccount(client, organization, 'admin');
        const b = await addAccount(client, organization, 'admin');
        const c = await addAccount(client, organization, 'admin');
        await ownerStatus(client, {
          organization,
          member: c.id,
          active: false,
          from: await organizationDay(client, organization, 3),
          by: a.authUserId,
        });
        return { organization, a, b, c, from: await organizationDay(client, organization, 5) };
      });

      await race(async (t1, t2, observer) => {
        await t1.query('begin');
        await actAs(t1, b, organization);
        expect((await demote(t1, a.id)).rowCount).toBe(1);

        const pid = await backendPid(t2);
        await t2.query('begin');
        await actAs(t2, c, organization);
        const second = pending(insertStatus(t2, { organization, member: b.id, active: false, from }));
        await waitUntilBlocked(observer, pid, organization, second);

        await t1.query('commit');

        expect(await second.outcome).toMatchObject({
          ok: false,
          code: '23514',
          message: 'ORGANIZATION_WOULD_HAVE_NO_ADMIN',
        });
        expect(
          await count(
            observer,
            'select count(*)::int as total from member_status_versions where member_id = $1',
            b.id,
          ),
          'the last admin was scheduled out',
        ).toBe(0);
      });
    },
  );

  it.skipIf(noDatabase)('refuses a write whose caller was demoted while it waited', async () => {
    // `current_member_access()` is STABLE, so the policy saw A as an admin on
    // the statement's snapshot. The AFTER trigger re-reads the caller.
    const { organization, a, b, member, from } = await fixture(async (client) => {
      const organization = await addOrganization(client);
      return {
        organization,
        a: await addAccount(client, organization, 'admin'),
        b: await addAccount(client, organization, 'admin'),
        member: await addAccount(client, organization, 'member_role'),
        from: await organizationDay(client, organization, 2),
      };
    });

    await race(async (t1, t2, observer) => {
      await t1.query('begin');
      await actAs(t1, b, organization);
      expect((await demote(t1, a.id)).rowCount).toBe(1);

      const pid = await backendPid(t2);
      await t2.query('begin');
      await actAs(t2, a, organization);
      const second = pending(
        insertStatus(t2, { organization, member: member.id, active: false, from }),
      );
      await waitUntilBlocked(observer, pid, organization, second);

      await t1.query('commit');

      expect(await second.outcome).toMatchObject({ ok: false, code: '42501' });
      expect(
        await count(
          observer,
          'select count(*)::int as total from member_status_versions where member_id = $1',
          member.id,
        ),
        'a demoted admin wrote a status version',
      ).toBe(0);
    });
  });

  for (const t1Changes of ['deactivates', 'demotes'] as const) {
    it.skipIf(noDatabase)(
      t1Changes === 'deactivates'
        ? 'refuses cancelling a reactivation that waited while the covering admin was scheduled out'
        : 'refuses cancelling a reactivation that waited while the covering admin was demoted',
      async () => {
        // A is out today and back from day 10; C is out from day 11. B covers
        // day 10 on. T1 takes B away (a deactivation from day 12, justified by
        // A's return, or a demotion). T2, as C, then cancels A's return, which
        // would leave day 12 on with no admin.
        //
        // DEACTIVATES: after the lock the delete policy's volatile reader sees
        // B out, so USING admits no row: zero rows, 0008's silent refusal.
        // DEMOTES: the policy reads B's role on the stale snapshot and admits
        // the delete; the AFTER trigger's DELETE branch refuses it.
        const setup = await fixture(async (client) => {
          const organization = await addOrganization(client);
          const a = await addAccount(client, organization, 'admin');
          const b = await addAccount(client, organization, 'admin');
          const c = await addAccount(client, organization, 'admin');
          const back = await organizationDay(client, organization, 10);
          await ownerStatus(client, {
            organization,
            member: a.id,
            active: false,
            from: await organizationDay(client, organization, 0),
            by: b.authUserId,
          });
          await ownerStatus(client, { organization, member: a.id, active: true, from: back, by: b.authUserId });
          await ownerStatus(client, {
            organization,
            member: c.id,
            active: false,
            from: await organizationDay(client, organization, 11),
            by: b.authUserId,
          });
          return { organization, a, b, c, back, out: await organizationDay(client, organization, 12) };
        });
        const { organization, a, b, c, back, out } = setup;

        await race(async (t1, t2, observer) => {
          await t1.query('begin');
          await actAs(t1, c, organization);
          const first =
            t1Changes === 'deactivates'
              ? await insertStatus(t1, { organization, member: b.id, active: false, from: out })
              : await demote(t1, b.id);
          expect(first.rowCount).toBe(1);

          const pid = await backendPid(t2);
          await t2.query('begin');
          await actAs(t2, c, organization);
          const second = pending(cancelStatus(t2, a.id, back));
          await waitUntilBlocked(observer, pid, organization, second);

          await t1.query('commit');

          if (t1Changes === 'deactivates') {
            expect(await second.outcome).toEqual({ ok: true, rowCount: 0 });
          } else {
            expect(await second.outcome).toMatchObject({
              ok: false,
              code: '23514',
              message: 'ORGANIZATION_WOULD_HAVE_NO_ADMIN',
            });
          }
          await t2.query('rollback');

          const { rows } = await observer.query<{ active: boolean }>(
            `select active from member_status_versions where member_id = $1 and effective_from = $2::date`,
            [a.id, back],
          );
          expect(rows, "A's return was cancelled").toEqual([{ active: true }]);
        });
      },
    );
  }

  for (const t1Ends of ['commit', 'rollback'] as const) {
    it.skipIf(noDatabase)(
      t1Ends === 'commit'
        ? 'refuses a second scheduled team move for one member on another date'
        : 'admits the same team move once the first is rolled back (the control)',
      async () => {
        const { organization, a, b, member, team, first, later } = await fixture(async (client) => {
          const organization = await addOrganization(client);
          const a = await addAccount(client, organization, 'admin');
          return {
            organization,
            a,
            b: await addAccount(client, organization, 'admin'),
            member: await addAccount(client, organization, 'member_role'),
            team: await addTeam(client, organization, a.authUserId),
            first: await organizationDay(client, organization, 3),
            later: await organizationDay(client, organization, 5),
          };
        });

        await race(async (t1, t2, observer) => {
          await t1.query('begin');
          await actAs(t1, a, organization);
          expect(
            (await insertMembership(t1, { organization, member: member.id, team, from: first }))
              .rowCount,
          ).toBe(1);

          const pid = await backendPid(t2);
          await t2.query('begin');
          await actAs(t2, b, organization);
          const second = pending(
            insertMembership(t2, { organization, member: member.id, team, from: later }),
          );
          await waitUntilBlocked(observer, pid, organization, second);

          await t1.query(t1Ends);

          if (t1Ends === 'commit') {
            // One scheduled version at most: after the lock, 0010's volatile
            // reader sees T1's version dated after today.
            expect(await second.outcome).toMatchObject({ ok: false, code: '42501' });
          } else {
            expect(await second.outcome).toEqual({ ok: true, rowCount: 1 });
          }
        });
      },
    );
  }
});

describe('every write verb 0023 names waits on the lock', () => {
  it.skipIf(noDatabase)('makes a members insert wait', async () => {
    const { organization, a, b, member, user, from } = await fixture(async (client) => {
      const organization = await addOrganization(client);
      return {
        organization,
        a: await addAccount(client, organization, 'admin'),
        b: await addAccount(client, organization, 'admin'),
        member: await addAccount(client, organization, 'member_role'),
        user: await addUser(client),
        from: await organizationDay(client, organization, 2),
      };
    });

    await race(async (t1, t2, observer) => {
      await t1.query('begin');
      await actAs(t1, a, organization);
      await insertStatus(t1, { organization, member: member.id, active: false, from });

      const pid = await backendPid(t2);
      await t2.query('begin');
      await actAs(t2, b, organization);
      const second = pending(
        t2.query(
          `insert into members (organization_id, auth_user_id, name, username, role, leave_allowance_days)
           values ($1, $2, $3, $3, 'member_role', 0)`,
          [organization, user.id, user.label],
        ),
      );
      await waitUntilBlocked(observer, pid, organization, second);

      await t1.query('rollback');
      expect(await second.outcome).toEqual({ ok: true, rowCount: 1 });
    });
  });

  it.skipIf(noDatabase)('makes a team membership cancellation wait', async () => {
    const { organization, a, b, member, from, scheduled } = await fixture(async (client) => {
      const organization = await addOrganization(client);
      const a = await addAccount(client, organization, 'admin');
      const member = await addAccount(client, organization, 'member_role');
      const team = await addTeam(client, organization, a.authUserId);
      const scheduled = await organizationDay(client, organization, 4);
      await client.query(
        `insert into team_membership_versions (organization_id, member_id, team_id, effective_from, created_by)
         values ($1, $2, $3, $4::date, $5)`,
        [organization, member.id, team, scheduled, a.authUserId],
      );
      return {
        organization,
        a,
        b: await addAccount(client, organization, 'admin'),
        member,
        from: await organizationDay(client, organization, 2),
        scheduled,
      };
    });

    await race(async (t1, t2, observer) => {
      await t1.query('begin');
      await actAs(t1, a, organization);
      await insertStatus(t1, { organization, member: member.id, active: false, from });

      const pid = await backendPid(t2);
      await t2.query('begin');
      await actAs(t2, b, organization);
      const second = pending(
        t2.query(
          'delete from team_membership_versions where member_id = $1 and effective_from = $2::date',
          [member.id, scheduled],
        ),
      );
      await waitUntilBlocked(observer, pid, organization, second);

      await t1.query('rollback');
      expect(await second.outcome).toEqual({ ok: true, rowCount: 1 });
    });
  });

  it.skipIf(noDatabase)('declares each trigger on the events and level it is proved for', async () => {
    // `pg_trigger.tgtype` bits: 1 row, 2 before, 4 insert, 8 delete, 16 update,
    // 32 truncate. The lock is STATEMENT level and BEFORE, which is what makes
    // it deadlock-free; `members` names `role` alone among updates.
    const client = await connect();
    try {
      const { rows } = await client.query<{
        table: string;
        trigger: string;
        type: number;
        columns: string[] | null;
      }>(
        `select c.relname as table, t.tgname as trigger, t.tgtype::int as type,
                (select array_agg(a.attname::text order by a.attname)
                   from pg_attribute a
                  where a.attrelid = t.tgrelid and a.attnum = any (t.tgattr)) as columns
           from pg_trigger t
           join pg_class c on c.oid = t.tgrelid
          where not t.tgisinternal
            and c.relnamespace = 'public'::regnamespace
            and t.tgfoid in (
              'public.serialize_organization_writes()'::regprocedure,
              'public.refuse_status_version_leaving_no_admin()'::regprocedure,
              'public.refuse_truncate()'::regprocedure
            )
          order by 1, 2`,
      );
      expect(rows).toEqual([
        { table: 'member_status_versions', trigger: 'member_status_versions_keeps_an_admin', type: 1 | 4 | 8, columns: null },
        { table: 'member_status_versions', trigger: 'member_status_versions_refuse_truncate', type: 2 | 32, columns: null },
        { table: 'member_status_versions', trigger: 'member_status_versions_serialize_organization_writes', type: 2 | 4 | 8 | 16, columns: null },
        { table: 'members', trigger: 'members_refuse_truncate', type: 2 | 32, columns: null },
        { table: 'members', trigger: 'members_serialize_organization_writes', type: 2 | 4 | 8 | 16, columns: ['role'] },
        { table: 'team_membership_versions', trigger: 'team_membership_versions_refuse_truncate', type: 2 | 32, columns: null },
        { table: 'team_membership_versions', trigger: 'team_membership_versions_serialize_organization_writes', type: 2 | 4 | 8 | 16, columns: null },
      ]);
    } finally {
      await client.end();
    }
  });
});

describe('writes to different organizations do not wait for each other', () => {
  it.skipIf(noDatabase)(
    'lets a second organization write while the first holds its lock',
    async () => {
      const setup = await fixture(async (client) => {
        const x = await addOrganization(client);
        const y = await addOrganization(client);
        return {
          x,
          y,
          adminX: await addAccount(client, x, 'admin'),
          adminY: await addAccount(client, y, 'admin'),
          memberX: await addAccount(client, x, 'member_role'),
          memberY: await addAccount(client, y, 'member_role'),
          fromX: await organizationDay(client, x, 2),
          fromY: await organizationDay(client, y, 2),
        };
      });
      const { x, y, adminX, adminY, memberX, memberY, fromX, fromY } = setup;

      await race(async (t1, t2, observer) => {
        const t1pid = await backendPid(t1);
        await t1.query('begin');
        await actAs(t1, adminX, x);
        await insertStatus(t1, { organization: x, member: memberX.id, active: false, from: fromX });

        // T1 really holds X's key, so the control is not vacuous.
        expect(await advisoryKeyLock(observer, t1pid, x, true), 'T1 took no lock on X').toBe(true);

        await t2.query('begin');
        await actAs(t2, adminY, y);
        const second = pending(
          insertStatus(t2, { organization: y, member: memberY.id, active: false, from: fromY }),
        );

        // A deadline, not an ordering: a T2 that waited on T1 would never
        // finish while T1 is open, and this turns that hang into a failure.
        let timer: ReturnType<typeof setTimeout> | undefined;
        const outcome = await Promise.race([
          second.outcome,
          new Promise<'waited'>((resolve) => {
            timer = setTimeout(() => resolve('waited'), BLOCK_DEADLINE_MS);
          }),
        ]);
        clearTimeout(timer);

        expect(outcome, 'a write to another organization waited on this one').toEqual({
          ok: true,
          rowCount: 1,
        });
      });
    },
    LONG_CASE_MS,
  );
});

describe('an owner cascade and a request write cannot deadlock', () => {
  it.skipIf(noDatabase)(
    'lets an owner delete a member that a waiting request write then refers to',
    async () => {
      // THE ORDER A ROW-LEVEL LOCK DEADLOCKED ON. T1 (a request) holds the
      // organization's lock. The owner deletes member Q, cascading, and holds
      // Q's row. T1 then writes a version for Q, whose FK needs Q's row. Had
      // the owner's delete waited on the advisory lock while holding Q, this
      // was a cycle, 40P01. The owner takes no advisory lock, so T1 simply
      // waits for Q and then meets the delete: 23503.
      const { organization, a, p, q, from } = await fixture(async (client) => {
        const organization = await addOrganization(client);
        return {
          organization,
          a: await addAccount(client, organization, 'admin'),
          p: await addAccount(client, organization, 'member_role'),
          q: await addAccount(client, organization, 'member_role'),
          from: await organizationDay(client, organization, 2),
        };
      });

      await race(async (t1, owner, observer) => {
        const t1pid = await backendPid(t1);
        const ownerPid = await backendPid(owner);
        await t1.query('begin');
        await actAs(t1, a, organization);
        await insertStatus(t1, { organization, member: p.id, active: false, from });

        await owner.query('begin');
        const removal = pending(owner.query('delete from members where id = $1', [q.id]));
        await untilSettledOrWaiting(observer, ownerPid, removal);

        const write = pending(insertStatus(t1, { organization, member: q.id, active: false, from }));
        await untilSettledOrWaiting(observer, t1pid, write);

        if (removal.settled()) {
          await owner.query('commit');
        }
        // Whichever settles first; a deadlock resolves one of them with 40P01.
        const outcomes = await Promise.all([removal.outcome, write.outcome]);

        expect(outcomes.map((outcome) => (outcome.ok ? 'ok' : outcome.code))).not.toContain('40P01');
        expect(outcomes[0], "the owner's delete").toEqual({ ok: true, rowCount: 1 });
        expect(outcomes[1], 'the write meets the committed delete').toMatchObject({
          ok: false,
          code: '23503',
        });
      });
    },
    LONG_CASE_MS,
  );

  it.skipIf(noDatabase)(
    'lets an owner delete the organization while a request write is in flight',
    async () => {
      const { organization, a, p, from } = await fixture(async (client) => {
        const organization = await addOrganization(client);
        return {
          organization,
          a: await addAccount(client, organization, 'admin'),
          p: await addAccount(client, organization, 'member_role'),
          from: await organizationDay(client, organization, 2),
        };
      });

      await race(async (t1, owner, observer) => {
        const ownerPid = await backendPid(owner);
        await t1.query('begin');
        await actAs(t1, a, organization);
        await insertStatus(t1, { organization, member: p.id, active: false, from });

        await owner.query('begin');
        const removal = pending(owner.query('delete from organizations where id = $1', [organization]));
        await untilSettledOrWaiting(observer, ownerPid, removal);

        await t1.query('commit');
        expect(await removal.outcome, 'the cascade ended, without 40P01').toEqual({
          ok: true,
          rowCount: 1,
        });
        await owner.query('commit');
      });
    },
    LONG_CASE_MS,
  );
});

describe('TRUNCATE is refused where row rules would be bypassed', () => {
  it.skipIf(noDatabase).each([
    { statement: 'truncate member_status_versions', table: 'member_status_versions' },
    { statement: 'truncate team_membership_versions', table: 'team_membership_versions' },
    // A cascade reaches all three; whichever trigger fires first refuses it.
    { statement: 'truncate members cascade', table: null },
  ])('refuses `$statement` with TRUNCATE_REFUSED', async ({ statement, table }) => {
    // Rolled back whether or not it is refused, so a regression empties nothing.
    // The lock timeout keeps a TRUNCATE's ACCESS EXCLUSIVE from stalling other
    // sessions on the shared stack: this case fails instead of queueing.
    const client = await connect();
    try {
      await client.query('begin');
      await client.query(`set local lock_timeout = '1s'`);
      let raised: { code?: string; message?: string; detail?: string } | undefined;
      try {
        await client.query(statement);
      } catch (cause) {
        raised = cause as { code?: string; message?: string; detail?: string };
      }
      expect(raised, `${statement} was permitted`).toBeDefined();
      expect(raised?.message).toBe('TRUNCATE_REFUSED');
      expect(raised?.code).toBe('23001');
      expect(
        table === null
          ? ['members', 'member_status_versions', 'team_membership_versions']
          : [table],
        'the refusal names the table the rules live on',
      ).toContain(raised?.detail);
    } finally {
      await client.query('rollback').catch(() => undefined);
      await client.end();
    }
  });
});
