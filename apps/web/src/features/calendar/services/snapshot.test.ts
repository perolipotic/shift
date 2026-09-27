import { readFileSync, readdirSync } from 'node:fs';
import { sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  QueryClient,
  QueryObserver,
  environmentManager,
  onlineManager,
} from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CALENDAR_COLUMNS,
  CALENDAR_COUNT,
  CALENDAR_FETCH_PAUSED,
  CALENDAR_KEY,
  CALENDAR_MEMBERS_FUNCTION,
  CALENDAR_OVERRIDES_FUNCTION,
  CALENDAR_READ_STALE_MS,
  CALENDAR_READ_TABLE,
  CALENDAR_UNAVAILABLE,
  CALENDAR_VIEWER_COLUMN,
  CALENDAR_VIEWER_OPERATOR,
  calendarMessageKey,
  calendarQueryOptions,
  calendarSurfaceStateOf,
  readCalendar,
  type CalendarAnswer,
  type CalendarMembersRpc,
  type CalendarSnapshot,
  type CalendarTable,
} from '@/features/calendar/services/snapshot';
import { CALENDAR_SCREEN_PARTS } from '@/features/calendar/calendar-screen.fixture';
import {
  OTHER_ORGANIZATION,
  PILOT,
  SEEDED,
  UJ5,
  VIEWER_AUTH_USER,
  VIEWER_MEMBER,
  VIEWER_NAME,
  assignmentRow,
  calendarOrganizationRow,
  calendarOverrideRow,
  calendarTableOf,
  memberMembershipRow,
  membershipRow,
  membersAnswerOf,
  overridesAnswerOf,
  calendarMemberRow,
  statusRow,
  stepRow,
  teamRow,
  typeRow,
  viewerRow,
  viewerSession,
  type FixtureRows,
} from '@/features/rotation/rotation.fixture';

/**
 * Story 3.1's read, executed rather than read (AD-15): the one select, the
 * parsing, the tenant tripwire, the query options and the surface state, over
 * both fixtures, with a real `QueryObserver`. Story 3.2a's viewer row: the
 * filter, the session and every bad-embed row of its matrix. Story 3.4a's
 * members: every member with rank, positions and status versions, and one
 * refusal per new validation.
 */

/** The organization as the calendar's read embeds it: the viewer's member row alone. */
function answerOf(rows: FixtureRows, viewers: readonly Record<string, unknown>[] | null = null): CalendarAnswer {
  return { data: [calendarOrganizationRow(rows, { viewers })], error: null, count: 1 };
}

type Source = CalendarTable & CalendarMembersRpc & { readonly seen: unknown[][] };

function tableOf(answer: CalendarAnswer, members: unknown = membersAnswerOf(), overrides: unknown = overridesAnswerOf()): Source {
  return calendarTableOf(answer, members, overrides);
}

const session = viewerSession();

/** `readCalendar` over one stub standing in for both the table and the members rpc. */
function read(source: Source, current: () => Promise<Session | null> = session) {
  return readCalendar(source, source, current);
}

async function snapshotOf(rows: FixtureRows): Promise<CalendarSnapshot> {
  const outcome = await read(tableOf(answerOf(rows)));

  if (!outcome.ok) throw new Error(outcome.code);

  return outcome.snapshot;
}

const quiet = () => vi.spyOn(console, 'error').mockImplementation(() => undefined);

const REFUSED = { ok: false, code: CALENDAR_UNAVAILABLE } as const;

describe('the read', () => {
  it.each([
    { fixture: 'pilot', rows: PILOT, teams: 4, types: 3, steps: 4 },
    { fixture: 'UJ-5', rows: UJ5, teams: 3, types: 4, steps: 5 },
  ])('$fixture: reads the organization and everything the month draws from in one exact-count select', async ({ rows, teams, types, steps }) => {
    const table = tableOf(answerOf(rows));
    const outcome = await read(table);

    expect(CALENDAR_READ_TABLE).toBe('organizations');
    expect(table.seen).toEqual([
      ['select', CALENDAR_COLUMNS, CALENDAR_COUNT],
      ['filter', 'members.auth_user_id', 'eq', VIEWER_AUTH_USER],
      ['rpc', 'calendar_members'],
      ['rpc', 'calendar_shift_type_overrides'],
    ]);
    expect(CALENDAR_MEMBERS_FUNCTION).toBe('calendar_members');
    expect(CALENDAR_OVERRIDES_FUNCTION).toBe('calendar_shift_type_overrides');
    expect([CALENDAR_VIEWER_COLUMN, CALENDAR_VIEWER_OPERATOR]).toEqual(['members.auth_user_id', 'eq']);
    expect(CALENDAR_COUNT).toEqual({ count: 'exact' });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.snapshot.overrides).toEqual([]);
    expect(outcome.snapshot.timeZone).toBe('Europe/Zagreb');
    expect(outcome.snapshot.usesFireRanks).toBe(false);
    expect(outcome.snapshot.teams).toHaveLength(teams);
    expect(outcome.snapshot.types).toHaveLength(types);
    expect(outcome.snapshot.steps).toHaveLength(steps);
    expect(outcome.snapshot.assignments).toHaveLength(teams);
    expect(outcome.snapshot.viewer).toEqual({
      memberId: VIEWER_MEMBER,
      role: 'member_role',
      memberships: [{ teamId: (rows.teams[0] as { id: string }).id, position: null, effectiveFrom: SEEDED }],
      statuses: [],
    });
    expect(outcome.snapshot.members).toEqual([
      {
        id: VIEWER_MEMBER,
        name: VIEWER_NAME,
        fireRank: null,
        memberships: [{ teamId: (rows.teams[0] as { id: string }).id, position: null, effectiveFrom: SEEDED }],
        statuses: [],
      },
    ]);
  });

  it('selects what a member may read and nothing more', () => {
    expect(CALENDAR_COLUMNS).toContain('teams(organization_id,id,name,archived)');
    expect(CALENDAR_COLUMNS).toContain('shift_types(');
    expect(CALENDAR_COLUMNS).toContain('shift_type_versions(');
    expect(CALENDAR_COLUMNS).toContain('rotation_steps(');
    expect(CALENDAR_COLUMNS).toContain('rotation_assignments(');
    // The viewer's own member row: its tenant, id, role and team history, and
    // nothing that names, ranks or positions a person.
    expect(CALENDAR_COLUMNS).toContain(
      'members(organization_id,id,role,team_membership_versions(organization_id,team_id,effective_from))',
    );
    const member = /members\(([^()]*)/.exec(CALENDAR_COLUMNS)?.[1] ?? '';

    expect(member).toBe('organization_id,id,role,team_membership_versions');
    expect(/team_membership_versions\(([^)]*)\)/.exec(CALENDAR_COLUMNS)?.[1]).toBe('organization_id,team_id,effective_from');
    // STORY 3.3b: every member's history, at the organization level — who is
    // on which team when — and STORY 3.4a: in which position, and when each
    // member was active. Nothing about the person beyond that.
    expect(
      CALENDAR_COLUMNS.endsWith(
        ',team_membership_versions(organization_id,member_id,team_id,position,effective_from),' +
          'member_status_versions(organization_id,member_id,active,effective_from)',
      ),
    ).toBe(true);
    expect([...CALENDAR_COLUMNS.matchAll(/team_membership_versions\(([^)]*)\)/g)].map((found) => found[1])).toEqual([
      'organization_id,team_id,effective_from',
      'organization_id,member_id,team_id,position,effective_from',
    ]);
    expect([...CALENDAR_COLUMNS.matchAll(/member_status_versions\(([^)]*)\)/g)].map((found) => found[1])).toEqual([
      'organization_id,member_id,active,effective_from',
    ]);
    // The organization's own columns: its id, zone and whether it uses ranks.
    expect(CALENDAR_COLUMNS.startsWith('id,timezone,uses_fire_ranks,teams(')).toBe(true);
    expect(CALENDAR_COLUMNS).not.toMatch(/auth_user_id|email/);
    expect(CALENDAR_COLUMNS).not.toContain('created_by');
    const assignments = /rotation_assignments\(([^)]*)\)/.exec(CALENDAR_COLUMNS)?.[1] ?? '';

    expect(assignments).toBe('organization_id,team_id,pattern_id,offset_step_id,anchor_date,effective_from');
    // No member's fire rank (that is the rpc's), nothing projected or stored
    // as a schedule.
    expect(CALENDAR_COLUMNS.replace('uses_fire_ranks', '')).not.toMatch(/rank|cycle|projected|schedule|override/);
    // `position` in exactly two embeds: a rotation step's place in its
    // pattern, and the organization-level membership versions (story 3.4a).
    const positioned = [...CALENDAR_COLUMNS.matchAll(/(\w+)\(([^()]*)\)/g)]
      .filter((found) => /\bposition\b/.test(found[2] ?? ''))
      .map((found) => `${found[1] ?? ''}(${found[2] ?? ''})`);

    expect(positioned).toEqual([
      'rotation_steps(organization_id,id,pattern_id,position,shift_type_id)',
      'team_membership_versions(organization_id,member_id,team_id,position,effective_from)',
    ]);
    expect(CALENDAR_COLUMNS.match(/position/g)).toHaveLength(2);
  });

  it('answers an organization with nothing yet as an answer', async () => {
    const snapshot = await snapshotOf({ teams: [], types: [], steps: [], assignments: [] });

    expect(snapshot.teams).toEqual([]);
    expect(snapshot.assignments).toEqual([]);
  });

  it('orders the types by creation, whatever order they arrive in', async () => {
    const snapshot = await snapshotOf({ ...PILOT, types: [...PILOT.types].reverse() });

    expect(snapshot.types.map((type) => type.id)).toEqual(['pilot-dan', 'pilot-noc', 'pilot-slobodno']);
  });

  it('refuses a rejected call, an error, and anything but exactly one organization', async () => {
    quiet();
    const rejecting: CalendarTable = { select: () => ({ filter: () => Promise.reject(new Error('down')) }) };

    expect(await readCalendar(rejecting, tableOf(answerOf(PILOT)), session)).toEqual(REFUSED);
    expect(await read(tableOf({ data: null, error: { code: '500' }, count: null }), session)).toEqual(REFUSED);
    expect(await read(tableOf({ ...answerOf(PILOT), count: 2 }), session)).toEqual(REFUSED);
    expect(await read(tableOf({ data: [], error: null, count: 0 }), session)).toEqual(REFUSED);
    expect(await read(tableOf({ data: [{ id: 'x' }], error: null, count: 1 }), session)).toEqual(REFUSED);
    vi.restoreAllMocks();
  });

  it('refuses a row of another tenant, in every embed', async () => {
    quiet();
    for (const rows of [
      { ...PILOT, teams: [...PILOT.teams, teamRow('stranger', 'Smjena X', { organization: OTHER_ORGANIZATION })] },
      {
        ...PILOT,
        types: [...PILOT.types, typeRow('stranger', 'X', '2026-09-25T20:07:49+00:00', { organization: OTHER_ORGANIZATION })],
      },
      { ...PILOT, steps: [...PILOT.steps, stepRow('stranger', 'pilot-rotation', 9, 'pilot-dan', OTHER_ORGANIZATION)] },
      {
        ...PILOT,
        assignments: [
          ...PILOT.assignments,
          assignmentRow('pilot-smjena-a', 'pilot-rotation', 'pilot-step-0', '2020-01-01', '2026-10-01', OTHER_ORGANIZATION),
        ],
      },
    ]) {
      expect(await read(tableOf(answerOf(rows)), session)).toEqual(REFUSED);
    }
    vi.restoreAllMocks();
  });

  it('refuses what the keys guarantee, so no projection ever throws on it', async () => {
    quiet();
    for (const rows of [
      // A step naming a type the answer lacks.
      { ...PILOT, steps: [...PILOT.steps, stepRow('orphan', 'pilot-rotation', 9, 'missing')] },
      // Two steps of one pattern at one position.
      { ...PILOT, steps: [...PILOT.steps, stepRow('twin', 'pilot-rotation', 0, 'pilot-dan')] },
      // An assignment naming a team the answer lacks.
      { ...PILOT, assignments: [...PILOT.assignments, assignmentRow('missing', 'pilot-rotation', 'pilot-step-0', '2020-01-01', '2020-01-01')] },
      // An offset step outside its own pattern.
      { ...PILOT, assignments: [assignmentRow('pilot-smjena-a', 'other', 'pilot-step-0', '2020-01-01', '2020-01-01')] },
      // Two versions of one team on one date.
      { ...PILOT, assignments: [...PILOT.assignments, PILOT.assignments[0]!] },
      // A malformed date.
      { ...PILOT, assignments: [assignmentRow('pilot-smjena-a', 'pilot-rotation', 'pilot-step-0', '2020-01-01', '2020-02-30')] },
    ]) {
      expect(await read(tableOf(answerOf(rows)), session)).toEqual(REFUSED);
    }
    vi.restoreAllMocks();
  });

  it('reads the viewer\'s history in date order, a left team and archived teams included', async () => {
    const moved = await read(tableOf(
        answerOf(
          { ...PILOT, teams: [...PILOT.teams, teamRow('pilot-smjena-x', 'Smjena X', { archived: true })] },
          [
            viewerRow(
              [
                membershipRow(null, '2026-09-10'),
                membershipRow('pilot-smjena-x', '2020-01-01'),
                membershipRow('pilot-smjena-b', '2024-05-01'),
              ],
              { role: 'admin' },
            ),
          ],
        ),
      ),
      session,
    );

    expect(moved.ok && moved.snapshot.viewer).toEqual({
      memberId: VIEWER_MEMBER,
      role: 'admin',
      memberships: [
        { teamId: 'pilot-smjena-x', position: null, effectiveFrom: '2020-01-01' },
        { teamId: 'pilot-smjena-b', position: null, effectiveFrom: '2024-05-01' },
        { teamId: null, position: null, effectiveFrom: '2026-09-10' },
      ],
      statuses: [],
    });
    const none = await read(tableOf(answerOf(PILOT, [viewerRow([])])), session);

    expect(none.ok && none.snapshot.viewer.memberships).toEqual([]);
  });

  it('refuses no session, and a session that cannot be read, without reading', async () => {
    quiet();
    const table = tableOf(answerOf(PILOT));

    expect(await read(table, () => Promise.resolve(null))).toEqual(REFUSED);
    expect(await read(table, () => Promise.reject(new Error('storage')))).toEqual(REFUSED);
    expect(table.seen).toEqual([]);
    vi.restoreAllMocks();
  });

  it('refuses every bad viewer embed', async () => {
    quiet();
    const own = membershipRow('pilot-smjena-a', SEEDED);

    for (const viewers of [
      // No member row, and two.
      [],
      [viewerRow([own]), viewerRow([own], { id: 'someone-else' })],
      // Another tenant's row, or a version of another tenant.
      [viewerRow([own], { organization: OTHER_ORGANIZATION })],
      [viewerRow([membershipRow('pilot-smjena-a', SEEDED, OTHER_ORGANIZATION)])],
      // A team the answer lacks.
      [viewerRow([membershipRow('unknown-team', SEEDED)])],
      // Two versions on one date.
      [viewerRow([own, membershipRow('pilot-smjena-b', SEEDED)])],
      // A role this build does not know, or none.
      [viewerRow([own], { role: 'supervisor' })],
      [viewerRow([own], { role: null })],
      // A malformed date, a malformed team, no id, no versions list.
      [viewerRow([membershipRow('pilot-smjena-a', '2020-02-30')])],
      [viewerRow([{ ...own, team_id: 7 }])],
      [{ ...viewerRow([own]), id: '' }],
      [{ ...viewerRow([own]), team_membership_versions: null }],
    ]) {
      expect(await read(tableOf(answerOf(PILOT, viewers)), session), JSON.stringify(viewers)).toEqual(REFUSED);
    }
    const { members: _members, ...noEmbed } = calendarOrganizationRow(PILOT);

    expect(await read(tableOf({ data: [noEmbed], error: null, count: 1 }), session)).toEqual(REFUSED);
    vi.restoreAllMocks();
  });

  it('reads every member with rank and histories, sorted by name, an inactive one included', async () => {
    const colleague = '00000000-0000-4000-8000-0000000000c1';
    const namesake = '00000000-0000-4000-8000-0000000000c0';
    const inactive = '00000000-0000-4000-8000-0000000000c9';
    const outcome = await read(
      tableOf(
        {
          data: [
            calendarOrganizationRow(PILOT, {
              usesFireRanks: true,
              versions: [
                memberMembershipRow(colleague, 'pilot-smjena-b', '2026-09-15', undefined, 'driver'),
                memberMembershipRow(colleague, 'pilot-smjena-a', SEEDED, undefined, 'commander'),
                memberMembershipRow(VIEWER_MEMBER, 'pilot-smjena-a', SEEDED),
                memberMembershipRow(inactive, 'pilot-smjena-c', SEEDED, undefined, 'firefighter'),
              ],
              statuses: [
                statusRow(inactive, true, SEEDED),
                statusRow(inactive, false, '2026-09-01'),
                statusRow(VIEWER_MEMBER, true, '2021-03-01'),
              ],
            }),
          ],
          error: null,
          count: 1,
        },
        membersAnswerOf([
          { ...calendarMemberRow(colleague, 'Čedo Zorić', 'nco'), email: 'never@carried.hr' },
          calendarMemberRow(VIEWER_MEMBER, VIEWER_NAME),
          calendarMemberRow(namesake, 'Čedo Zorić'),
          calendarMemberRow('00000000-0000-4000-8000-0000000000c2', 'Ante Babić'),
          calendarMemberRow(inactive, 'Zoran Umirovljeni', 'officer'),
        ]),
      ),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.snapshot.usesFireRanks).toBe(true);
    // Croatian collation: `Č` after `C`, before `L`; one name twice, by id.
    expect(outcome.snapshot.members).toEqual([
      { id: '00000000-0000-4000-8000-0000000000c2', name: 'Ante Babić', fireRank: null, memberships: [], statuses: [] },
      { id: namesake, name: 'Čedo Zorić', fireRank: null, memberships: [], statuses: [] },
      {
        id: colleague,
        name: 'Čedo Zorić',
        fireRank: 'nco',
        memberships: [
          { teamId: 'pilot-smjena-a', position: 'commander', effectiveFrom: SEEDED },
          { teamId: 'pilot-smjena-b', position: 'driver', effectiveFrom: '2026-09-15' },
        ],
        statuses: [],
      },
      {
        id: VIEWER_MEMBER,
        name: VIEWER_NAME,
        fireRank: null,
        memberships: [{ teamId: 'pilot-smjena-a', position: null, effectiveFrom: SEEDED }],
        statuses: [{ active: true, effectiveFrom: '2021-03-01' }],
      },
      {
        id: inactive,
        name: 'Zoran Umirovljeni',
        fireRank: 'officer',
        memberships: [{ teamId: 'pilot-smjena-c', position: 'firefighter', effectiveFrom: SEEDED }],
        statuses: [
          { active: true, effectiveFrom: SEEDED },
          { active: false, effectiveFrom: '2026-09-01' },
        ],
      },
    ]);
    // ONE HISTORY PER PERSON: the viewer's memberships and statuses are
    // exactly their entry in `members`.
    const own = outcome.snapshot.members.find((member) => member.id === VIEWER_MEMBER)!;

    expect(outcome.snapshot.viewer.memberships).toBe(own.memberships);
    expect(outcome.snapshot.viewer.statuses).toBe(own.statuses);
    expect(outcome.snapshot.viewer.statuses).toEqual([{ active: true, effectiveFrom: '2021-03-01' }]);
  });

  it("carries the viewer's positions from the organization-level history", async () => {
    const outcome = await read(
      tableOf({
        data: [
          calendarOrganizationRow(PILOT, {
            versions: [
              memberMembershipRow(VIEWER_MEMBER, 'pilot-smjena-b', '2026-09-15', undefined, 'driver'),
              memberMembershipRow(VIEWER_MEMBER, 'pilot-smjena-a', SEEDED, undefined, 'commander'),
            ],
          }),
        ],
        error: null,
        count: 1,
      }),
    );

    expect(outcome.ok && outcome.snapshot.viewer.memberships).toEqual([
      { teamId: 'pilot-smjena-a', position: 'commander', effectiveFrom: SEEDED },
      { teamId: 'pilot-smjena-b', position: 'driver', effectiveFrom: '2026-09-15' },
    ]);
  });

  it('refuses a viewer the members read does not name', async () => {
    quiet();
    const empty = await read(
      tableOf({ data: [calendarOrganizationRow(PILOT, { versions: [] })], error: null, count: 1 }, membersAnswerOf([])),
    );
    const others = await read(
      tableOf(
        { data: [calendarOrganizationRow(PILOT, { versions: [] })], error: null, count: 1 },
        membersAnswerOf([calendarMemberRow('someone-else', 'Ana')]),
      ),
    );

    expect(empty).toEqual(REFUSED);
    expect(others).toEqual(REFUSED);
    vi.restoreAllMocks();
  });

  it('refuses every bad members answer', async () => {
    quiet();
    for (const members of [
      // An error, data that is not an array, a malformed answer.
      { data: null, error: { code: '42501' } },
      { data: [calendarMemberRow(VIEWER_MEMBER, VIEWER_NAME)], error: { code: '500' } },
      { data: { id: VIEWER_MEMBER }, error: null },
      { data: null, error: null },
      null,
      'rows',
      // A malformed row: not an object, no id, an empty id, no name, a number.
      { data: [null], error: null },
      { data: [{ name: 'Ana' }], error: null },
      { data: [calendarMemberRow('', 'Ana')], error: null },
      { data: [{ id: VIEWER_MEMBER }], error: null },
      { data: [calendarMemberRow(VIEWER_MEMBER, 7 as unknown as string)], error: null },
      // A blank name, empty or white space only.
      { data: [calendarMemberRow(VIEWER_MEMBER, '')], error: null },
      { data: [calendarMemberRow(VIEWER_MEMBER, ' \t ')], error: null },
      // One id twice.
      membersAnswerOf([calendarMemberRow(VIEWER_MEMBER, VIEWER_NAME), calendarMemberRow(VIEWER_MEMBER, 'Ana')]),
      // STORY 3.4a: a rank that is neither text nor null, or missing.
      membersAnswerOf([calendarMemberRow(VIEWER_MEMBER, VIEWER_NAME, 3)]),
      membersAnswerOf([calendarMemberRow(VIEWER_MEMBER, VIEWER_NAME, false)]),
      membersAnswerOf([{ id: VIEWER_MEMBER, name: VIEWER_NAME }]),
    ]) {
      expect(await read(tableOf(answerOf(PILOT), members)), JSON.stringify(members)).toEqual(REFUSED);
    }
    const rejecting: Source = {
      ...tableOf(answerOf(PILOT)),
      rpc: () => Promise.reject(new Error('down')),
    };

    expect(await read(rejecting)).toEqual(REFUSED);
    vi.restoreAllMocks();
  });

  it('refuses every bad organization-level membership version', async () => {
    quiet();
    const own = memberMembershipRow(VIEWER_MEMBER, 'pilot-smjena-a', SEEDED);

    for (const versions of [
      // Another tenant's version.
      [memberMembershipRow(VIEWER_MEMBER, 'pilot-smjena-a', SEEDED, OTHER_ORGANIZATION)],
      // A team the answer lacks, or a team that is not text.
      [memberMembershipRow(VIEWER_MEMBER, 'unknown-team', SEEDED)],
      [{ ...own, team_id: 7 }],
      // One member, one date, twice — even to another team.
      [own, memberMembershipRow(VIEWER_MEMBER, 'pilot-smjena-b', SEEDED)],
      // A malformed date, no member, not a row.
      [memberMembershipRow(VIEWER_MEMBER, 'pilot-smjena-a', '2020-02-30')],
      [{ ...own, member_id: null }],
      [null as unknown as Record<string, unknown>],
      // STORY 3.4a: a version of a member the members read does not name is
      // still validated — another tenant's, or a repeated date, is refused.
      [own, memberMembershipRow('someone-unknown', 'pilot-smjena-b', SEEDED, OTHER_ORGANIZATION)],
      [
        own,
        memberMembershipRow('someone-unknown', 'pilot-smjena-b', SEEDED),
        memberMembershipRow('someone-unknown', 'pilot-smjena-c', SEEDED),
      ],
      // A position that is neither text nor null, or missing.
      [memberMembershipRow(VIEWER_MEMBER, 'pilot-smjena-a', SEEDED, undefined, 7)],
      [{ organization_id: own['organization_id'], member_id: VIEWER_MEMBER, team_id: 'pilot-smjena-a', effective_from: SEEDED }],
    ]) {
      const answer = { data: [calendarOrganizationRow(PILOT, { versions })], error: null, count: 1 };

      expect(await read(tableOf(answer)), JSON.stringify(versions)).toEqual(REFUSED);
    }
    const { team_membership_versions: _versions, ...noEmbed } = calendarOrganizationRow(PILOT);

    expect(await read(tableOf({ data: [noEmbed], error: null, count: 1 }))).toEqual(REFUSED);
    // Two members on one date is two histories, not a repeat.
    const shared = await read(
      tableOf(
        {
          data: [
            calendarOrganizationRow(PILOT, {
              versions: [own, memberMembershipRow('someone-else', 'pilot-smjena-b', SEEDED)],
            }),
          ],
          error: null,
          count: 1,
        },
        membersAnswerOf([calendarMemberRow(VIEWER_MEMBER, VIEWER_NAME), calendarMemberRow('someone-else', 'Ana')]),
      ),
    );

    expect(shared.ok).toBe(true);
    vi.restoreAllMocks();
  });

  it('ignores a valid version of a member the members read does not yet name (story 3.4a)', async () => {
    // The select and the rpc are two requests: a member created between them
    // is a race, not a defect, and never takes the calendar down.
    const unknown = '00000000-0000-4000-8000-0000000000d1';
    const outcome = await read(
      tableOf({
        data: [
          calendarOrganizationRow(PILOT, {
            versions: [
              memberMembershipRow(VIEWER_MEMBER, 'pilot-smjena-a', SEEDED),
              memberMembershipRow(unknown, 'pilot-smjena-b', SEEDED, undefined, 'driver'),
            ],
            statuses: [statusRow(unknown, false, '2026-09-01')],
          }),
        ],
        error: null,
        count: 1,
      }),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.snapshot.members.map((member) => member.id)).toEqual([VIEWER_MEMBER]);
    expect(outcome.snapshot.members[0]!.memberships).toEqual([
      { teamId: 'pilot-smjena-a', position: null, effectiveFrom: SEEDED },
    ]);
    expect(outcome.snapshot.members[0]!.statuses).toEqual([]);
  });

  it('refuses every bad status version (story 3.4a)', async () => {
    quiet();
    const own = statusRow(VIEWER_MEMBER, false, '2026-09-01');

    for (const statuses of [
      // Another tenant's version.
      [statusRow(VIEWER_MEMBER, false, '2026-09-01', OTHER_ORGANIZATION)],
      // A member the members read does not name is still validated.
      [statusRow('someone-unknown', false, '2026-09-01', OTHER_ORGANIZATION)],
      [statusRow('someone-unknown', 'no', '2026-09-01')],
      // One member, one date, twice — even with another answer.
      [own, statusRow(VIEWER_MEMBER, true, '2026-09-01')],
      // An `active` that is not a boolean, or missing.
      [statusRow(VIEWER_MEMBER, 'false', '2026-09-01')],
      [statusRow(VIEWER_MEMBER, null, '2026-09-01')],
      [{ ...own, active: undefined }],
      // A malformed date, no member, not a row.
      [statusRow(VIEWER_MEMBER, false, '2026-02-30')],
      [{ ...own, member_id: null }],
      [null as unknown as Record<string, unknown>],
    ]) {
      const answer = { data: [calendarOrganizationRow(PILOT, { statuses })], error: null, count: 1 };

      expect(await read(tableOf(answer)), JSON.stringify(statuses)).toEqual(REFUSED);
    }
    const { member_status_versions: _statuses, ...noEmbed } = calendarOrganizationRow(PILOT);

    expect(await read(tableOf({ data: [noEmbed], error: null, count: 1 }))).toEqual(REFUSED);
    vi.restoreAllMocks();
  });

  it('refuses an organization whose rank setting is not a boolean (story 3.4a)', async () => {
    quiet();
    for (const usesFireRanks of [null, 'true', 1]) {
      const answer = { data: [calendarOrganizationRow(PILOT, { usesFireRanks })], error: null, count: 1 };

      expect(await read(tableOf(answer)), String(usesFireRanks)).toEqual(REFUSED);
    }
    vi.restoreAllMocks();
  });

  it('reads the live overrides, by team then date, and carries only their seven fields (story 3.5a)', async () => {
    const outcome = await read(
      tableOf(
        answerOf(PILOT),
        membersAnswerOf(),
        overridesAnswerOf([
          { ...calendarOverrideRow('o2', 'pilot-smjena-b', '2026-09-03', 'pilot-dan'), created_by: 'never-carried' },
          calendarOverrideRow('o3', 'pilot-smjena-a', '2026-09-14', 'pilot-noc', { author: null }),
          calendarOverrideRow('o1', 'pilot-smjena-a', '2026-09-02', 'pilot-slobodno'),
        ]),
      ),
    );

    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.snapshot.overrides).toEqual([
      {
        id: 'o1',
        teamId: 'pilot-smjena-a',
        date: '2026-09-02',
        shiftTypeId: 'pilot-slobodno',
        reason: 'Zamjena zbog vježbe.',
        createdAt: '2026-09-12T17:05:00+00:00',
        authorMemberId: VIEWER_MEMBER,
      },
      {
        id: 'o3',
        teamId: 'pilot-smjena-a',
        date: '2026-09-14',
        shiftTypeId: 'pilot-noc',
        reason: 'Zamjena zbog vježbe.',
        createdAt: '2026-09-12T17:05:00+00:00',
        authorMemberId: null,
      },
      {
        id: 'o2',
        teamId: 'pilot-smjena-b',
        date: '2026-09-03',
        shiftTypeId: 'pilot-dan',
        reason: 'Zamjena zbog vježbe.',
        createdAt: '2026-09-12T17:05:00+00:00',
        authorMemberId: VIEWER_MEMBER,
      },
    ]);
  });

  it('reads any reason the database accepted, white space included: its content is 0019\'s to judge (story 3.5a)', async () => {
    for (const reason of ['  ', '\t\n', '\u00a0Vježba\u2003', 'z'.repeat(250)]) {
      const outcome = await read(
        tableOf(
          answerOf(PILOT),
          membersAnswerOf(),
          overridesAnswerOf([calendarOverrideRow('o1', 'pilot-smjena-a', '2026-09-14', 'pilot-noc', { reason })]),
        ),
      );

      expect(outcome.ok, JSON.stringify(reason)).toBe(true);
      if (!outcome.ok) return;
      expect(outcome.snapshot.overrides.map((override) => override.reason)).toEqual([reason]);
    }
  });

  it('refuses every bad overrides answer (story 3.5a)', async () => {
    const logged = quiet();
    const good = calendarOverrideRow('o1', 'pilot-smjena-a', '2026-09-14', 'pilot-noc');
    const { team_id: _team, ...noTeam } = good;

    for (const overrides of [
      // An error, data that is not an array, a malformed answer.
      { data: null, error: { code: '42501' } },
      { data: [good], error: { code: '500' } },
      { data: { id: 'o1' }, error: null },
      { data: null, error: null },
      null,
      // A malformed row: not an object, no team, no id.
      overridesAnswerOf([null as unknown as Record<string, unknown>]),
      overridesAnswerOf([noTeam]),
      overridesAnswerOf([{ ...good, id: '' }]),
      // A team or type the answer lacks.
      overridesAnswerOf([{ ...good, team_id: 'missing' }]),
      overridesAnswerOf([{ ...good, shift_type_id: 'missing' }]),
      // A type that is not text, a malformed date, a reason that is not text,
      // a time that is no instant or missing.
      overridesAnswerOf([{ ...good, shift_type_id: 7 }]),
      overridesAnswerOf([{ ...good, date: '2026-02-30' }]),
      overridesAnswerOf([{ ...good, reason: null }]),
      overridesAnswerOf([{ ...good, reason: 7 }]),
      overridesAnswerOf([{ ...good, created_at: 'yesterday' }]),
      overridesAnswerOf([{ ...good, created_at: undefined }]),
      // An author neither text nor null.
      overridesAnswerOf([{ ...good, author_member_id: 7 }]),
      overridesAnswerOf([{ ...good, author_member_id: '' }]),
      // Two live overrides of one team and date, and one id twice.
      overridesAnswerOf([good, { ...good, id: 'o2', shift_type_id: 'pilot-dan' }]),
      overridesAnswerOf([good, { ...good, date: '2026-09-15' }]),
    ]) {
      expect(await read(tableOf(answerOf(PILOT), membersAnswerOf(), overrides)), JSON.stringify(overrides)).toEqual(
        REFUSED,
      );
    }
    expect(logged).toHaveBeenCalledWith(CALENDAR_UNAVAILABLE, 'override');
    vi.restoreAllMocks();
  });

  it('names the read failure through its own key', () => {
    expect(calendarMessageKey(CALENDAR_UNAVAILABLE)).toBe('kalendar.error.unavailable');
  });
});

describe('the surface state, driven through the one query definition', () => {
  const wasServer = environmentManager.isServer();
  const good = answerOf(PILOT);
  const miscounted: CalendarAnswer = { ...good, count: 2 };
  let client: QueryClient;
  let unsubscribes: (() => void)[];
  let pilot: CalendarSnapshot;

  beforeAll(async () => {
    environmentManager.setIsServer(() => false);
    pilot = await snapshotOf(PILOT);
  });

  afterAll(() => {
    environmentManager.setIsServer(() => wasServer);
  });

  beforeEach(() => {
    client = new QueryClient();
    unsubscribes = [];
    quiet();
  });

  afterEach(() => {
    for (const unsubscribe of unsubscribes) unsubscribe();
    client.clear();
    onlineManager.setOnline(true);
    vi.restoreAllMocks();
  });

  function answeringInTurn(
    ...answers: CalendarAnswer[]
  ): CalendarTable & CalendarMembersRpc & { readonly calls: () => number } {
    let calls = 0;

    return {
      calls: () => calls,
      rpc: (fn: string) =>
        Promise.resolve(fn === CALENDAR_OVERRIDES_FUNCTION ? overridesAnswerOf() : membersAnswerOf()),
      select() {
        return {
          filter() {
            const answer = answers[Math.min(calls, answers.length - 1)];

            calls += 1;

            return Promise.resolve(answer as CalendarAnswer);
          },
        };
      },
    };
  }

  function observe(table: () => CalendarTable & CalendarMembersRpc) {
    const observer = new QueryObserver(client, {
      ...calendarQueryOptions(table, table, session),
      retryDelay: 0,
    });

    unsubscribes.push(observer.subscribe(() => undefined));

    return observer;
  }

  async function settled(observer: ReturnType<typeof observe>) {
    await vi.waitFor(() => {
      expect(observer.getCurrentResult().fetchStatus).toBe('idle');
    });

    return observer.getCurrentResult();
  }

  it('keeps one key with no month in it, and reads again whenever it is opened', () => {
    const options = calendarQueryOptions(
      () => answeringInTurn(good),
      () => answeringInTurn(good),
    );

    expect(options.queryKey).toEqual(CALENDAR_KEY);
    expect(CALENDAR_KEY).toEqual(['calendar']);
    expect(options.staleTime).toBe(CALENDAR_READ_STALE_MS);
    expect(CALENDAR_READ_STALE_MS).toBe(0);
    expect(options.refetchOnWindowFocus).toBe(false);
    expect(options.retry).toBe(1);
  });

  it('pulses while the first read is in flight and says nothing', () => {
    const observer = observe(() => answeringInTurn(good));

    expect(calendarSurfaceStateOf(observer.getCurrentResult())).toEqual({
      snapshot: null,
      refusal: null,
      loading: true,
    });
  });

  it('draws a first answer', async () => {
    const state = calendarSurfaceStateOf(await settled(observe(() => answeringInTurn(good))));

    expect(state).toEqual({ snapshot: pilot, refusal: null, loading: false });
  });

  it('shows the cached answer at once when opened again, then reads it again', async () => {
    const table = answeringInTurn(good);

    await settled(observe(() => table));
    const reopened = observe(() => table);

    expect(calendarSurfaceStateOf(reopened.getCurrentResult()).snapshot).toEqual(pilot);
    await settled(reopened);
    expect(table.calls()).toBe(2);
  });

  it('retries an unavailable read once, then shows the message and no grid', async () => {
    const table = answeringInTurn(miscounted);
    const result = await settled(observe(() => table));

    expect(table.calls()).toBe(2);
    expect(calendarSurfaceStateOf(result)).toEqual({ snapshot: null, refusal: CALENDAR_UNAVAILABLE, loading: false });
  });

  it('draws no grid over a failed refetch either', async () => {
    const table = answeringInTurn(good, miscounted);
    const observer = observe(() => table);

    await settled(observer);
    await client.invalidateQueries({ queryKey: CALENDAR_KEY });

    expect(calendarSurfaceStateOf(await settled(observer))).toEqual({
      snapshot: null,
      refusal: CALENDAR_UNAVAILABLE,
      loading: false,
    });
  });

  it('rejects when the table cannot even be built', async () => {
    const result = await settled(
      observe(() => {
        throw new Error('SUPABASE_ENVIRONMENT_MISSING');
      }),
    );

    expect(calendarSurfaceStateOf(result).refusal).toBe(CALENDAR_UNAVAILABLE);
  });

  it('counts offline as unavailable rather than pulsing', () => {
    onlineManager.setOnline(false);
    const result = observe(() => answeringInTurn(good)).getCurrentResult();

    expect(result.fetchStatus).toBe(CALENDAR_FETCH_PAUSED);
    expect(calendarSurfaceStateOf(result)).toEqual({ snapshot: null, refusal: CALENDAR_UNAVAILABLE, loading: false });
  });

  it('counts offline as unavailable over a cached answer too, and draws no stale grid', async () => {
    const table = answeringInTurn(good);
    const observer = observe(() => table);

    await settled(observer);
    onlineManager.setOnline(false);
    void client.invalidateQueries({ queryKey: CALENDAR_KEY });
    await vi.waitFor(() => {
      expect(observer.getCurrentResult().fetchStatus).toBe(CALENDAR_FETCH_PAUSED);
    });
    const result = observer.getCurrentResult();

    expect(result.data).toEqual(pilot);
    expect(calendarSurfaceStateOf(result)).toEqual({ snapshot: null, refusal: CALENDAR_UNAVAILABLE, loading: false });
  });

  it('recovers: after a failed read, a good answer brings the grid back', async () => {
    const table = answeringInTurn(miscounted, miscounted, good);
    const observer = observe(() => table);

    expect(calendarSurfaceStateOf(await settled(observer)).refusal).toBe(CALENDAR_UNAVAILABLE);
    await observer.refetch();

    expect(calendarSurfaceStateOf(await settled(observer))).toEqual({ snapshot: pilot, refusal: null, loading: false });
  });

  it('never pulses a skeleton beside a message', () => {
    for (const isError of [true, false]) {
      for (const isPending of [true, false]) {
        for (const fetchStatus of ['idle', 'fetching', CALENDAR_FETCH_PAUSED]) {
          for (const data of [undefined, pilot]) {
            const state = calendarSurfaceStateOf({ isPending, isError, fetchStatus, data });

            expect(state.loading && state.refusal !== null).toBe(false);
          }
        }
      }
    }
  });
});

/**
 * What `snapshot.ts` may say about rank and position (story 3.4a), each an
 * exact count in its comment-stripped text: the organization's setting, each
 * member's rank off `calendar_members()`, and the membership versions'
 * position. A new use is a new count here, reviewed.
 */
const SNAPSHOT_CARRIES = [
  { token: 'uses_fire_ranks', count: 2 },
  { token: 'usesFireRanks', count: 4 },
  { token: "row['fire_rank']", count: 1 },
  { token: 'fireRank', count: 6 },
  { token: "version['position']", count: 1 },
] as const;

/**
 * Story 3.4b: the day detail CARRIES each rostered member's rank and position
 * to the screen (the type's field and the copy into it; EVERY `position` in the
 * file is one of those), and the screen SHOWS them — the members modules'
 * imports, the setting handed to `ranksShown` and `positionsShown`, and the
 * one rank and one position read into `rosterRankMessageKey` and
 * `rosterPositionMessageKey`. Neither orders, filters or decides by them; a
 * new use is a new count here, reviewed.
 */
const DETAIL_CARRIES = [
  { token: 'fireRank', count: 3 },
  { token: 'position', count: 3 },
] as const;
const SCREEN_SHOWS = [
  { token: "'@/features/members/utils/rank'", count: 1 },
  { token: 'usesFireRanks', count: 6 },
  { token: 'member.fireRank', count: 1 },
  { token: "'@/features/members/utils/position'", count: 1 },
  { token: 'positionsShown', count: 2 },
  { token: 'rosterPositionMessageKey', count: 2 },
  { token: 'member.position', count: 1 },
] as const;

describe('the calendar only reads, and projects nothing of its own', () => {
  // ONE PATH CONVENTION: every path here is '/'-separated, and every
  // comparison is an EXACT path, never a suffix — `utils/cell-modifiers.ts`
  // must not pass for `utils/modifiers.ts`, nor `hooks/use-day-detail.ts` for
  // `utils/day-detail.ts`.
  const slashed = (path: string) => path.split(sep).join('/');
  /** `apps/web/src/features/calendar/`, with its trailing '/'. */
  const directory = slashed(fileURLToPath(new URL('..', import.meta.url)));
  /** `apps/web/src/`, with its trailing '/'. */
  const srcRoot = slashed(fileURLToPath(new URL('../../..', import.meta.url))).replace(/\/?$/, '/');
  const feature = (path: string) => `${directory}${path}`;
  // SOURCE STRUCTURE B3: the screen is a FILE SET (`calendar-screen.fixture.ts`),
  // the page plus its hooks, components and helpers. The allowances that named
  // `kalendar.tsx` alone name ONE file of it now — the day detail dialog, which
  // draws the roster and the override block — and every other file of the set
  // is held to none, as every file outside it is.
  const screen: readonly string[] = Object.values(CALENDAR_SCREEN_PARTS).map((parts) => `${srcRoot}${parts.join('/')}`);
  const SHOWS_OWNER = `${srcRoot}${CALENDAR_SCREEN_PARTS.dayDetailDialog.join('/')}`;
  const MONTH = feature('utils/month.ts');
  const MODIFIERS = feature('utils/modifiers.ts');
  const SNAPSHOT = feature('services/snapshot.ts');
  const DAY_DETAIL = feature('utils/day-detail.ts');
  // STORY 3.5b: the calendar's one write module — the insert of an override
  // and the call of its removal function, and nothing else writes.
  const OVERRIDE_WRITE = feature('services/override-write.ts');
  const route = `${srcRoot}${CALENDAR_SCREEN_PARTS.page.join('/')}`;
  const files = [
    ...readdirSync(directory, { recursive: true, encoding: 'utf8' })
      .map(slashed)
      .filter((name) => /\.tsx?$/.test(name) && !name.endsWith('.test.ts'))
      .map(feature),
    route,
  ];
  const stripped = (file: string) =>
    readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1');

  it('sweeps the files it means to', () => {
    expect(files).toEqual(
      expect.arrayContaining([MONTH, SNAPSHOT, MODIFIERS, feature('utils/grid-keys.ts'), DAY_DETAIL, OVERRIDE_WRITE]),
    );
    expect(screen, 'the owner of the screen allowances is in the set').toContain(SHOWS_OWNER);
    // Every part of the screen is swept, and none of them is empty: one
    // emptied file cannot hide behind the others.
    for (const file of screen) {
      expect(files, `${file} is in the screen and not swept`).toContain(file);
      expect(stripped(file).trim().length, `${file} is all but empty`).toBeGreaterThan(150);
    }
  });

  it('derives one modifier from snapshot data (story 3.5a): overridden, from the domain\'s flag alone', () => {
    // Story 3.2b's vocabulary names every mark; story 3.5a derives the first,
    // `overridden`, in `month.ts` from the domain's `overridden` flag, and
    // the screen draws its glyph beside the day detail's override block — TWO
    // in the day detail dialog, and none in any other file of the screen.
    // Conflict, leave and uncovered are still named by the vocabulary alone
    // (3.6 and Epics 4–5), and no string literal names any mark.
    for (const file of files.filter((one) => one !== MODIFIERS)) {
      const text = stripped(file);

      expect(text, file).not.toMatch(/'(conflict|overridden|leave|uncovered)'|MODIFIER_(?!OVERRIDDEN\b)[A-Z]+\b/);
      const named = text.match(/\bMODIFIER_OVERRIDDEN\b/g)?.length ?? 0;

      expect(named, file).toBe(file === MONTH || file === SHOWS_OWNER ? 2 : 0);
    }
    const month = stripped(MONTH);

    expect(month, 'a cell given modifiers other than none or overridden').not.toMatch(
      /(?<!readonly )\bmodifiers:(?! NO_MODIFIERS\b| overridden \? OVERRIDDEN_MODIFIERS : NO_MODIFIERS\b)/,
    );
    expect(month.match(/\bmodifiers: NO_MODIFIERS\b/g)).toHaveLength(1);
    expect(month.match(/\bmodifiers: overridden \? OVERRIDDEN_MODIFIERS : NO_MODIFIERS\b/g)).toHaveLength(1);
    expect(month).toMatch(/const NO_MODIFIERS: readonly CalendarModifier\[\] = \[\];/);
    expect(month).toMatch(/const OVERRIDDEN_MODIFIERS: readonly CalendarModifier\[\] = \[MODIFIER_OVERRIDDEN\];/);
  });

  it.each(files)('%s has no modulo, no write and no read of rank or position', (file) => {
    const text = stripped(file);

    expect(text, 'a `%` projection').not.toMatch(/%/);
    expect(text).not.toMatch(/\.(update|delete|upsert)\(/);
    // Story 3.5b: ONE insert and ONE rpc in the write module, the two read
    // rpcs in the snapshot, and neither anywhere else.
    expect(text.match(/\.insert\(/g)?.length ?? 0, `.insert( in ${file}`).toBe(file === OVERRIDE_WRITE ? 1 : 0);
    expect(text.match(/\.rpc\(/g)?.length ?? 0, `.rpc( in ${file}`).toBe(
      file === OVERRIDE_WRITE ? 1 : file === SNAPSHOT ? 2 : 0,
    );
    // Story 3.4a: the snapshot CARRIES rank and position off the wire, to be
    // shown by 3.4b — in the named places only, counted, and nowhere else. No
    // other file reads either, and no rule ever does.
    // The screen's allowance lives in the day detail dialog alone, at the
    // counts it had in the one-file screen.
    const carried = file === SNAPSHOT
      ? SNAPSHOT_CARRIES
      : file === DAY_DETAIL
        ? DETAIL_CARRIES
        : file === SHOWS_OWNER
          ? SCREEN_SHOWS
          : [];
    let rest = text;

    for (const { token, count } of carried) {
      expect(rest.split(token).length - 1, `${token} in ${file}`).toBe(count);
      rest = rest.replaceAll(token, '');
    }
    // Everywhere else none of what the screen shows, including the tokens the
    // ban below cannot see (`positionsShown`, `member.position`, …).
    if (carried.length === 0) {
      for (const { token } of SCREEN_SHOWS) expect(text.split(token).length - 1, `${token} in ${file}`).toBe(0);
    }
    expect(rest).not.toMatch(/fire_?rank|fireRank|\brank\b|team_position|teamPosition|usesFireRanks/i);
    expect(text, 'a second query or key').not.toMatch(/queryKey:\s*\[(?!\s*\])/);
  });
});
