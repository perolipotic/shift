import { createHash } from 'node:crypto';

import type { Client } from 'pg';
import { describe, expect, it } from 'vitest';

import { PARITY_VECTOR } from '../packages/domain/parity/fixtures.js';

import { FIXTURES, inRolledBackTransaction, noDatabase, organizationId, refused, type Refusal } from './database.ts';

/**
 * Story 16.3 (0067): a member's feed token is a revocable secret (D-S1, AD-14,
 * AD-11). A database suite, run in CI on its fresh stack (written unrun: the
 * shared local stack never has a migration applied by a story).
 *
 * Every case runs in ONE rolled-back transaction, with claims injected
 * (`request.jwt.claims` and `set local role`), so nothing is committed and no
 * GoTrue token is issued (no PostgREST clock to warm up). Every scene a case
 * builds as the owner is built before its first `actAs`, or after an explicit
 * `actAsOwner`.
 */

/** The token vector's SHA-256, pinned as `test/runtime-parity.test.ts` pins it (16.2): the SQL hash must equal WebCrypto's. */
const PARITY_VECTOR_DIGEST = '2375020bdd6e9ec86da48c727c62d31ca48a92d7ae541c1b47e8b9ec67dcc232';

/** 0067's canonical token: 43 unpadded base64url characters whose last one carries no stray bits. */
const CANONICAL_TOKEN = /^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/;

interface Member {
  readonly id: string;
  readonly authUserId: string;
  readonly organizationId: string;
}

async function member(client: Client, slug: string, username: string): Promise<Member> {
  const { rows } = await client.query<Member>(
    `select m.id, m.auth_user_id as "authUserId", m.organization_id as "organizationId"
       from members m join organizations o on o.id = m.organization_id
      where o.slug = $1 and m.username = $2`,
    [slug, username],
  );
  const found = rows[0];
  if (found === undefined) throw new Error(`no member ${username} in ${slug}`);
  return found;
}

/** An authenticated caller of `organization`, or a claimless one with `null`. */
async function actAs(client: Client, authUserId: string, organization: string | null): Promise<void> {
  const claims =
    organization === null
      ? { sub: authUserId, role: 'authenticated' }
      : { sub: authUserId, role: 'authenticated', organization_id: organization };
  await client.query('select set_config($1, $2, true)', ['request.jwt.claims', JSON.stringify(claims)]);
  await client.query('set local role authenticated');
}

/** What PostgREST does with the publishable key and no session. */
async function actAsAnon(client: Client): Promise<void> {
  await client.query('select set_config($1, $2, true)', ['request.jwt.claims', JSON.stringify({ role: 'anon' })]);
  await client.query('set local role anon');
}

async function actAsOwner(client: Client): Promise<void> {
  await client.query('reset role');
  await client.query("select set_config('request.jwt.claims', '', true)");
}

/**
 * `refused`, for a case that goes on afterwards: a raised error aborts the
 * transaction, so the probe takes a savepoint and rolls back to it, keeping
 * the claims and role set before it (`test/rls-isolation.test.ts`'s helper).
 */
async function refusedThenContinue(client: Client, work: () => Promise<unknown>): Promise<Refusal> {
  await client.query('savepoint refusal_probe');
  try {
    return await refused(work);
  } finally {
    await client.query('rollback to savepoint refusal_probe').catch(() => undefined);
  }
}

/**
 * A status version as an admin session writes it: the four columns 0008
 * grants, `created_by` taken from its default (`auth.uid()`). `plusDays` from
 * the organization's today.
 */
async function insertStatusVersion(client: Client, who: Member, active: boolean, plusDays: number): Promise<string> {
  const { rows } = await client.query<{ id: string }>(
    `insert into member_status_versions (organization_id, member_id, active, effective_from)
     values ($1, $2, $3, organization_today($1) + $4::int) returning id`,
    [who.organizationId, who.id, active, plusDays],
  );
  const id = rows[0]?.id;
  if (id === undefined) throw new Error('member_status_versions insert returned no row');
  return id;
}

/** Owner scene: an account and a member row (no team), never signed in. */
async function addAccount(client: Client, organization: string, role: 'admin' | 'member_role'): Promise<Member> {
  const { rows: account } = await client.query<{ id: string }>(
    `insert into auth.users (instance_id, id, aud, role, email, email_confirmed_at, created_at, updated_at)
     values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
             gen_random_uuid()::text || '@feed-token-test.shift.invalid', now(), now(), now())
     returning id`,
  );
  const authUserId = account[0]?.id;
  if (authUserId === undefined) throw new Error('auth.users insert returned no row');
  const { rows: created } = await client.query<{ id: string }>(
    `insert into members (organization_id, auth_user_id, name, username, role, leave_allowance_days)
     values ($1, $2::uuid, 'Feed token test', $2::uuid::text, $3, 20) returning id`,
    [organization, authUserId, role],
  );
  const id = created[0]?.id;
  if (id === undefined) throw new Error('members insert returned no row');
  return { id, authUserId, organizationId: organization };
}

const hexOf = (token: string): string => createHash('sha256').update(token, 'utf8').digest('hex');

async function createToken(client: Client, who: Member): Promise<string> {
  await actAs(client, who.authUserId, who.organizationId);
  const { rows } = await client.query<{ token: string }>('select public.create_calendar_feed_token() as token');
  await actAsOwner(client);
  const token = rows[0]?.token;
  if (token === undefined) throw new Error('create_calendar_feed_token returned no row');
  return token;
}

/** The lookup as `anon`, back to the owner after. */
async function lookup(client: Client, hash: string | null): Promise<Record<string, unknown> | null> {
  await actAsAnon(client);
  const { rows } = await client.query<{ answer: Record<string, unknown> | null }>(
    'select public.calendar_feed_inputs($1) as answer',
    [hash],
  );
  await actAsOwner(client);
  return rows[0]?.answer ?? null;
}

interface TokenRow {
  readonly id: string;
  readonly hash: string;
  readonly removedAt: string | null;
  readonly removedBy: string | null;
  readonly lastFetchedAt: string | null;
}

async function tokensOf(client: Client, who: Member): Promise<TokenRow[]> {
  const { rows } = await client.query<TokenRow>(
    `select id, encode(token_hash, 'hex') as hash, removed_at::text as "removedAt", removed_by as "removedBy",
            last_fetched_at::text as "lastFetchedAt"
       from calendar_feed_tokens
      where organization_id = $1 and member_id = $2
      order by removed_at is null, created_at, id`,
    [who.organizationId, who.id],
  );
  return rows;
}

async function today(client: Client, organization: string, plusDays = 0): Promise<string> {
  const { rows } = await client.query<{ day: string }>('select (organization_today($1) + $2::int)::text as day', [
    organization,
    plusDays,
  ]);
  const day = rows[0]?.day;
  if (day === undefined) throw new Error('organization_today returned no row');
  return day;
}

describe('the feed token table (0067)', () => {
  it.skipIf(noDatabase)('gives no session role any table or column privilege, token_hash included (D-S1)', async () => {
    await inRolledBackTransaction(async (client) => {
      const { rows } = await client.query<{ grant: string }>(
        `select role || ':' || privilege as grant
           from unnest(array['anon', 'authenticated', 'service_role']) as role,
                unnest(array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) as privilege
          where has_table_privilege(role, 'public.calendar_feed_tokens', privilege)`,
      );
      expect(rows, 'a session role holds a table privilege').toEqual([]);
      const { rows: columns } = await client.query<{ grant: string }>(
        `select role || ':' || verb || ':' || attname as grant
           from unnest(array['anon', 'authenticated', 'service_role']) as role,
                (select attname from pg_attribute
                  where attrelid = 'public.calendar_feed_tokens'::regclass and attnum > 0 and not attisdropped) as attributes,
                unnest(array['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']) as verb
          where has_column_privilege(role, 'public.calendar_feed_tokens', attname, verb)`,
      );
      expect(columns, 'a session role holds a column privilege').toEqual([]);
      const { rows: security } = await client.query<{ enabled: boolean; forced: boolean; policies: number }>(
        `select c.relrowsecurity as enabled, c.relforcerowsecurity as forced,
                (select count(*)::int from pg_policies p where p.schemaname = 'public' and p.tablename = 'calendar_feed_tokens') as policies
           from pg_class c where c.oid = 'public.calendar_feed_tokens'::regclass`,
      );
      expect(security).toEqual([{ enabled: true, forced: false, policies: 0 }]);
      const { rows: columnsInOrder } = await client.query<{ name: string }>(
        `select column_name as name from information_schema.columns
          where table_schema = 'public' and table_name = 'calendar_feed_tokens' order by ordinal_position`,
      );
      expect(columnsInOrder.map((row) => row.name)).toEqual([
        'organization_id', 'id', 'member_id', 'token_hash', 'created_by', 'created_at', 'removed_by', 'removed_at', 'last_fetched_at',
      ]);
      const { rows: triggers } = await client.query<{ definition: string }>(
        `select pg_get_triggerdef(oid) as definition from pg_trigger
          where (tgrelid = 'public.calendar_feed_tokens'::regclass or tgname = 'member_status_versions_revoke_calendar_feed')
            and not tgisinternal
          order by 1`,
      );
      expect(triggers.map((row) => row.definition)).toEqual([
        'CREATE TRIGGER calendar_feed_tokens_audit AFTER INSERT OR DELETE ON public.calendar_feed_tokens FOR EACH ROW EXECUTE FUNCTION private.record_calendar_feed_token_event()',
        "CREATE TRIGGER calendar_feed_tokens_audit_update AFTER UPDATE ON public.calendar_feed_tokens FOR EACH ROW WHEN (((to_jsonb(old.*) - 'last_fetched_at'::text) IS DISTINCT FROM (to_jsonb(new.*) - 'last_fetched_at'::text))) EXECUTE FUNCTION private.record_calendar_feed_token_event()",
        'CREATE TRIGGER member_status_versions_revoke_calendar_feed AFTER INSERT ON public.member_status_versions FOR EACH ROW EXECUTE FUNCTION private.revoke_calendar_feed_on_status_change()',
      ]);
    });
  });

  it.skipIf(noDatabase).each(['anon', 'authenticated', 'service_role'])('refuses %s a direct read of the table', async (role) => {
    await inRolledBackTransaction(async (client) => {
      await client.query(`set local role ${role}`);
      const refusal = await refused(() => client.query('select token_hash from calendar_feed_tokens'));
      expect(refusal.code).toBe('42501');
    });
  });

  it.skipIf(noDatabase)('stores the pinned vector as the SHA-256 of its text, and the lookup finds it by lowercase hex alone', async () => {
    const pilot = FIXTURES[0];
    await inRolledBackTransaction(async (client) => {
      const who = await member(client, pilot.slug, pilot.member);
      expect(hexOf(PARITY_VECTOR)).toBe(PARITY_VECTOR_DIGEST);
      const { rows } = await client.query<{ hash: string }>(
        `insert into calendar_feed_tokens (organization_id, member_id, token_hash, created_by)
         values ($1, $2, sha256(convert_to($3, 'UTF8')), $4)
         returning encode(token_hash, 'hex') as hash`,
        [who.organizationId, who.id, PARITY_VECTOR, who.authUserId],
      );
      expect(rows[0]?.hash, 'SQL hashes the vector differently from WebCrypto').toBe(PARITY_VECTOR_DIGEST);

      const hit = await lookup(client, PARITY_VECTOR_DIGEST);
      expect(hit?.['window']).toEqual({ from: await today(client, who.organizationId, -31), to: await today(client, who.organizationId, 182) });
      expect((hit?.['inputs'] as Record<string, unknown> | undefined)?.['memberId']).toBe(who.id);
      expect(Object.keys(hit ?? {}).sort()).toEqual(['inputs', 'window']);

      // Every malformed answer is the one null: upper case, short, long, not hex, null.
      for (const malformed of [PARITY_VECTOR_DIGEST.toUpperCase(), PARITY_VECTOR_DIGEST.slice(1), `${PARITY_VECTOR_DIGEST}0`, PARITY_VECTOR, null]) {
        expect(await lookup(client, malformed), `${String(malformed)} was looked up`).toBeNull();
      }
      expect(await lookup(client, hexOf(`${PARITY_VECTOR.slice(0, 42)}E`)), 'an unknown token hit').toBeNull();
    });
  });
});

describe.each(FIXTURES)('a $fixture member\'s feed token (0067)', ({ slug, admin, member: memberName, bystander }) => {
  it.skipIf(noDatabase)('is 43 canonical base64url characters, returned once, stored only as its hash, one live at a time', async () => {
    await inRolledBackTransaction(async (client) => {
      const who = await member(client, slug, memberName);
      const first = await createToken(client, who);
      expect(first).toMatch(CANONICAL_TOKEN);
      const second = await createToken(client, who);
      expect(second).toMatch(CANONICAL_TOKEN);
      expect(second).not.toBe(first);

      const rows = await tokensOf(client, who);
      expect(rows.map((row) => row.hash)).toEqual([hexOf(first), hexOf(second)]);
      expect(rows.filter((row) => row.removedAt === null), 'more than one token is live').toHaveLength(1);
      expect(rows[0]?.removedBy, 'the regeneration is not the member\'s').toBe(who.authUserId);

      expect(await lookup(client, hexOf(first)), 'a replaced token still works').toBeNull();
      expect(await lookup(client, hexOf(second))).not.toBeNull();

      // The table holds no column the token text could be read back from.
      const { rows: text } = await client.query<{ found: number }>(
        `select count(*)::int as found from calendar_feed_tokens t where position($1 in to_jsonb(t)::text) > 0`,
        [second],
      );
      expect(text[0]?.found).toBe(0);
    });
  });

  it.skipIf(noDatabase)('answers its state as live, created_at and last_fetched_at only, and turns off at once', async () => {
    await inRolledBackTransaction(async (client) => {
      const who = await member(client, slug, memberName);
      const read = async (): Promise<Record<string, unknown>> => {
        await actAs(client, who.authUserId, who.organizationId);
        const { rows } = await client.query<{ state: Record<string, unknown> }>('select public.calendar_feed_status() as state');
        await actAsOwner(client);
        return rows[0]?.state ?? {};
      };
      expect(await read()).toEqual({ live: false, created_at: null, last_fetched_at: null });

      const token = await createToken(client, who);
      const live = await read();
      expect(Object.keys(live).sort()).toEqual(['created_at', 'last_fetched_at', 'live']);
      expect(live['live']).toBe(true);
      expect(live['created_at']).not.toBeNull();
      expect(live['last_fetched_at']).toBeNull();

      await lookup(client, hexOf(token));
      expect((await read())['last_fetched_at'], 'a fetch is not stamped').not.toBeNull();

      await actAs(client, who.authUserId, who.organizationId);
      await client.query('select public.revoke_own_calendar_feed_token()');
      // Turning off what is off is no error.
      await client.query('select public.revoke_own_calendar_feed_token()');
      await actAsOwner(client);
      expect(await lookup(client, hexOf(token)), 'a turned-off token still works').toBeNull();
      expect(await read()).toEqual({ live: false, created_at: null, last_fetched_at: null });
    });
  });

  it.skipIf(noDatabase)('stamps a fetch at most every 15 minutes, and a stamp alone records no history', async () => {
    await inRolledBackTransaction(async (client) => {
      const who = await member(client, slug, memberName);
      const token = await createToken(client, who);
      const [row] = await tokensOf(client, who);
      if (row === undefined) throw new Error('no token row');
      const events = async (): Promise<number> => {
        const { rows } = await client.query<{ count: number }>(
          `select count(*)::int as count from audit_events where table_name = 'calendar_feed_tokens' and row_id = $1`,
          [row.id],
        );
        return rows[0]?.count ?? 0;
      };
      const before = await events();
      expect(before, 'the creation is not recorded under the token\'s id').toBe(1);

      await client.query(`update calendar_feed_tokens set last_fetched_at = now() - interval '5 minutes' where id = $1`, [row.id]);
      const recent = (await tokensOf(client, who))[0]?.lastFetchedAt;
      await lookup(client, hexOf(token));
      expect((await tokensOf(client, who))[0]?.lastFetchedAt, 'a fetch within 15 minutes wrote the stamp').toBe(recent);

      await client.query(`update calendar_feed_tokens set last_fetched_at = now() - interval '20 minutes' where id = $1`, [row.id]);
      await lookup(client, hexOf(token));
      const { rows: stamped } = await client.query<{ fresh: boolean }>(
        'select last_fetched_at = now() as fresh from calendar_feed_tokens where id = $1',
        [row.id],
      );
      expect(stamped[0]?.fresh, 'a fetch after 15 minutes did not stamp').toBe(true);
      expect(await events(), 'a fetch stamp recorded a change').toBe(before);
    });
  });

  it.skipIf(noDatabase)('records create and revoke in the change history with no token or hash material (AD-11)', async () => {
    await inRolledBackTransaction(async (client) => {
      const who = await member(client, slug, memberName);
      const first = await createToken(client, who);
      const second = await createToken(client, who);
      await actAs(client, who.authUserId, who.organizationId);
      await client.query('select public.revoke_own_calendar_feed_token()');
      await actAsOwner(client);

      const { rows } = await client.query<{
        operation: string;
        rowId: string;
        actor: string | null;
        oldRow: Record<string, unknown> | null;
        newRow: Record<string, unknown> | null;
        text: string;
      }>(
        `select operation, row_id as "rowId", actor, old_row as "oldRow", new_row as "newRow",
                coalesce(old_row::text, '') || coalesce(new_row::text, '') as text
           from audit_events
          where table_name = 'calendar_feed_tokens' and organization_id = $1
            and coalesce(new_row, old_row) ->> 'member_id' = $2
          order by id`,
        [who.organizationId, who.id],
      );
      expect(rows.map((row) => row.operation)).toEqual(['INSERT', 'UPDATE', 'INSERT', 'UPDATE']);
      for (const row of rows) {
        for (const recorded of [row.newRow, row.oldRow]) {
          expect(Object.keys(recorded ?? {}), 'an audit row holds the hash').not.toContain('token_hash');
          expect(Object.keys(recorded ?? {}), 'an audit row holds a fetch').not.toContain('last_fetched_at');
        }
        for (const secret of [first, second, hexOf(first), hexOf(second)]) {
          expect(row.text.includes(secret), 'an audit row holds token material').toBe(false);
        }
      }
      expect(rows[1]?.newRow?.['removed_at']).not.toBeNull();

      // Each event names its token and its author (both tokens share one `now()`, so match by hash).
      const idOf = new Map((await tokensOf(client, who)).map((token) => [token.hash, token.id]));
      expect(rows.map((row) => row.rowId)).toEqual([
        idOf.get(hexOf(first)),
        idOf.get(hexOf(first)),
        idOf.get(hexOf(second)),
        idOf.get(hexOf(second)),
      ]);
      expect(rows.map((row) => row.actor)).toEqual([who.authUserId, who.authUserId, who.authUserId, who.authUserId]);
    });
  });

  it.skipIf(noDatabase)('is not served, nor read as live, for an account that is banned or deleted', async () => {
    await inRolledBackTransaction(async (client) => {
      const who = await member(client, slug, memberName);
      const own = await member(client, slug, admin);
      const token = await createToken(client, who);
      const adminRead = async (): Promise<Record<string, unknown>> => {
        await actAs(client, own.authUserId, own.organizationId);
        const { rows } = await client.query<{ state: Record<string, unknown> }>('select public.member_calendar_feed_status($1) as state', [who.id]);
        await actAsOwner(client);
        return rows[0]?.state ?? {};
      };
      expect((await adminRead())['live']).toBe(true);

      for (const [column, value] of [
        ['banned_until', "now() + interval '1 day'"],
        ['deleted_at', 'now()'],
      ] as const) {
        // Owner scene: the account is banned (or deleted), then restored.
        await client.query(`update auth.users set ${column} = ${value} where id = $1`, [who.authUserId]);
        expect(await lookup(client, hexOf(token)), `a ${column} account's feed was served`).toBeNull();
        expect(await adminRead(), `a ${column} account's feed reads as live`).toEqual({ live: false, created_at: null, last_fetched_at: null });
        await client.query(`update auth.users set ${column} = null where id = $1`, [who.authUserId]);
      }
      // A ban that has passed is no ban (current_member_access()'s clause).
      await client.query("update auth.users set banned_until = now() - interval '1 day' where id = $1", [who.authUserId]);
      expect(await lookup(client, hexOf(token)), 'a lapsed ban still blocks the feed').not.toBeNull();
    });
  });

  it.skipIf(noDatabase)('records no hash in the history for an admin revoke, a deactivation revoke or a cascaded delete', async () => {
    await inRolledBackTransaction(async (client) => {
      const own = await member(client, slug, admin);
      // Owner scene, before any actAs: a disposable account whose member row is deleted below.
      const who = await addAccount(client, own.organizationId, 'member_role');
      const tokens = [await createToken(client, who)];
      await actAs(client, own.authUserId, own.organizationId);
      await client.query('select public.revoke_member_calendar_feed_token($1)', [who.id]);
      await actAsOwner(client);
      tokens.push(await createToken(client, who));
      await actAs(client, own.authUserId, own.organizationId);
      await insertStatusVersion(client, who, false, 0);
      await actAsOwner(client);
      // Owner scene: a reactivation (so a token may be made again), then the member is deleted.
      await client.query('delete from member_status_versions where member_id = $1', [who.id]);
      tokens.push(await createToken(client, who));
      const hashes = (await tokensOf(client, who)).map((row) => row.hash);
      expect(hashes).toHaveLength(3);
      await client.query('delete from members where id = $1', [who.id]);

      const { rows } = await client.query<{ operation: string; actor: string | null; keys: string[]; text: string }>(
        `select operation, actor,
                array(select jsonb_object_keys(coalesce(new_row, '{}'::jsonb) || coalesce(old_row, '{}'::jsonb))) as keys,
                coalesce(old_row::text, '') || coalesce(new_row::text, '') as text
           from audit_events
          where table_name = 'calendar_feed_tokens' and organization_id = $1
            and coalesce(new_row, old_row) ->> 'member_id' = $2
          order by id`,
        [who.organizationId, who.id],
      );
      expect(rows.map((row) => row.operation)).toEqual(['INSERT', 'UPDATE', 'INSERT', 'UPDATE', 'INSERT', 'DELETE', 'DELETE', 'DELETE']);
      expect(rows[1]?.actor, 'the admin revoke is not the admin\'s').toBe(own.authUserId);
      expect(rows[3]?.actor, 'the deactivation revoke is not the author\'s').toBe(own.authUserId);
      for (const row of rows) {
        expect(row.keys, `a ${row.operation} audit row holds the hash`).not.toContain('token_hash');
        expect(row.keys, `a ${row.operation} audit row holds a fetch`).not.toContain('last_fetched_at');
        for (const secret of [...tokens, ...hashes]) {
          expect(row.text.includes(secret), `a ${row.operation} audit row holds token material`).toBe(false);
        }
      }
    });
  });

  it.skipIf(noDatabase)('lets an admin of the organization read and turn it off, never see it, and reach no other organization', async () => {
    const other = FIXTURES.find((fixture) => fixture.slug !== slug);
    if (other === undefined) throw new Error('one fixture only');
    await inRolledBackTransaction(async (client) => {
      const who = await member(client, slug, memberName);
      const own = await member(client, slug, admin);
      const foreign = await member(client, other.slug, other.admin);
      const peer = await member(client, slug, bystander);
      const token = await createToken(client, who);

      await actAs(client, own.authUserId, own.organizationId);
      const { rows } = await client.query<{ state: Record<string, unknown> }>('select public.member_calendar_feed_status($1) as state', [who.id]);
      await actAsOwner(client);
      expect(Object.keys(rows[0]?.state ?? {}).sort(), 'the admin reads more than the state').toEqual(['created_at', 'last_fetched_at', 'live']);
      expect(rows[0]?.state['live']).toBe(true);

      // Another organization's admin: the one unknown-member answer, for the read and the revoke.
      await actAs(client, foreign.authUserId, foreign.organizationId);
      const readAcross = await refusedThenContinue(client, () => client.query('select public.member_calendar_feed_status($1)', [who.id]));
      expect(readAcross).toMatchObject({ code: 'P0002', message: 'CALENDAR_FEED_MEMBER_UNKNOWN' });
      await actAsOwner(client);
      await actAs(client, foreign.authUserId, foreign.organizationId);
      const revokeAcross = await refusedThenContinue(client, () => client.query('select public.revoke_member_calendar_feed_token($1)', [who.id]));
      expect(revokeAcross).toMatchObject({ code: 'P0002', message: 'CALENDAR_FEED_MEMBER_UNKNOWN' });
      await actAsOwner(client);
      expect(await lookup(client, hexOf(token)), 'another organization reached the token').not.toBeNull();

      // A member-role colleague may neither read nor revoke it.
      await actAs(client, peer.authUserId, peer.organizationId);
      const byPeer = await refusedThenContinue(client, () => client.query('select public.revoke_member_calendar_feed_token($1)', [who.id]));
      expect(byPeer).toMatchObject({ code: '42501', message: 'CALENDAR_FEED_REFUSED' });
      await actAsOwner(client);
      await actAs(client, peer.authUserId, peer.organizationId);
      const readByPeer = await refusedThenContinue(client, () => client.query('select public.member_calendar_feed_status($1)', [who.id]));
      expect(readByPeer).toMatchObject({ code: '42501', message: 'CALENDAR_FEED_REFUSED' });
      await actAsOwner(client);

      await actAs(client, own.authUserId, own.organizationId);
      await client.query('select public.revoke_member_calendar_feed_token($1)', [who.id]);
      // Nothing live is no error; no member, or none at all, is the one unknown answer.
      await client.query('select public.revoke_member_calendar_feed_token($1)', [who.id]);
      for (const unknown of [null, '00000000-0000-4000-8000-000000000000']) {
        for (const call of ['select public.revoke_member_calendar_feed_token($1)', 'select public.member_calendar_feed_status($1)']) {
          const refusal = await refusedThenContinue(client, () => client.query(call, [unknown]));
          expect(refusal, `${call} with ${String(unknown)}`).toMatchObject({ code: 'P0002', message: 'CALENDAR_FEED_MEMBER_UNKNOWN' });
        }
      }
      await actAsOwner(client);
      expect(await lookup(client, hexOf(token)), 'an admin-revoked token still works').toBeNull();
      expect((await tokensOf(client, who))[0]?.removedBy).toBe(own.authUserId);
    });
  });

  it.skipIf(noDatabase)('refuses a claimless caller, an inactive member and an inactive admin', async () => {
    await inRolledBackTransaction(async (client) => {
      const who = await member(client, slug, memberName);
      const own = await member(client, slug, admin);
      // Owner scene, before any actAs: a second admin, deactivated today.
      const former = await addAccount(client, own.organizationId, 'admin');
      await client.query(
        'insert into member_status_versions (organization_id, member_id, active, effective_from, created_by) values ($1, $2, false, organization_today($1), $3)',
        [former.organizationId, former.id, own.authUserId],
      );

      const memberCalls = [
        'select public.create_calendar_feed_token()',
        'select public.revoke_own_calendar_feed_token()',
        'select public.calendar_feed_status()',
      ];
      const adminCalls = ['select public.revoke_member_calendar_feed_token($1)', 'select public.member_calendar_feed_status($1)'];
      for (const call of [...memberCalls, ...adminCalls]) {
        await actAs(client, own.authUserId, null);
        const refusal = await refusedThenContinue(client, () => client.query(call, call.includes('$1') ? [who.id] : []));
        expect(refusal, `${call} served a claimless caller`).toMatchObject({ code: '42501', message: 'CALENDAR_FEED_REFUSED' });
        await actAsOwner(client);
      }
      for (const call of adminCalls) {
        await actAs(client, former.authUserId, former.organizationId);
        const refusal = await refusedThenContinue(client, () => client.query(call, [who.id]));
        expect(refusal, `${call} served a deactivated admin`).toMatchObject({ code: '42501', message: 'CALENDAR_FEED_REFUSED' });
        await actAsOwner(client);
      }

      // Deactivated today by their admin: none of the member's own calls.
      await actAs(client, own.authUserId, own.organizationId);
      await insertStatusVersion(client, who, false, 0);
      await actAsOwner(client);
      for (const call of memberCalls) {
        await actAs(client, who.authUserId, who.organizationId);
        const refusal = await refusedThenContinue(client, () => client.query(call));
        expect(refusal, `${call} served an inactive member`).toMatchObject({ code: '42501', message: 'CALENDAR_FEED_REFUSED' });
        await actAsOwner(client);
      }
    });
  });

  it.skipIf(noDatabase)('dies on a deactivation in effect when saved, on a scheduled one from its date, and stays dead after a reactivation', async () => {
    await inRolledBackTransaction(async (client) => {
      const who = await member(client, slug, memberName);
      const own = await member(client, slug, admin);

      // In effect when saved: revoked in the same transaction, by the version's author.
      const now = await createToken(client, who);
      await actAs(client, own.authUserId, own.organizationId);
      const deactivation = await insertStatusVersion(client, who, false, 0);
      await actAsOwner(client);
      const revoked = await tokensOf(client, who);
      expect(revoked.every((row) => row.removedAt !== null), 'a deactivation in effect left the token live').toBe(true);
      expect(revoked[0]?.removedBy).toBe(own.authUserId);
      expect(await lookup(client, hexOf(now))).toBeNull();

      // Owner scene: undo that deactivation (a scheduled one replaces it below).
      await client.query('delete from member_status_versions where id = $1', [deactivation]);

      // Scheduled for tomorrow: nothing revoked, the feed works today.
      const scheduled = await createToken(client, who);
      await actAs(client, own.authUserId, own.organizationId);
      const future = await insertStatusVersion(client, who, false, 1);
      await actAsOwner(client);
      expect((await tokensOf(client, who)).filter((row) => row.removedAt === null), 'a scheduled deactivation revoked at once').toHaveLength(1);
      expect(await lookup(client, hexOf(scheduled)), 'a scheduled deactivation ended the feed early').not.toBeNull();

      // Owner scene: its date arrives (the version is moved to today; no insert, so no trigger).
      await client.query('update member_status_versions set effective_from = organization_today(organization_id) where id = $1', [future]);
      expect(await lookup(client, hexOf(scheduled)), 'a deactivated member\'s feed still works').toBeNull();
      await actAs(client, own.authUserId, own.organizationId);
      const { rows: state } = await client.query<{ state: Record<string, unknown> }>('select public.member_calendar_feed_status($1) as state', [who.id]);
      await actAsOwner(client);
      expect(state[0]?.state).toEqual({ live: false, created_at: null, last_fetched_at: null });

      // A reactivation revokes the token still unrevoked, so it never works again.
      await actAs(client, own.authUserId, own.organizationId);
      await insertStatusVersion(client, who, true, 1);
      await actAsOwner(client);
      expect((await tokensOf(client, who)).filter((row) => row.removedAt === null), 'a reactivation left a token live').toEqual([]);
    });
  });
});

describe('a member with no team', () => {
  it.skipIf(noDatabase)('may hold a live feed (D-S1 ratification)', async () => {
    const pilot = FIXTURES[0];
    await inRolledBackTransaction(async (client) => {
      // Owner scene, before any actAs: an account and a member row with no team.
      const who = await addAccount(client, await organizationId(client, pilot.slug), 'member_role');
      const token = await createToken(client, who);
      const hit = await lookup(client, hexOf(token));
      expect((hit?.['inputs'] as Record<string, unknown> | undefined)?.['memberId']).toBe(who.id);
    });
  });
});
