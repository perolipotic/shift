import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ACCEPT_UNCOVERED,
  REPLACE_MEMBER,
  acceptedUncoveredOf,
  leaveHoursKeysOf,
  type ConflictResolution,
  CONFLICT_RESOLUTIONS_COLUMNS,
  CONFLICT_RESOLUTIONS_PAGE_ROWS,
  CONFLICT_RESOLUTIONS_TABLE,
  CONFLICT_RESOLUTIONS_UNAVAILABLE,
  MY_CONFLICT_RESOLUTIONS_FUNCTION,
  MY_CONFLICT_RESOLUTIONS_KEY,
  ORGANIZATION_CONFLICT_RESOLUTIONS_KEY,
  conflictResolutionsAnswerOf,
  conflictResolutionsOf,
  myConflictResolutionsQueryOptions,
  organizationConflictResolutionsQueryOptions,
  readMyConflictResolutionRows,
  readOrganizationConflictResolutionRows,
  replacementLinksOf,
  type ConflictResolutionRowsAnswer,
  type ConflictResolutionsAnswer,
  type MyConflictResolutionsRpc,
  type OrganizationConflictResolutionsAnswer,
  type OrganizationConflictResolutionsQuery,
  type OrganizationConflictResolutionsTable,
} from '@/features/conflicts/services/resolutions';

/**
 * Story 5.4a's reads, executed (AD-15): the organization's live resolutions
 * read in pages with their exact count, the viewer's own through
 * `my_conflict_resolutions()`, each under its own key, and every row that
 * cannot be trusted refusing the whole answer.
 */

const MEMBER = '00000000-0000-4000-8000-0000000000b2';
const OTHER = '00000000-0000-4000-8000-0000000000b3';
const TEAM = '00000000-0000-4000-8000-0000000000d1';
const TEAM_B = '00000000-0000-4000-8000-0000000000d2';

afterEach(() => {
  vi.restoreAllMocks();
});

const row = (memberId: string, date: string, teamId: string, kind: unknown = 'accept_uncovered') => ({
  member_id: memberId,
  date,
  team_id: teamId,
  kind,
});
const A = row(MEMBER, '2026-09-12', TEAM);
const B = { ...row(OTHER, '2026-09-10', TEAM_B, 'replace_member'), roster_override_id: 'override-b' };

/** The table, answering each page in turn from `pages`, recording every call. */
function tableAnswering(
  pages: readonly (OrganizationConflictResolutionsAnswer | Promise<never>)[],
): OrganizationConflictResolutionsTable & { calls: unknown[] } {
  const calls: unknown[] = [];
  let next = 0;

  return {
    calls,
    select(columns, options) {
      calls.push(['select', columns, options]);

      const query: OrganizationConflictResolutionsQuery = {
        is(column, value) {
          calls.push(['is', column, value]);

          return query;
        },
        order(column, options) {
          calls.push(['order', column, options]);

          return query;
        },
        range(from, to) {
          calls.push(['range', from, to]);

          const page = pages[next];
          next += 1;

          if (page === undefined) throw new Error('no page left');

          return page instanceof Promise ? page : Promise.resolve(page);
        },
      };

      return query;
    },
  };
}

function rpcAnswering(answer: ConflictResolutionsAnswer | Promise<never>): MyConflictResolutionsRpc & { calls: string[] } {
  const calls: string[] = [];

  return {
    calls,
    rpc(fn) {
      calls.push(fn);

      return answer instanceof Promise ? answer : Promise.resolve(answer);
    },
  };
}

describe("the organization's read", () => {
  const LAST = CONFLICT_RESOLUTIONS_PAGE_ROWS - 1;
  const many = (count: number) => Array.from({ length: count }, (_, index) => row(MEMBER, '2026-09-12', `t${String(index)}`));

  it('asks for every live resolution by id, a page at a time, with its exact count, and no author column', async () => {
    const table = tableAnswering([{ data: [A, B], error: null, count: 2 }]);

    expect(await readOrganizationConflictResolutionRows(table)).toEqual({ ok: true, rows: [A, B] });
    expect(table.calls).toEqual([
      ['select', CONFLICT_RESOLUTIONS_COLUMNS, { count: 'exact' }],
      ['is', 'removed_at', null],
      ['order', 'id', { ascending: true }],
      ['range', 0, LAST],
    ]);
    expect(CONFLICT_RESOLUTIONS_COLUMNS).toBe('member_id,date,team_id,kind,roster_override_id');
    expect(CONFLICT_RESOLUTIONS_COLUMNS).not.toMatch(/created_by|removed_by/);
    expect(CONFLICT_RESOLUTIONS_TABLE).toBe('conflict_resolutions');
  });

  it('pages the server cap, so a full page is followed', async () => {
    const first = many(CONFLICT_RESOLUTIONS_PAGE_ROWS);
    const total = CONFLICT_RESOLUTIONS_PAGE_ROWS + 1;
    const table = tableAnswering([
      { data: first, error: null, count: total },
      { data: [A], error: null, count: total },
    ]);

    expect(await readOrganizationConflictResolutionRows(table)).toEqual({ ok: true, rows: [...first, A] });
  });

  it.each([
    ['no count', [{ data: [A], error: null }]],
    ['a count above the rows', [{ data: [A], error: null, count: 2 }]],
    ['an error', [{ data: null, error: { code: '42501' } }]],
    ['no list', [{ data: null, error: null }]],
    [
      'a count that drops between pages',
      [
        { data: many(CONFLICT_RESOLUTIONS_PAGE_ROWS), error: null, count: CONFLICT_RESOLUTIONS_PAGE_ROWS + 1 },
        { data: [], error: null, count: CONFLICT_RESOLUTIONS_PAGE_ROWS },
      ],
    ],
    [
      'a count that grows between pages',
      [
        { data: many(CONFLICT_RESOLUTIONS_PAGE_ROWS), error: null, count: CONFLICT_RESOLUTIONS_PAGE_ROWS + 1 },
        { data: [A], error: null, count: CONFLICT_RESOLUTIONS_PAGE_ROWS + 2 },
      ],
    ],
    [
      'a later page that fails',
      [
        { data: many(CONFLICT_RESOLUTIONS_PAGE_ROWS), error: null, count: CONFLICT_RESOLUTIONS_PAGE_ROWS + 1 },
        { data: null, error: { code: '57014' }, count: null },
      ],
    ],
    ['a full page holding more rows than the count', [{ data: many(CONFLICT_RESOLUTIONS_PAGE_ROWS), error: null, count: 3 }]],
  ] as const)('is unavailable, logged, never a partial list, on %s', async (_name, pages) => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(await readOrganizationConflictResolutionRows(tableAnswering(pages))).toEqual({
      ok: false,
      code: CONFLICT_RESOLUTIONS_UNAVAILABLE,
    });
    expect(logged).toHaveBeenCalled();
  });

  it('is unavailable, logged, when the call rejects', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(await readOrganizationConflictResolutionRows(tableAnswering([Promise.reject(new Error('offline'))]))).toEqual({
      ok: false,
      code: CONFLICT_RESOLUTIONS_UNAVAILABLE,
    });
    expect(logged).toHaveBeenCalled();
  });

  it('reads under its own key, and throws on a failure so the query settles failed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const ok = organizationConflictResolutionsQueryOptions(() => tableAnswering([{ data: [A], error: null, count: 1 }]));
    const failed = organizationConflictResolutionsQueryOptions(() => tableAnswering([{ data: null, error: { code: 'x' } }]));
    const run = (options: typeof ok) => (options.queryFn as () => Promise<unknown>)();

    expect(ok.queryKey).toEqual(ORGANIZATION_CONFLICT_RESOLUTIONS_KEY);
    expect(ORGANIZATION_CONFLICT_RESOLUTIONS_KEY).toEqual(['organization-conflict-resolutions']);
    await expect(run(ok)).resolves.toEqual([A]);
    await expect(run(failed)).rejects.toThrow(CONFLICT_RESOLUTIONS_UNAVAILABLE);
  });
});

describe("the viewer's own read", () => {
  it('calls my_conflict_resolutions with no argument and answers the rows unparsed', async () => {
    const client = rpcAnswering({ data: [A], error: null });

    expect(await readMyConflictResolutionRows(client)).toEqual({ ok: true, rows: [A] });
    expect(client.calls).toEqual([MY_CONFLICT_RESOLUTIONS_FUNCTION]);
    expect(MY_CONFLICT_RESOLUTIONS_FUNCTION).toBe('my_conflict_resolutions');
  });

  it.each([
    ['an error', { data: null, error: { code: '42501' } }],
    ['no array', { data: null, error: null }],
  ] as const)('is unavailable on %s', async (_name, answer) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(await readMyConflictResolutionRows(rpcAnswering(answer))).toEqual({ ok: false, code: CONFLICT_RESOLUTIONS_UNAVAILABLE });
  });

  it('is unavailable when the call rejects', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(await readMyConflictResolutionRows(rpcAnswering(Promise.reject(new Error('offline'))))).toEqual({
      ok: false,
      code: CONFLICT_RESOLUTIONS_UNAVAILABLE,
    });
  });

  it('reads under its own key, and throws on a failure so the query settles failed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const ok = myConflictResolutionsQueryOptions(() => rpcAnswering({ data: [A], error: null }));
    const failed = myConflictResolutionsQueryOptions(() => rpcAnswering({ data: null, error: { code: 'x' } }));
    const run = (options: typeof ok) => (options.queryFn as () => Promise<unknown>)();

    expect(ok.queryKey).toEqual(MY_CONFLICT_RESOLUTIONS_KEY);
    expect(MY_CONFLICT_RESOLUTIONS_KEY).toEqual(['my-conflict-resolutions']);
    await expect(run(ok)).resolves.toEqual([A]);
    await expect(run(failed)).rejects.toThrow(CONFLICT_RESOLUTIONS_UNAVAILABLE);
  });
});

describe('the parser', () => {
  it('parses every row into its key and kind, in the order given', () => {
    expect(conflictResolutionsOf([A, B], [MEMBER, OTHER], [TEAM, TEAM_B])).toEqual([
      { memberId: MEMBER, date: '2026-09-12', teamId: TEAM, kind: 'accept_uncovered', rosterOverrideId: null },
      { memberId: OTHER, date: '2026-09-10', teamId: TEAM_B, kind: 'replace_member', rosterOverrideId: 'override-b' },
    ]);
    expect(conflictResolutionsOf([], [MEMBER], [TEAM])).toEqual([]);
  });

  it('reads a replacement with no link on a member\'s read alone, the pre-0033 shape, and refuses it on the organization\'s', () => {
    const linkless = row(OTHER, '2026-09-10', TEAM_B, 'replace_member');

    expect(conflictResolutionsOf([linkless], [OTHER], [TEAM_B], { linkOptional: true })).toEqual([
      { memberId: OTHER, date: '2026-09-10', teamId: TEAM_B, kind: 'replace_member', rosterOverrideId: null },
    ]);
    expect(conflictResolutionsOf([linkless], [OTHER], [TEAM_B])).toBeNull();
    // A link on another kind is refused on either read.
    expect(conflictResolutionsOf([{ ...A, roster_override_id: 'override-a' }], [MEMBER], [TEAM], { linkOptional: true })).toBeNull();
  });

  it('carries the override a replacement names (story 5.5d), and reads a missing or null link as none', () => {
    expect(
      conflictResolutionsOf(
        [
          { ...B, roster_override_id: 'override-1' },
          { ...A, roster_override_id: null },
        ],
        [MEMBER, OTHER],
        [TEAM, TEAM_B],
      ),
    ).toEqual([
      { memberId: OTHER, date: '2026-09-10', teamId: TEAM_B, kind: 'replace_member', rosterOverrideId: 'override-1' },
      { memberId: MEMBER, date: '2026-09-12', teamId: TEAM, kind: 'accept_uncovered', rosterOverrideId: null },
    ]);
  });

  it('keeps two teams of one member and date apart', () => {
    expect(conflictResolutionsOf([A, row(MEMBER, '2026-09-12', TEAM_B, 'amend_leave')], [MEMBER], [TEAM, TEAM_B])).toHaveLength(2);
  });

  it.each([
    ['an unknown member', [A, row('stranger', '2026-09-12', TEAM)]],
    ['an unknown team', [A, row(MEMBER, '2026-09-13', 'no-such-team')]],
    ['a date that is no calendar date', [row(MEMBER, '2026-02-30', TEAM)]],
    ['a date that is not a date', [row(MEMBER, '12.09.2026', TEAM)]],
    ['an unknown kind', [row(MEMBER, '2026-09-12', TEAM, 'uncovered')]],
    ['no kind', [row(MEMBER, '2026-09-12', TEAM, null)]],
    ['two live rows of one key', [A, row(MEMBER, '2026-09-12', TEAM, 'amend_leave')]],
    ['a row that is not a record', [A, 'row']],
    ['a list for a row', [[A]]],
    ['a link that is not text', [{ ...B, roster_override_id: 7 }]],
    ['an empty link', [{ ...B, roster_override_id: '' }]],
    ['a replacement with no link (0032\'s check)', [{ ...B, roster_override_id: null }]],
    ['an acceptance with a link (0032\'s check)', [{ ...A, roster_override_id: 'override-a' }]],
  ])('refuses the whole answer for %s', (_name, rows) => {
    expect(conflictResolutionsOf(rows, [MEMBER, OTHER], [TEAM, TEAM_B])).toBeNull();
  });
});

describe('the role-gated answer', () => {
  it("is the organization's for a viewer who reads the organization, the viewer's own otherwise", () => {
    const organization: ConflictResolutionRowsAnswer = { isPending: false, isError: false, fetchStatus: 'idle', data: [A] };
    const own: ConflictResolutionRowsAnswer = { isPending: true, isError: false, fetchStatus: 'idle', data: undefined };

    expect(conflictResolutionsAnswerOf(true, organization, own)).toBe(organization);
    expect(conflictResolutionsAnswerOf(false, organization, own)).toBe(own);
  });
});

describe('the split by kind (story 5.4b)', () => {
  it('keeps the keys accepted as uncovered, in order, and no other kind', () => {
    const resolutions: readonly ConflictResolution[] = [
      { memberId: 'm1', date: '2026-09-12', teamId: 't1', kind: ACCEPT_UNCOVERED, rosterOverrideId: null },
      { memberId: 'm1', date: '2026-09-13', teamId: 't1', kind: 'replace_member' as const, rosterOverrideId: null },
      { memberId: 'm2', date: '2026-09-11', teamId: 't2', kind: ACCEPT_UNCOVERED, rosterOverrideId: null },
      { memberId: 'm2', date: '2026-09-14', teamId: 't2', kind: 'amend_leave' as const, rosterOverrideId: null },
    ];

    expect(acceptedUncoveredOf(resolutions)).toEqual([
      { memberId: 'm1', date: '2026-09-12', teamId: 't1' },
      { memberId: 'm2', date: '2026-09-11', teamId: 't2' },
    ]);
    expect(acceptedUncoveredOf([])).toEqual([]);
  });

  it('feeds the leave hours from the accepted and, since story 5.4c, the replaced, in order, never the amend kind', () => {
    const resolutions: readonly ConflictResolution[] = [
      { memberId: 'm1', date: '2026-09-12', teamId: 't1', kind: ACCEPT_UNCOVERED, rosterOverrideId: null },
      { memberId: 'm1', date: '2026-09-13', teamId: 't1', kind: REPLACE_MEMBER, rosterOverrideId: null },
      { memberId: 'm2', date: '2026-09-14', teamId: 't2', kind: 'amend_leave' as const, rosterOverrideId: null },
    ];

    expect(leaveHoursKeysOf(resolutions)).toEqual([
      { memberId: 'm1', date: '2026-09-12', teamId: 't1' },
      { memberId: 'm1', date: '2026-09-13', teamId: 't1' },
    ]);
    expect(leaveHoursKeysOf([])).toEqual([]);
  });
});

describe('the replacement links (story 5.4e)', () => {
  const OVERRIDE = '00000000-0000-4000-8000-0000000000e1';
  const replaced = { ...row(MEMBER, '2026-10-02', TEAM, 'replace_member'), roster_override_id: OVERRIDE };
  const others = { ...row(OTHER, '2026-10-03', TEAM_B, 'replace_member'), roster_override_id: OVERRIDE };

  it("keeps this member's replacements with the override each names, in order, and skips every other kind and member", () => {
    const accepted = { ...A, roster_override_id: null };

    expect(replacementLinksOf([accepted, others, replaced], MEMBER)).toEqual([
      { memberId: MEMBER, date: '2026-10-02', teamId: TEAM, rosterOverrideId: OVERRIDE },
    ]);
    expect(replacementLinksOf([], MEMBER)).toEqual([]);
  });

  it.each([
    ['no override', { roster_override_id: null }],
    ['an empty override', { roster_override_id: '' }],
    ['no team', { team_id: 7 }],
    ['a date that is no date', { date: '2026-02-30' }],
  ])("ignores another member's malformed replacement with %s", (_name, broken) => {
    expect(replacementLinksOf([{ ...others, ...broken }, replaced], MEMBER)).toEqual([
      { memberId: MEMBER, date: '2026-10-02', teamId: TEAM, rosterOverrideId: OVERRIDE },
    ]);
  });

  it.each([
    ['a row that is no record', ['x']],
    ['a row whose member cannot be read', [{ ...others, member_id: null }]],
    ['a row with an empty member', [{ ...A, member_id: '' }]],
    ['a replacement of this member with no override', [{ ...replaced, roster_override_id: null }]],
    ['a replacement of this member with an empty override', [{ ...replaced, roster_override_id: '' }]],
    ['a replacement of this member with no team', [{ ...replaced, team_id: 7 }]],
    ['a replacement of this member with a date that is no date', [{ ...replaced, date: '2026-02-30' }]],
  ])('trusts none of it on %s', (_name, rows) => {
    expect(replacementLinksOf(rows, MEMBER)).toBeNull();
  });
});
