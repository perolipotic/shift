import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ALL_LEVELS,
  ARROW_DOWN,
  ARROW_UP,
  ASCENDING,
  DAYS_CELL,
  DEFAULT_SORT,
  DESCENDING,
  EMAIL_COLUMN,
  LEAVE_COLUMN,
  LEVEL_COLUMN,
  LEVEL_FILTERS,
  MEMBERS_COLUMNS,
  MEMBERS_COUNT,
  MEMBERS_LIST_KEY,
  MEMBERS_REFUSED,
  MEMBERS_TABLE,
  MEMBERS_UNAVAILABLE,
  MEMBERS_READ_STALE_MS,
  MEMBER_COLUMNS,
  NAME_COLUMN,
  NOT_A_ROW,
  NO_TEXT,
  TEXT_CELL,
  LEVEL_CELL,
  UNSORTED,
  cellClassNameOf,
  chooseLevel,
  foldForSearch,
  levelFilterMessageKey,
  mayReadMembers,
  memberLevelMessageKey,
  memberListRowOf,
  memberRowOutcomeOf,
  membersMessageKey,
  membersSurfaceStateOf,
  narrowFrom,
  narrowMembers,
  narrowingDependencies,
  nextSortState,
  readMembers,
  sortIndicatorOf,
  sortStateOf,
  type MemberListRow,
  type MembersAnswer,
  type MembersQueryAnswer,
  type MembersTable,
  type NarrowingInputs,
  type SortState,
} from '@/members/list';
import { MEMBER_ROLES } from '@/navigation/role';

/**
 * The member list's rules, EXECUTED (story 1.5a).
 *
 * This file exists because `routes/ljudi.tsx` cannot be tested at all: AD-15
 * bans jsdom and `apps/web/vitest.config.ts` collects `src/**\/*.test.ts` only,
 * so a rule written in the screen is asserted by nothing but a regex over its
 * own source. The 1.5a review proved what that is worth by mutating code and
 * watching the suite stay green — a reordered `MEMBER_ROLES` inverted the route
 * guard with 852 tests passing, and two swapped header sort keys were invisible.
 * So every decision the surface makes is a function here, and every one of them
 * is called with values rather than read as text.
 *
 * SEVERAL HUNDRED ROWS, not three. Q20 asks the list to stay usable at that
 * size and `0002:141-148` names story 1.5 as the one that proves it; the
 * behavioural half of that proof is here (the narrowing is correct and total at
 * scale), and the transport half is `test/rls-isolation.test.ts`, which measures
 * one real round trip against a fixture it grows itself.
 */

/** Q20's scale, as a number this file sorts, searches and counts at. */
const SCALE = 400;

/** A member, with everything but the interesting field held still. */
function member(fields: Partial<MemberListRow> & { readonly id: string }): MemberListRow {
  return {
    organizationId: 'organization',
    name: 'Ana Anić',
    email: null,
    role: 'member_role',
    leaveAllowanceDays: 20,
    ...fields,
  };
}

/**
 * `SCALE` members of one organization, deterministic and varied.
 *
 * Every field the surface reads varies across the set — name, address (a tenth
 * of them have none), level and allowance — so a narrowing that silently ignored
 * one of them would produce a different answer here rather than the same one.
 */
function atScale(): MemberListRow[] {
  const names = ['Ana', 'Boris', 'Cvita', 'Čedo', 'Đuro', 'Ema', 'Filip', 'Goran', 'Žana'];

  return Array.from({ length: SCALE }, (_unused, index) =>
    member({
      id: `member-${String(index)}`,
      name: `${names[index % names.length] ?? 'Ana'} ${String(index).padStart(4, '0')}`,
      email: index % 10 === 0 ? null : `osoba${String(index)}@dvd.hr`,
      role: index % 7 === 0 ? 'admin' : 'member_role',
      leaveAllowanceDays: 15 + (index % 11),
    }),
  );
}

/** One PostgREST row, spelled the way the transport spells it. */
function row(fields: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return {
    organization_id: 'organization',
    id: 'member',
    name: 'Ana Anić',
    email: null,
    role: 'member_role',
    leave_allowance_days: 20,
    ...fields,
  };
}

interface Asked {
  readonly columns: string;
  readonly options: unknown;
}

/**
 * A table that answers once, and records what it was asked for.
 *
 * The structural seam is the whole reason this is four lines rather than a
 * running stack: `readMembers` names one call, so a stub does not have to
 * impersonate the rest of PostgREST.
 */
function answering(answer: Partial<MembersAnswer>, asked: Asked[] = []): MembersTable {
  return {
    select(columns, options) {
      asked.push({ columns, options });

      return Promise.resolve({ data: null, error: null, count: null, ...answer });
    },
  };
}

/** A table whose one call rejects — the transport failing outside postgrest-js. */
function rejecting(): MembersTable {
  return {
    select() {
      return Promise.reject(new Error('the request never landed'));
    },
  };
}

let logged: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // Every failure in this module logs its cause, and a suite that let those
  // through would bury a real failure in expected noise. Silenced, never
  // removed: the assertions below still read what was logged.
  logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  logged.mockRestore();
});

describe('the read asks for exactly what the surface needs, and for the count', () => {
  it('names the relation, one query key and one column list, so no component holds any', () => {
    expect(MEMBERS_TABLE).toBe('members');
    expect(MEMBERS_LIST_KEY).toEqual(['members']);
    expect(MEMBERS_COUNT).toEqual({ count: 'exact' });
  });

  it('selects organization_id, which nothing renders', async () => {
    // THE TRIPWIRE'S OWN COLUMN. Dropping it from the select leaves every other
    // assertion in this file passing while the cross-organization case below
    // silently reads `undefined` on every row and finds one distinct value.
    const asked: Asked[] = [];

    await readMembers(answering({ data: [row({})], count: 1 }, asked));

    expect(asked).toHaveLength(1);
    expect(asked[0]?.columns.split(','), 'organization_id is no longer selected').toContain(
      'organization_id',
    );
    expect(asked[0]?.options, 'the read no longer asks for an exact count').toEqual({
      count: 'exact',
    });
  });

  it('selects the four renderable fields and nothing that is not one (Q5)', () => {
    // Q5: no health data, no absence-reason field. Asserted over the column
    // LIST rather than over a rendered row, because the list is what a widening
    // would edit — and an exact set, so a column added for a later story has to
    // be argued for here first.
    expect(MEMBERS_COLUMNS.split(',').sort()).toEqual(
      ['email', 'id', 'leave_allowance_days', 'name', 'organization_id', 'role'].sort(),
    );
  });

  it('maps a row field by field rather than casting it', () => {
    expect(
      memberListRowOf(
        row({ id: 'm1', name: 'Ivan Marić', email: 'ivan@dvd.hr', role: 'admin', leave_allowance_days: 25 }),
      ),
    ).toEqual({
      id: 'm1',
      organizationId: 'organization',
      name: 'Ivan Marić',
      email: 'ivan@dvd.hr',
      role: 'admin',
      leaveAllowanceDays: 25,
    });
  });

  it('admits a missing address as null, because the column is nullable', () => {
    expect(memberListRowOf(row({ email: null }))?.email).toBeNull();
    // A non-string in the column is not an address either, and must not reach
    // the fold as one.
    expect(memberListRowOf(row({ email: 17 }))?.email).toBeNull();
  });

  it.each([
    { field: 'id', value: null },
    { field: 'organization_id', value: undefined },
    { field: 'name', value: 42 },
    { field: 'leave_allowance_days', value: '20' },
    { field: 'role', value: 'supervisor' },
  ])('refuses a row whose $field is not what the schema says', ({ field, value }) => {
    // NARROWED BY A GUARD, never a cast. `'supervisor'` is the case that
    // matters most: cast through, the level column would render whatever an
    // inexhaustive label mapping returned for it.
    expect(memberListRowOf(row({ [field]: value }))).toBeNull();
  });

  it('refuses something that is not a row at all', () => {
    expect(memberListRowOf(null)).toBeNull();
    expect(memberListRowOf('a row')).toBeNull();
    expect(memberListRowOf([])).toBeNull();
  });
});

describe('what the read does when the answer cannot be trusted', () => {
  it('returns every member when the answer is whole', async () => {
    const outcome = await readMembers(
      answering({ data: [row({ id: 'a' }), row({ id: 'b' })], count: 2 }),
    );

    expect(outcome).toEqual({
      ok: true,
      members: [
        member({ id: 'a' }),
        member({ id: 'b' }),
      ],
    });
  });

  it('treats zero rows as a refusal rather than as an empty organization', async () => {
    // Row level security refuses by failing USING: the statement matches
    // nothing and raises nothing. An organization always holds at least the
    // caller, so zero rows is the policy declining — and an empty table under a
    // confident `0` would say the organization has no people in it.
    expect(await readMembers(answering({ data: [], count: 0 }))).toEqual({
      ok: false,
      code: MEMBERS_REFUSED,
    });
    expect(await readMembers(answering({ data: null, count: null }))).toEqual({
      ok: false,
      code: MEMBERS_REFUSED,
    });
  });

  it('refuses a truncated answer rather than presenting a short list as a complete one', async () => {
    // `supabase/config.toml:15` caps PostgREST at `max_rows = 1000` and nothing
    // paginates, so this is the whole of the defence: the count is the
    // organization's real size and the rows are what arrived.
    const rows = Array.from({ length: 3 }, (_unused, index) => row({ id: `m${String(index)}` }));

    expect(await readMembers(answering({ data: rows, count: SCALE }))).toEqual({
      ok: false,
      code: MEMBERS_UNAVAILABLE,
    });
    expect(logged, 'a truncated answer is refused with nothing said about it').toHaveBeenCalledWith(
      MEMBERS_UNAVAILABLE,
      SCALE,
      3,
    );
  });

  it('accepts an answer the transport gave no count for, rather than refusing every read', async () => {
    // The count can be absent — a proxy stripping `Content-Range`, a transport
    // that answers without one — and refusing on its absence would take the
    // surface down for a header rather than for a wrong answer. There is
    // nothing to compare, so there is nothing to refuse.
    expect(await readMembers(answering({ data: [row({})], count: null }))).toMatchObject({
      ok: true,
    });
  });

  it('accepts an answer holding more rows than the count claims', async () => {
    // Only the SHORT direction is a truncation. More rows than the count is a
    // count computed a moment earlier against a row inserted since, which is an
    // ordinary race and not a reason to blank the screen.
    expect(
      await readMembers(answering({ data: [row({ id: 'a' }), row({ id: 'b' })], count: 1 })),
    ).toMatchObject({ ok: true });
  });

  it('fails closed when the answer spans more than one organization', async () => {
    // The shape a widened `members_select_own_organization` produces. It is a
    // client-side tripwire rather than a boundary — AD-10 keeps the boundary in
    // the database — and what it proves is that the answer describes ONE
    // organization, not that the one it describes is the caller's.
    expect(
      await readMembers(
        answering({
          data: [row({ id: 'a' }), row({ id: 'b', organization_id: 'another-organization' })],
          count: 2,
        }),
      ),
    ).toEqual({ ok: false, code: MEMBERS_UNAVAILABLE });
  });

  it('refuses a malformed row rather than dropping it from the list', async () => {
    // A list quietly missing the member whose row was malformed is a wrong
    // answer presented as a right one — the same fail-open the truncation check
    // refuses, arriving one row at a time.
    expect(
      await readMembers(answering({ data: [row({}), row({ name: null })], count: 2 })),
    ).toEqual({ ok: false, code: MEMBERS_UNAVAILABLE });
  });

  it('maps a PostgREST error to the try-again code rather than to a refusal', async () => {
    // AN ERROR IS NEVER A REFUSAL on this table: a refused policy returns an
    // empty row set and raises nothing, so an error is a transport or schema
    // fault, and calling it "you have no access" sends an entitled admin to ask
    // for rights they already hold.
    expect(
      await readMembers(answering({ data: null, error: { code: '42703' }, count: null })),
    ).toEqual({ ok: false, code: MEMBERS_UNAVAILABLE });
    expect(logged).toHaveBeenCalledWith(MEMBERS_UNAVAILABLE, { code: '42703' });
  });

  it('maps a rejected call to the try-again code rather than letting it escape', async () => {
    expect(await readMembers(rejecting())).toEqual({ ok: false, code: MEMBERS_UNAVAILABLE });
    expect(logged, 'the cause of a rejected read is discarded').toHaveBeenCalledWith(
      MEMBERS_UNAVAILABLE,
      expect.anything(),
    );
  });

  it('keeps the two codes distinct, so the mapping is not a constant', async () => {
    const refused = await readMembers(answering({ data: [], count: 0 }));
    const unavailable = await readMembers(rejecting());

    expect(refused).not.toEqual(unavailable);
  });

  it('reads several hundred rows without losing one', async () => {
    const rows = Array.from({ length: SCALE }, (_unused, index) =>
      row({ id: `member-${String(index)}` }),
    );
    const outcome = await readMembers(answering({ data: rows, count: SCALE }));

    expect(outcome.ok).toBe(true);
    expect(outcome.ok ? outcome.members : []).toHaveLength(SCALE);
  });
});

describe('the level the guard admits is the one the rank order names', () => {
  it('pins the top level to the literal admin, so a reorder cannot invert the guard', () => {
    // THE LITERAL, and deliberately not `MEMBER_ROLES[0]` compared against
    // itself. This is the assertion the 1.5a review's mutation had to fail and
    // did not: swapping `MEMBER_ROLES` to `['member_role', 'admin']` left the
    // whole suite green while members read every colleague's address and
    // administrators were forwarded away.
    expect(MEMBER_ROLES[0]).toBe('admin');
    expect([...MEMBER_ROLES]).toEqual(['admin', 'member_role']);
  });

  it('admits admin and refuses member_role, by name', () => {
    // LITERALS AGAIN rather than values derived from the array, for the same
    // reason: a decision expressed only in terms of the thing that can move
    // moves with it.
    expect(mayReadMembers({ ok: true, role: 'admin' })).toBe(true);
    expect(mayReadMembers({ ok: true, role: 'member_role' })).toBe(false);
  });

  it('refuses every outcome that is not a level at all', () => {
    // FAILING CLOSED. A read that could not complete is not an administrator's
    // level, and this is the polarity a widened guard — `mayReadMembers(o) ||
    // o.ok` — passes while admitting every signed-in member.
    expect(mayReadMembers({ ok: false, code: 'MEMBER_ROLE_REFUSED' })).toBe(false);
    expect(mayReadMembers({ ok: false, code: 'MEMBER_ROLE_UNRECOGNISED' })).toBe(false);
    expect(mayReadMembers({ ok: false, code: 'MEMBER_ROLE_UNAVAILABLE' })).toBe(false);
  });
});

describe('the four columns are one table, so a heading and its sort key cannot drift', () => {
  it('pins every column, its heading key and its order', () => {
    // WHAT NOTHING ELSE BINDS. Swapping the sort keys carried by two headings
    // is a two-character edit in a component that no test executes, and the
    // 1.5a review shipped exactly that green. Here the pairing is data, and
    // this is the assertion it has to survive.
    expect(MEMBER_COLUMNS.map((column) => [column.key, column.label])).toEqual([
      [NAME_COLUMN, 'ljudi.name'],
      [EMAIL_COLUMN, 'ljudi.email'],
      [LEVEL_COLUMN, 'ljudi.role'],
      [LEAVE_COLUMN, 'ljudi.leave'],
    ]);
  });

  it('carries no team, hours or active column', () => {
    // Each absence is a decision: `members` has no `team_id` until story 1.7,
    // hours are epic 4, and active state lives in `auth.users` (AD-2) with
    // story 1.6 versioning it.
    expect(MEMBER_COLUMNS).toHaveLength(4);
    for (const forbidden of ['team', 'hours', 'active']) {
      expect(MEMBER_COLUMNS.map((column) => String(column.key))).not.toContain(forbidden);
    }
  });

  it('reads each column sort value off the field it names', () => {
    const one = member({ id: 'm', name: 'Ana', email: 'ana@dvd.hr', role: 'admin', leaveAllowanceDays: 25 });
    const values = Object.fromEntries(
      MEMBER_COLUMNS.map((column) => [column.key, column.sortValue(one)]),
    );

    expect(values[NAME_COLUMN]).toBe('Ana');
    expect(values[EMAIL_COLUMN]).toBe('ana@dvd.hr');
    // BY RANK, never by the column text: `'admin' < 'member_role'` is an
    // accident of the two spellings and would reorder itself the day a third
    // level is named.
    expect(values[LEVEL_COLUMN]).toBe(0);
    expect(values[LEAVE_COLUMN]).toBe(25);
  });

  it('reports a member with no address as having no value to sort by', () => {
    const column = MEMBER_COLUMNS.find((candidate) => candidate.key === EMAIL_COLUMN);

    expect(column?.sortValue(member({ id: 'm', email: null }))).toBeNull();
  });
});

describe('pressing a heading', () => {
  it('starts a newly pressed column ascending rather than inheriting a direction', () => {
    const descending: SortState = { key: NAME_COLUMN, direction: DESCENDING };

    expect(nextSortState(descending, LEAVE_COLUMN)).toEqual({
      key: LEAVE_COLUMN,
      direction: ASCENDING,
    });
  });

  it('toggles the direction of the column already sorted, in both directions', () => {
    const ascending: SortState = { key: NAME_COLUMN, direction: ASCENDING };
    const descending = nextSortState(ascending, NAME_COLUMN);

    expect(descending).toEqual({ key: NAME_COLUMN, direction: DESCENDING });
    expect(nextSortState(descending, NAME_COLUMN)).toEqual(ascending);
  });

  it('opens by name, ascending, because a table is never unsorted', () => {
    expect(DEFAULT_SORT).toEqual({ key: NAME_COLUMN, direction: ASCENDING });
  });

  it('reports the sorted column to assistive technology and the others as none', () => {
    const sort: SortState = { key: LEAVE_COLUMN, direction: DESCENDING };

    expect(sortStateOf(sort, LEAVE_COLUMN)).toBe(DESCENDING);
    expect(sortStateOf(sort, NAME_COLUMN)).toBe(UNSORTED);
    // The ARIA vocabulary itself, so a rename of these constants is a failure
    // rather than an attribute a screen reader ignores.
    expect([ASCENDING, DESCENDING, UNSORTED]).toEqual(['ascending', 'descending', 'none']);
  });
});

describe('the search folds Croatian the way a person types it', () => {
  it.each([
    { typed: 'Maric', held: 'Marić' },
    { typed: 'Duric', held: 'Đurić' },
    { typed: 'Cavic', held: 'Čavić' },
    { typed: 'Suker', held: 'Šuker' },
    { typed: 'Zeljko', held: 'Željko' },
  ])('finds $held when $typed is typed', ({ typed, held }) => {
    expect(foldForSearch(held)).toContain(foldForSearch(typed));
  });

  it('folds đ, which NFD leaves untouched', () => {
    // THE ONE CASE A NAIVE FOLD MISSES. `đ` is U+0111, a letter in its own
    // right with no decomposition, so `normalize('NFD')` alone leaves `Đurić`
    // unfindable by typing `Duric`.
    expect('đ'.normalize('NFD')).toBe('đ');
    expect(foldForSearch('Đuro')).toBe('duro');
  });

  it.each([
    { digraph: 'Ǆ', folded: 'dz' },
    { digraph: 'ǅ', folded: 'dz' },
    { digraph: 'ǆ', folded: 'dz' },
    { digraph: 'Ǉ', folded: 'lj' },
    { digraph: 'ǈ', folded: 'lj' },
    { digraph: 'ǉ', folded: 'lj' },
    { digraph: 'Ǌ', folded: 'nj' },
    { digraph: 'ǋ', folded: 'nj' },
    { digraph: 'ǌ', folded: 'nj' },
  ])('folds the precomposed digraph $digraph to $folded', ({ digraph, folded }) => {
    // NFD does not touch these either — they are compatibility characters, not
    // precomposed accents — so a name pasted from a system that emits them is
    // unfindable by typing the two letters a Croatian keyboard produces.
    expect(digraph.normalize('NFD')).toBe(digraph);
    expect(foldForSearch(digraph)).toBe(folded);
  });

  it('folds a precomposed digraph inside a real surname', () => {
    expect(foldForSearch('ǅupanǉević')).toBe('dzupanljevic');
  });

  it('is case blind in both directions', () => {
    expect(foldForSearch('ŽELJKO')).toBe(foldForSearch('željko'));
  });
});

describe('narrowing produces the rows and the counts from one traversal', () => {
  const sorted: SortState = { key: NAME_COLUMN, direction: ASCENDING };

  it('returns every member when nothing is searched or filtered', () => {
    const members = atScale();
    const narrowed = narrowMembers(members, '', ALL_LEVELS, sorted);

    expect(narrowed.rows).toHaveLength(SCALE);
    expect(narrowed.counts[ALL_LEVELS]).toBe(SCALE);
  });

  it('counts every level against the rows the same call produced', () => {
    // THE DRIFT THIS EXISTS TO PREVENT: a filter promising twelve beside three
    // rows. The counts and the rows come out of one traversal, so this asserts
    // they agree rather than that two computations happen to.
    const members = atScale();
    const narrowed = narrowMembers(members, '', ALL_LEVELS, sorted);

    for (const level of LEVEL_FILTERS) {
      if (level === ALL_LEVELS) continue;

      expect(narrowMembers(members, '', level, sorted).rows).toHaveLength(narrowed.counts[level]);
    }
    expect(narrowed.counts['admin'] + narrowed.counts['member_role']).toBe(SCALE);
    expect(narrowed.counts['admin']).toBeGreaterThan(0);
  });

  it('counts each level over the SEARCH rather than over the chosen level', () => {
    // Each option says how many rows CHOOSING it would produce from what is
    // searched. Counted after the level filter, every option but the chosen one
    // would read zero and the control would be useless.
    const members = [
      member({ id: 'a', name: 'Ana', role: 'admin' }),
      member({ id: 'b', name: 'Boris', role: 'member_role' }),
      member({ id: 'c', name: 'Ana Marija', role: 'member_role' }),
    ];
    const narrowed = narrowMembers(members, 'ana', 'admin', sorted);

    expect(narrowed.rows.map((found) => found.id)).toEqual(['a']);
    expect(narrowed.counts).toEqual({ [ALL_LEVELS]: 2, admin: 1, member_role: 1 });
  });

  it('searches the name and the address and nothing else', () => {
    const members = [
      member({ id: 'a', name: 'Ana', email: 'ana@dvd.hr' }),
      member({ id: 'b', name: 'Boris', email: 'boris@zastita.hr' }),
      member({ id: 'c', name: 'Cvita', email: null }),
    ];

    expect(narrowMembers(members, 'zastita', ALL_LEVELS, sorted).rows.map((f) => f.id)).toEqual([
      'b',
    ]);
    expect(narrowMembers(members, 'cvita', ALL_LEVELS, sorted).rows.map((f) => f.id)).toEqual([
      'c',
    ]);
    // The organization id is selected and is not searchable: it renders
    // nowhere, and matching it would make every row match every search.
    expect(narrowMembers(members, 'organization', ALL_LEVELS, sorted).rows).toEqual([]);
  });

  it('states zero as a count rather than matching everything when nothing matches', () => {
    const narrowed = narrowMembers(atScale(), 'nitko-ovdje', ALL_LEVELS, sorted);

    expect(narrowed.rows).toEqual([]);
    expect(narrowed.counts[ALL_LEVELS]).toBe(0);
    expect(narrowed.counts['admin']).toBe(0);
    expect(narrowed.counts['member_role']).toBe(0);
  });

  it('ignores the whitespace around a search rather than matching on it', () => {
    expect(
      narrowMembers([member({ id: 'a', name: 'Ana' })], '  ana  ', ALL_LEVELS, sorted).rows,
    ).toHaveLength(1);
  });

  it('finds a diacritic name typed without one, at scale', () => {
    // `Đuro` and `Čedo` are in the generated set, and both are unreachable
    // without the fold.
    expect(narrowMembers(atScale(), 'duro', ALL_LEVELS, sorted).rows.length).toBeGreaterThan(0);
    expect(narrowMembers(atScale(), 'cedo', ALL_LEVELS, sorted).rows.length).toBeGreaterThan(0);
  });
});

describe('the order is Croatian, and an address-less member has a place in it', () => {
  const byName = (direction: typeof ASCENDING | typeof DESCENDING): SortState => ({
    key: NAME_COLUMN,
    direction,
  });

  it('collates rather than comparing code units', () => {
    // `<` puts every diacritic after `z`, so `Čavić` would land after `Zoran`
    // and beside nothing a Croatian reader expects.
    const members = [
      member({ id: 'z', name: 'Zoran' }),
      member({ id: 'c', name: 'Čavić' }),
      member({ id: 'k', name: 'Cvitanović' }),
    ];

    expect(
      narrowMembers(members, '', ALL_LEVELS, byName(ASCENDING)).rows.map((found) => found.id),
    ).toEqual(['k', 'c', 'z']);
    // What `<` would have produced, stated so the disagreement is visible.
    expect([...members].sort((a, b) => (a.name < b.name ? -1 : 1)).map((f) => f.id)).toEqual([
      'k',
      'z',
      'c',
    ]);
  });

  it('reverses the order when the direction does', () => {
    const members = [
      member({ id: 'z', name: 'Zoran' }),
      member({ id: 'c', name: 'Čavić' }),
      member({ id: 'k', name: 'Cvitanović' }),
    ];

    expect(
      narrowMembers(members, '', ALL_LEVELS, byName(DESCENDING)).rows.map((found) => found.id),
    ).toEqual(['z', 'c', 'k']);
  });

  it.each([ASCENDING, DESCENDING] as const)(
    'puts an address-less member last when sorting by address %s',
    (direction) => {
      // PINNED IN BOTH DIRECTIONS, and this is the assertion the obvious
      // implementation fails: sorting with `null` as the empty string puts the
      // address-less member first ascending and first-reversed-to-last
      // descending, so exactly one of the two directions looks right. A member
      // with no address has no place in an alphabetical order at all, so they
      // are appended either way.
      const members = [
        member({ id: 'none', name: 'Ana', email: null }),
        member({ id: 'a', name: 'Boris', email: 'a@dvd.hr' }),
        member({ id: 'z', name: 'Cvita', email: 'z@dvd.hr' }),
      ];
      const ordered = narrowMembers(members, '', ALL_LEVELS, {
        key: EMAIL_COLUMN,
        direction,
      }).rows.map((found) => found.id);

      expect(ordered[ordered.length - 1], 'an address-less member moved out of last place').toBe(
        'none',
      );
      expect(ordered.slice(0, 2)).toEqual(direction === ASCENDING ? ['a', 'z'] : ['z', 'a']);
    },
  );

  it('sorts the permission level by rank, most privileged first', () => {
    const members = [
      member({ id: 'm', name: 'Ana', role: 'member_role' }),
      member({ id: 'a', name: 'Boris', role: 'admin' }),
    ];

    expect(
      narrowMembers(members, '', ALL_LEVELS, {
        key: LEVEL_COLUMN,
        direction: ASCENDING,
      }).rows.map((found) => found.id),
    ).toEqual(['a', 'm']);
  });

  it('sorts the allowance numerically rather than as text', () => {
    // `'9' > '10'` as text, which is the defect a string sort over a numeric
    // column produces and the only one it produces visibly.
    const members = [
      member({ id: 'nine', name: 'Ana', leaveAllowanceDays: 9 }),
      member({ id: 'ten', name: 'Boris', leaveAllowanceDays: 10 }),
    ];

    expect(
      narrowMembers(members, '', ALL_LEVELS, {
        key: LEAVE_COLUMN,
        direction: ASCENDING,
      }).rows.map((found) => found.id),
    ).toEqual(['nine', 'ten']);
  });

  it('orders several hundred rows totally, losing and duplicating none', () => {
    const members = atScale();

    for (const column of MEMBER_COLUMNS) {
      for (const direction of [ASCENDING, DESCENDING] as const) {
        const ordered = narrowMembers(members, '', ALL_LEVELS, { key: column.key, direction }).rows;

        expect(ordered, `sorting by ${column.key} ${direction} lost a member`).toHaveLength(SCALE);
        expect(
          new Set(ordered.map((found) => found.id)).size,
          `sorting by ${column.key} ${direction} duplicated a member`,
        ).toBe(SCALE);
      }
    }
  });
});

describe('the filter names every level it can produce, and falls back rather than casting', () => {
  it('offers every level plus all of them, in binding order', () => {
    expect([...LEVEL_FILTERS]).toEqual(['all', 'admin', 'member_role']);
  });

  it('falls back to every level for a value outside its own vocabulary', () => {
    // A `<select>`'s value is a string as far as the DOM is concerned. Cast,
    // `'supervisor'` would be a `LevelFilter` the type system believes in and
    // the narrowing would match no row at all — an empty list with no
    // explanation. Showing too much is the harmless direction.
    expect(chooseLevel('supervisor')).toBe(ALL_LEVELS);
    expect(chooseLevel('')).toBe(ALL_LEVELS);
  });

  it('keeps a value that IS a level', () => {
    expect(chooseLevel('admin')).toBe('admin');
    expect(chooseLevel('member_role')).toBe('member_role');
  });
});

describe('every code and every level resolves to its own message', () => {
  it('maps each failure to a distinct key', () => {
    expect(membersMessageKey(MEMBERS_REFUSED)).toBe('ljudi.error.refused');
    expect(membersMessageKey(MEMBERS_UNAVAILABLE)).toBe('ljudi.error.unavailable');
    expect(membersMessageKey(MEMBERS_REFUSED)).not.toBe(membersMessageKey(MEMBERS_UNAVAILABLE));
  });

  it('maps each level to its own label rather than defaulting to the member one', () => {
    // THE MUTATION THIS REFUSES is a binary ternary: `role === 'admin' ? … : …`
    // renders an unrecognised level as `Član`, which tells an administrator
    // whose level a newer build wrote that they are an ordinary member.
    expect(memberLevelMessageKey('admin')).toBe('ljudi.admin');
    expect(memberLevelMessageKey('member_role')).toBe('ljudi.member');
  });

  it('maps each filter option to its own counted label', () => {
    expect(levelFilterMessageKey(ALL_LEVELS)).toBe('ljudi.filterAll');
    expect(levelFilterMessageKey('admin')).toBe('ljudi.filterAdmin');
    expect(levelFilterMessageKey('member_role')).toBe('ljudi.filterMember');
  });

  it('gives every option a key of its own, so the mapping is not a constant', () => {
    expect(new Set(LEVEL_FILTERS.map(levelFilterMessageKey)).size).toBe(LEVEL_FILTERS.length);
  });

  it.each([
    { name: 'the level label', map: memberLevelMessageKey, wrong: 'ljudi.member' },
    { name: 'the filter option', map: levelFilterMessageKey, wrong: 'ljudi.filterMember' },
    { name: 'the refusal', map: membersMessageKey, wrong: 'ljudi.error.unavailable' },
  ])('returns a value $name has never been taught as itself, not as $wrong', ({ map, wrong }) => {
    // THE PROBE THE `never` ALONE DOES NOT CATCH, and the reason these are
    // written as `x === 'a'` … `x === 'b'` rather than `x === 'a'` … else.
    // While the union holds two members the two forms are behaviourally
    // identical AND both typecheck — `role !== 'admin'` narrows the fall-through
    // to `never` just as `role === 'member_role'` does — so `pnpm typecheck`
    // says nothing and every other assertion in this file passes. The
    // difference only appears when a THIRD level exists, and by then the
    // else-form has already shipped, silently labelling it `Član`.
    //
    // A CAST, deliberately and only here: the point is what happens when the
    // runtime carries a value the types rule out, which is exactly the case
    // `memberRoleIn` exists because the database can produce. What each mapping
    // must do is hand the value back — `t()` renders it as a visibly missing
    // key (L5) rather than as a confident lie.
    const unknown = 'supervisor';

    expect((map as (value: string) => string)(unknown)).not.toBe(wrong);
    expect((map as (value: string) => string)(unknown)).toBe(unknown);
  });
});

describe('the column says what its cell holds, so the screen cannot swap two', () => {
  /**
   * THE MUTATION THIS EXISTS FOR, demonstrated in review: swapping the name and
   * address branches of the screen's own `cellText` shipped 864/864 green,
   * rendering every member's email address under the heading `Ime`. Nothing
   * could have caught it — `routes/ljudi.tsx` is a `.tsx` and vitest collects
   * `src/**\/*.test.ts` in a node environment (AD-15), so it is executed by
   * nothing at all. The rendered VALUE is therefore the column's, pinned here
   * exactly as `sortValue` is, and the screen only knows how to draw each kind.
   */

  const one = member({
    id: 'm',
    name: 'Ivan Marić',
    email: 'ivan@dvd.hr',
    role: 'admin',
    leaveAllowanceDays: 25,
  });

  function cellFor(key: string): unknown {
    return MEMBER_COLUMNS.find((column) => column.key === key)?.cell(one);
  }

  it('gives each column the value that column is named for', () => {
    expect(cellFor(NAME_COLUMN)).toEqual({ kind: TEXT_CELL, text: 'Ivan Marić' });
    expect(cellFor(EMAIL_COLUMN)).toEqual({ kind: TEXT_CELL, text: 'ivan@dvd.hr' });
    expect(cellFor(LEVEL_COLUMN)).toEqual({ kind: LEVEL_CELL, level: 'admin' });
    expect(cellFor(LEAVE_COLUMN)).toEqual({ kind: DAYS_CELL, days: 25 });
  });

  it('never gives one column another column value', () => {
    // The swap stated directly, in both directions, so a transposed table fails
    // on the sentence a reader would write rather than on a deep-equal diff.
    expect(cellFor(NAME_COLUMN)).not.toEqual(cellFor(EMAIL_COLUMN));
    expect(cellFor(NAME_COLUMN)).not.toMatchObject({ text: one.email });
    expect(cellFor(EMAIL_COLUMN)).not.toMatchObject({ text: one.name });
  });

  it('renders an address-less member as an empty cell rather than a sentence', () => {
    // UX-DR20 states facts rather than absences, and the honest fact about an
    // empty column is that it is empty. `Nema` is banned outright in
    // `test/localization-applied.test.ts`.
    const column = MEMBER_COLUMNS.find((candidate) => candidate.key === EMAIL_COLUMN);

    expect(column?.cell(member({ id: 'm', email: null }))).toEqual({
      kind: TEXT_CELL,
      text: NO_TEXT,
    });
  });

  it('marks exactly the numeric column as numeric, and gives it tabular numerals', () => {
    // UX-DR40. The leave allowance is the first aligned numeric column in the
    // application, and a column of figures whose glyphs are proportionally
    // spaced wobbles from row to row.
    expect(MEMBER_COLUMNS.filter((column) => column.numeric).map((column) => column.key)).toEqual([
      LEAVE_COLUMN,
    ]);
    for (const column of MEMBER_COLUMNS) {
      expect(cellClassNameOf(column).includes('tabular-nums'), `${column.key}`).toBe(column.numeric);
      expect(cellClassNameOf(column).includes('text-right'), `${column.key}`).toBe(column.numeric);
    }
  });
});

describe('the sort indicator and aria-sort are one decision', () => {
  /**
   * An arrow pointing the wrong way is worse than no arrow, because it
   * contradicts a correct `aria-sort` on the same element — a sighted person and
   * a screen-reader user are then told opposite things about the same column.
   * The direction was a ternary in the screen, which vitest never runs, so
   * inverting it shipped green.
   */

  it.each(MEMBER_COLUMNS.map((column) => column.key))(
    'points the arrow the way aria-sort reports, on %s',
    (key) => {
      for (const direction of [ASCENDING, DESCENDING] as const) {
        const sort: SortState = { key, direction };

        expect(sortIndicatorOf(sort, key)).toBe(direction === ASCENDING ? ARROW_UP : ARROW_DOWN);
        expect(sortStateOf(sort, key)).toBe(direction);
      }
    },
  );

  it('shows no arrow on a column that is not sorted, where aria-sort says none', () => {
    const sort: SortState = { key: NAME_COLUMN, direction: ASCENDING };

    for (const column of MEMBER_COLUMNS) {
      const sorted = column.key === NAME_COLUMN;

      expect(sortIndicatorOf(sort, column.key) === null).toBe(!sorted);
      expect(sortStateOf(sort, column.key) === UNSORTED).toBe(!sorted);
    }
  });

  it('names a direction rather than a glyph, so the screen owns only the drawing', () => {
    expect([ARROW_UP, ARROW_DOWN]).toEqual(['up', 'down']);
    expect(ARROW_UP).not.toBe(ARROW_DOWN);
  });
});

describe('the four things the surface can be showing', () => {
  /**
   * DERIVED HERE AND EXECUTED, because it was four lines of conditional in the
   * screen and the screen is executed by nothing: replacing
   * `answer.isError || paused` with `paused` shipped green, and a thrown query
   * function then rendered headings with no rows, no count and no message.
   */

  const rows = [member({ id: 'a' })];
  const settled: MembersQueryAnswer = {
    isPending: false,
    isError: false,
    fetchStatus: 'idle',
    data: { ok: true, members: rows },
  };

  it('draws the rows when the read answered', () => {
    expect(membersSurfaceStateOf(settled)).toEqual({ members: rows, refusal: null, loading: false });
  });

  it('pulses the skeleton while the read is in flight', () => {
    expect(
      membersSurfaceStateOf({
        isPending: true,
        isError: false,
        fetchStatus: 'fetching',
        data: undefined,
      }),
    ).toEqual({ members: null, refusal: null, loading: true });
  });

  it.each([MEMBERS_REFUSED, MEMBERS_UNAVAILABLE] as const)(
    'shows the message and no table when the read answered %s',
    (code) => {
      expect(
        membersSurfaceStateOf({
          isPending: false,
          isError: false,
          fetchStatus: 'idle',
          data: { ok: false, code },
        }),
      ).toEqual({ members: null, refusal: code, loading: false });
    },
  );

  it('shows a message rather than empty headings when the query function threw', () => {
    // THE MUTATION: `answer.isError || paused` narrowed to `paused`. `readMembers`
    // maps every failure it knows about, but the query function can still reject
    // before reaching it — `supabaseClient()` raises on a build with no
    // environment — and `data` is then `undefined` with `isError` true.
    const state = membersSurfaceStateOf({
      isPending: false,
      isError: true,
      fetchStatus: 'idle',
      data: undefined,
    });

    expect(state.refusal, 'a thrown query function reports nothing at all').toBe(
      MEMBERS_UNAVAILABLE,
    );
    expect(state.loading, 'a thrown query function leaves the skeleton pulsing').toBe(false);
  });

  it('explains a paused fetch rather than pulsing for ever', () => {
    // TanStack Query pauses rather than fails when the browser reports itself
    // offline: `isPending` stays true with nothing in flight and no error ever
    // arriving.
    expect(
      membersSurfaceStateOf({
        isPending: true,
        isError: false,
        fetchStatus: 'paused',
        data: undefined,
      }),
    ).toEqual({ members: null, refusal: MEMBERS_UNAVAILABLE, loading: false });
  });

  it('keeps a cached list on screen when a refetch throws over it', () => {
    // THE DECISION THIS STORY MAKES, pinned because the previous version made
    // the other one silently: a refetch that fails while a complete list is
    // already cached replaced several hundred correct — if slightly old — people
    // with a sentence. Stale data plainly labelled as troubled beats no data,
    // and the alternative asks somebody to reload to see what they were already
    // looking at.
    const state = membersSurfaceStateOf({ ...settled, isError: true });

    expect(state.members, 'a network blip discards a good list').toEqual(rows);
    expect(state.refusal, 'a failing refetch says nothing at all').toBe(MEMBERS_UNAVAILABLE);
    expect(state.loading).toBe(false);
  });

  it('never pulses a skeleton beside an explanation', () => {
    // Both at once says the surface is working and broken at the same time.
    for (const isError of [true, false]) {
      for (const isPending of [true, false]) {
        for (const fetchStatus of ['idle', 'fetching', 'paused']) {
          for (const data of [undefined, settled.data, { ok: false, code: MEMBERS_REFUSED } as const]) {
            const state = membersSurfaceStateOf({ isPending, isError, fetchStatus, data });

            expect(state.loading && state.refusal !== null).toBe(false);
          }
        }
      }
    }
  });
});

describe('the narrowing declares its own inputs, so a memo cannot drop one', () => {
  /**
   * `eslint.config.js` registers no `react-hooks` plugin, so nothing lints a
   * dependency array in `routes/ljudi.tsx`, and the screen is executed by
   * nothing: dropping `sort` from a hand-written array left the suite green and
   * eslint clean while the arrow flipped and the rows never moved. The screen
   * derives the array from the same object it passes to `narrowFrom`, and this
   * is what pins what that object contains.
   */

  const inputs: NarrowingInputs = {
    members: [member({ id: 'a' })],
    search: 'ana',
    level: ALL_LEVELS,
    sort: DEFAULT_SORT,
  };

  it('carries every input, and exactly the inputs the object declares', () => {
    // COMPARED AGAINST THE OBJECT'S OWN KEYS, so a fifth input added to the
    // narrowing and forgotten in the dependency list fails here rather than
    // producing a table that quietly stops responding to it.
    expect(narrowingDependencies(inputs)).toEqual(Object.values(inputs));
    expect(narrowingDependencies(inputs)).toHaveLength(Object.keys(inputs).length);
  });

  it.each(['members', 'search', 'level', 'sort'])('changes when %s changes', (field) => {
    const changed: NarrowingInputs = {
      ...inputs,
      ...(field === 'members' ? { members: [member({ id: 'b' })] } : {}),
      ...(field === 'search' ? { search: 'boris' } : {}),
      ...(field === 'level' ? { level: 'admin' as const } : {}),
      ...(field === 'sort' ? { sort: { key: LEAVE_COLUMN, direction: DESCENDING } } : {}),
    };

    expect(narrowingDependencies(changed)).not.toEqual(narrowingDependencies(inputs));
  });

  it('narrows from the same object the dependencies come from', () => {
    expect(narrowFrom(inputs)).toEqual(
      narrowMembers(inputs.members ?? [], inputs.search, inputs.level, inputs.sort),
    );
  });

  it('treats an absent list as an empty one rather than throwing', () => {
    expect(narrowFrom({ ...inputs, members: null }).rows).toEqual([]);
  });
});

describe('the order is total, so reversing it is a mirror', () => {
  /**
   * `sort()` leaves equal values in whatever order they arrived and `reverse()`
   * then INVERTS that arbitrary order, so two members with the same value swap
   * places when the direction changes for no reason a person can see. It is
   * acute on the permission level, where four hundred rows carry two distinct
   * values: pressing that heading twice reshuffled the whole list rather than
   * turning it over.
   */

  it.each(MEMBER_COLUMNS.map((column) => column.key))(
    'reverses exactly, block for block, when sorting by %s',
    (key) => {
      const members = atScale();
      const up = narrowMembers(members, '', ALL_LEVELS, { key, direction: ASCENDING }).rows;
      const down = narrowMembers(members, '', ALL_LEVELS, { key, direction: DESCENDING }).rows;
      const column = MEMBER_COLUMNS.find((candidate) => candidate.key === key);
      // The members this column has no value for stay LAST in both directions —
      // they have no place in the order at all — so the mirror is asserted block
      // by block rather than over the whole list.
      const present = (rows: readonly MemberListRow[]): string[] =>
        rows.filter((row) => column?.sortValue(row) !== null).map((row) => row.id);
      const absent = (rows: readonly MemberListRow[]): string[] =>
        rows.filter((row) => column?.sortValue(row) === null).map((row) => row.id);

      expect(present(down), `sorting by ${key} descending is not the mirror of ascending`).toEqual(
        [...present(up)].reverse(),
      );
      expect(absent(down)).toEqual([...absent(up)].reverse());
      // And the address-less block is still at the end, in both directions.
      expect(down.slice(down.length - absent(down).length).map((row) => row.id)).toEqual(
        absent(down),
      );
    },
  );

  it('breaks a tie by name and then by id rather than by arrival', () => {
    // Two members with the same allowance and the same name: only the id can
    // order them, and without it `reverse()` would swap them between directions.
    const members = [
      member({ id: 'b', name: 'Ana', leaveAllowanceDays: 20 }),
      member({ id: 'a', name: 'Ana', leaveAllowanceDays: 20 }),
      member({ id: 'c', name: 'Ana', leaveAllowanceDays: 20 }),
    ];
    const up = narrowMembers(members, '', ALL_LEVELS, {
      key: LEAVE_COLUMN,
      direction: ASCENDING,
    }).rows;

    expect(up.map((row) => row.id)).toEqual(['a', 'b', 'c']);
  });

  it('orders the address-less block rather than leaving it as it arrived', () => {
    const members = [
      member({ id: 'z', name: 'Zoran', email: null }),
      member({ id: 'a', name: 'Ana', email: null }),
    ];

    expect(
      narrowMembers(members, '', ALL_LEVELS, { key: EMAIL_COLUMN, direction: ASCENDING }).rows.map(
        (row) => row.id,
      ),
    ).toEqual(['a', 'z']);
  });
});

describe('a search that folds away matches nothing, not everything', () => {
  it('lists nobody for a query made only of characters the fold strips', () => {
    // THE FAIL-OPEN: the fold removes combining marks, so a query that is
    // nothing but one folds to the empty string — and `''.includes` is true of
    // every member. The surface would then report the whole organization as the
    // result of a search that matched nobody, with a confident count beside it.
    const members = atScale();

    for (const typed of ['́', '́̂', '̀ ́']) {
      expect(foldForSearch(typed).trim(), `${typed} does not fold away`).toBe(NO_TEXT);
      expect(
        narrowMembers(members, typed, ALL_LEVELS, DEFAULT_SORT).rows,
        'a search that folds to nothing listed the whole organization',
      ).toEqual([]);
    }
  });

  it('still lists everybody for an empty box, which is not a search at all', () => {
    expect(narrowMembers(atScale(), '', ALL_LEVELS, DEFAULT_SORT).rows).toHaveLength(SCALE);
    expect(narrowMembers(atScale(), '   ', ALL_LEVELS, DEFAULT_SORT).rows).toHaveLength(SCALE);
  });

  it('counts a folded-away search as zero rather than as the whole organization', () => {
    const narrowed = narrowMembers(atScale(), '́', ALL_LEVELS, DEFAULT_SORT);

    expect(narrowed.counts[ALL_LEVELS]).toBe(0);
  });
});

describe('a malformed row names its column and its id, never its person', () => {
  it.each([
    { field: 'id', row: { id: null } },
    { field: 'organization_id', row: { organization_id: null } },
    { field: 'name', row: { name: 42 } },
    { field: 'role', row: { role: 'supervisor' } },
    { field: 'leave_allowance_days', row: { leave_allowance_days: '20' } },
  ])('reports $field as the column that failed', ({ field, row: broken }) => {
    const outcome = memberRowOutcomeOf(row(broken));

    expect(outcome.ok).toBe(false);
    expect(outcome.ok ? null : outcome.malformed.field).toBe(field);
  });

  it('reports something that is not a row as such, with no id to give', () => {
    expect(memberRowOutcomeOf('a row')).toEqual({
      ok: false,
      malformed: { field: NOT_A_ROW, id: null },
    });
  });

  it('logs the column and the id, and neither the name nor the address', async () => {
    // THE ONE LOG ON THIS SURFACE THAT COULD EMIT PERSONAL DATA, on a screen
    // whose entire justification is that these addresses are sensitive enough to
    // guard with a route. A column name and a row id are what somebody debugging
    // needs; neither identifies anybody to whoever reads the console.
    const personal = row({ id: 'm1', name: 'Ivan Marić', email: 'ivan@dvd.hr', role: 'supervisor' });

    await readMembers(answering({ data: [personal], count: 1 }));

    expect(logged).toHaveBeenCalledWith(MEMBERS_UNAVAILABLE, 'role', 'm1');
    for (const call of logged.mock.calls) {
      const said = JSON.stringify(call);

      expect(said, 'a member name reached the console').not.toContain('Ivan');
      expect(said, 'a member address reached the console').not.toContain('ivan@dvd.hr');
    }
  });
});

describe('an answer that is not an answer is a code, never a throw', () => {
  it.each([
    { name: 'a string', answered: 'not an answer' },
    { name: 'null', answered: null },
    { name: 'an array', answered: [] },
    { name: 'a number', answered: 7 },
  ])('maps $name to the try-again code rather than letting a TypeError escape', async ({ answered }) => {
    // `table.select` is a seam and a seam can resolve to anything — a proxy
    // returning a string, a stub written wrong, a transport that answered 200
    // with a body that is not JSON. Reading `.error` off it would THROW out of a
    // function whose whole contract is that it returns a code.
    const table = { select: () => Promise.resolve(answered) } as unknown as MembersTable;

    await expect(readMembers(table)).resolves.toEqual({ ok: false, code: MEMBERS_UNAVAILABLE });
  });
});

describe('the read is bounded, because it is the most expensive one here', () => {
  it('declares a cache floor rather than re-reading on every window focus', () => {
    // Several hundred rows AND an exact count, which costs the database a second
    // pass over the same index. `prijava.test.ts` pins that the screen actually
    // passes it.
    expect(MEMBERS_READ_STALE_MS).toBeGreaterThan(0);
  });
});
