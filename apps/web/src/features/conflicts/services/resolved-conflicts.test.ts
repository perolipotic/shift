import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { readCalendar, type CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { conflictsQueueOutcomeOf } from '@/features/conflicts/services/conflicts-queue';
import {
  ACTING_ADMINS_COLUMNS,
  ACTING_ADMINS_PAGE_ROWS,
  ACTING_ADMINS_UNAVAILABLE,
  RESOLVED_LOADING,
  RESOLVED_READY,
  RESOLVED_UNAVAILABLE,
  TAB_RESOLVED,
  TAB_UNRESOLVED,
  conflictsTabId,
  readActingAdminRows,
  resolvedConflictsOf,
  resolvedConflictsOutcomeOf,
  tabAfterKey,
  type ResolvedConflictsView,
} from '@/features/conflicts/services/resolved-conflicts';
import { initLocalization, t } from '@/lib/i18n';
import {
  PILOT,
  SEEDED,
  VIEWER_MEMBER,
  VIEWER_NAME,
  calendarMemberRow,
  calendarOrganizationRow,
  calendarRosterOverrideRow,
  calendarTableOf,
  memberMembershipRow,
  membersAnswerOf,
  membershipRow,
  overridesAnswerOf,
  rosterOverridesAnswerOf,
  viewerRow,
  viewerSession,
  type FixtureRows,
} from '@/features/rotation/rotation.fixture';

/**
 * Story 7.16's view model, executed (AD-15): the *Riješeni* tab lists what
 * `conflict_resolutions` holds — decision, acting admin, instant — and the
 * queue drops exactly the same conflicts, so each is in one tab only.
 */

const ANA = '00000000-0000-4000-8000-0000000000c1';
const ADMIN_AUTH = '00000000-0000-4000-8000-0000000000a1';
const GONE_AUTH = '00000000-0000-4000-8000-0000000000a2';

type Row = Record<string, unknown>;

function teamOf(rows: FixtureRows, index: number): string {
  const id = rows.teams[index]?.['id'];

  if (typeof id !== 'string') throw new Error(`no team ${String(index)}`);

  return id;
}

async function snapshotOf(rows: FixtureRows, rosterOverrides: readonly Row[] = []): Promise<CalendarSnapshot> {
  const [a, b] = [teamOf(rows, 0), teamOf(rows, 1)];
  const source = calendarTableOf(
    {
      data: [
        calendarOrganizationRow(rows, {
          viewers: [viewerRow([membershipRow(a, SEEDED)], { role: 'admin' })],
          versions: [memberMembershipRow(VIEWER_MEMBER, a, SEEDED), memberMembershipRow(ANA, b, SEEDED)],
        }),
      ],
      error: null,
      count: 1,
    },
    membersAnswerOf([calendarMemberRow(VIEWER_MEMBER, VIEWER_NAME), calendarMemberRow(ANA, 'Ana Anić')]),
    overridesAnswerOf([]),
    rosterOverridesAnswerOf(rosterOverrides),
  );
  const outcome = await readCalendar(source, source, viewerSession());

  if (!outcome.ok) throw new Error(outcome.code);

  return outcome.snapshot;
}

/** The pilot's worked example: 10.09–14.09 over Dan, Noć, Slobodno, Slobodno, Dan. */
const WORKED: Row = { id: 'record-worked', member_id: VIEWER_MEMBER, during: '[2026-09-10,2026-09-15)' };

/** A resolution row as the organization's read answers it, author columns included. */
function resolutionOf(
  date: string,
  teamId: string,
  createdAt: string,
  { kind = 'accept_uncovered', link = null as string | null, by = ADMIN_AUTH, memberId = VIEWER_MEMBER } = {},
): Row {
  return { member_id: memberId, date, team_id: teamId, kind, roster_override_id: link, created_by: by, created_at: createdAt };
}

const ACTORS: readonly Row[] = [
  { auth_user_id: ADMIN_AUTH, name: 'Damir Dekanić' },
  { auth_user_id: '00000000-0000-4000-8000-0000000000a9', name: 'Iva Ivić' },
];

function viewOf(
  snapshot: CalendarSnapshot,
  resolutionRows: readonly unknown[],
  actorRows: readonly unknown[] = ACTORS,
): ResolvedConflictsView {
  const outcome = resolvedConflictsOutcomeOf(snapshot, [WORKED], resolutionRows, actorRows);

  if (!outcome.ok) throw new Error(outcome.code);

  return outcome.view;
}

let pilot: CalendarSnapshot;
let a: string;

beforeAll(async () => {
  await initLocalization();
  pilot = await snapshotOf(PILOT);
  a = teamOf(PILOT, 0);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('what an entry shows', () => {
  it('names the date, team, shift type, member, decision, acting admin and the instant in the zone', () => {
    // 09:30 UTC is 11:30 in Zagreb (CEST).
    const [row] = viewOf(pilot, [resolutionOf('2026-09-11', a, '2026-09-02T09:30:00+00:00')]).rows;

    expect(row).toMatchObject({
      kind: 'accept_uncovered',
      dateShown: '11.09.2026',
      teamName: 'Smjena A',
      memberName: VIEWER_NAME,
      shiftTypeName: 'Noć',
      times: '19:00–07:00',
      replacementName: null,
      actorName: 'Damir Dekanić',
      decidedOn: '02.09.2026',
      decidedAt: '11:30',
    });
    expect(t('raspored.resolved.accept_uncovered')).toBe('Prihvaćeno kao nepokriveno');
  });

  it('names the replacement of a replace_member resolution', async () => {
    const snapshot = await snapshotOf(PILOT, [calendarRosterOverrideRow('ro-ana', a, '2026-09-11', null, ANA)]);
    const [row] = viewOf(snapshot, [resolutionOf('2026-09-11', a, '2026-09-02T09:30:00+00:00', { kind: 'replace_member', link: 'ro-ana' })]).rows;

    expect(row?.replacementName).toBe('Ana Anić');
    expect(t('raspored.resolved.replace_member', { replacement: 'Ana Anić' })).toBe('Zamjena: Ana Anić');
  });

  it('says so when the acting admin is no longer a member, never leaving it blank', () => {
    const [row] = viewOf(pilot, [resolutionOf('2026-09-11', a, '2026-09-02T09:30:00+00:00', { by: GONE_AUTH })]).rows;

    expect(row?.actorName).toBeNull();
    // The screen's words for a null actor (resolved-list.tsx).
    expect(t('raspored.resolved.actorGone')).toBe('administrator kojeg više nema u organizaciji');
  });

  it('keeps an entry whose team no longer works that day, without a shift type', () => {
    // 12.09 is Slobodno: no collision there, the resolution still stands.
    const [row] = viewOf(pilot, [resolutionOf('2026-09-12', a, '2026-09-02T09:30:00+00:00')]).rows;

    expect(row).toMatchObject({ dateShown: '12.09.2026', shiftTypeName: null, times: null });
    // The screen's words for a null shift type (resolved-list.tsx).
    expect(t('raspored.resolved.shiftGone')).toBe('Taj dan više nije radni po rasporedu');
  });

  it("names the team's shift type when the member is only taken off the roster that day", async () => {
    // 11.09 is Noć and team A works it; the override only takes the member off, so the collision goes but the shift stands.
    const snapshot = await snapshotOf(PILOT, [calendarRosterOverrideRow('ro-off', a, '2026-09-11', VIEWER_MEMBER, null)]);
    const [row] = viewOf(snapshot, [resolutionOf('2026-09-11', a, '2026-09-02T09:30:00+00:00')]).rows;

    expect(row).toMatchObject({ dateShown: '11.09.2026', shiftTypeName: 'Noć', times: '19:00–07:00' });
  });
});

describe('the list', () => {
  it('is empty and says so with no resolution', () => {
    expect(viewOf(pilot, []).rows).toEqual([]);
    expect(t('raspored.resolved.count', { count: 0 })).toBe('0 riješenih konflikata');
  });

  it('lists the most recently decided first', () => {
    const view = viewOf(pilot, [
      resolutionOf('2026-09-10', a, '2026-09-02T08:00:00+00:00'),
      resolutionOf('2026-09-14', a, '2026-09-03T08:00:00+00:00'),
      resolutionOf('2026-09-11', a, '2026-09-02T12:00:00+00:00'),
    ]);

    expect(view.rows.map((row) => row.dateShown)).toEqual(['14.09.2026', '11.09.2026', '10.09.2026']);
  });

  it('is exactly the queue complement: a conflict is in one tab only', () => {
    const rows = [resolutionOf('2026-09-11', a, '2026-09-02T09:30:00+00:00')];
    const queue = conflictsQueueOutcomeOf(pilot, [WORKED], rows, '2026-09-01');

    if (!queue.ok) throw new Error(queue.code);

    expect(queue.view.rows.map((row) => row.dateShown)).toEqual(['10.09.2026', '14.09.2026']);
    expect(viewOf(pilot, rows).rows.map((row) => row.dateShown)).toEqual(['11.09.2026']);
  });

  it('does not list a replacement that no longer applies: its conflict is back in the queue', async () => {
    const snapshot = await snapshotOf(PILOT, [
      calendarRosterOverrideRow('ro-ana', a, '2026-09-11', null, ANA, { createdAt: '2019-01-01T00:00:00+00:00' }),
    ]);
    const rows = [resolutionOf('2026-09-11', a, '2026-09-02T09:30:00+00:00', { kind: 'replace_member', link: 'ro-ana' })];
    const queue = conflictsQueueOutcomeOf(snapshot, [WORKED], rows, '2026-09-01');

    if (!queue.ok) throw new Error(queue.code);

    expect(viewOf(snapshot, rows).rows).toEqual([]);
    expect(queue.view.rows.map((row) => row.dateShown)).toContain('11.09.2026');
  });
});

describe('refusals', () => {
  it('refuses the whole tab, logged, on a resolution with no instant or no author', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const bare: Row = { member_id: VIEWER_MEMBER, date: '2026-09-11', team_id: a, kind: 'accept_uncovered', roster_override_id: null };

    expect(resolvedConflictsOutcomeOf(pilot, [WORKED], [bare], ACTORS)).toEqual({ ok: false, code: RESOLVED_UNAVAILABLE });
    expect(resolvedConflictsOutcomeOf(pilot, [WORKED], [{ ...bare, created_at: 'never', created_by: ADMIN_AUTH }], ACTORS).ok).toBe(false);
    expect(logged).toHaveBeenCalled();
  });

  it('refuses the tab on an unreadable resolution row', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(resolvedConflictsOutcomeOf(pilot, [WORKED], ['junk'], ACTORS).ok).toBe(false);
  });
});

describe('the reads', () => {
  const answer = (data: readonly unknown[] | undefined, extra: Partial<{ isPending: boolean; isError: boolean; fetchStatus: string }> = {}) => ({
    isPending: data === undefined,
    isError: false,
    fetchStatus: 'idle',
    data,
    ...extra,
  });
  const ready = { records: answer([WORKED]), resolutions: answer([]), actors: answer(ACTORS) };

  it('is loading until the names are read, and unavailable when any read failed', () => {
    const calendar = { snapshot: pilot, loading: false, refusal: null } as never;

    expect(resolvedConflictsOf({ ...ready, calendar, actors: answer(undefined) }).kind).toBe(RESOLVED_LOADING);
    expect(resolvedConflictsOf({ ...ready, calendar }).kind).toBe(RESOLVED_READY);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(resolvedConflictsOf({ ...ready, calendar, actors: answer(undefined, { isError: true, isPending: false }) }).kind).toBe(
      RESOLVED_UNAVAILABLE,
    );
  });

  it("reads the members' auth id and name and nothing else, and fails on an error", async () => {
    const range = vi.fn().mockResolvedValueOnce({ data: ACTORS, error: null }).mockResolvedValueOnce({ data: null, error: { code: 'x' } });
    const order = vi.fn(() => ({ order, range }));
    const select = vi.fn(() => ({ order, range }));

    expect(await readActingAdminRows({ select })).toEqual(ACTORS);
    expect(select).toHaveBeenCalledWith(ACTING_ADMINS_COLUMNS);
    expect(ACTING_ADMINS_COLUMNS).toBe('auth_user_id,name');
    await expect(readActingAdminRows({ select })).rejects.toThrow(ACTING_ADMINS_UNAVAILABLE);
  });

  it('reads every page of members, so an admin past the first thousand still resolves', async () => {
    const full = Array.from({ length: ACTING_ADMINS_PAGE_ROWS }, (_, index) => ({ auth_user_id: `u${index}`, name: `N${index}` }));
    const last = [{ auth_user_id: 'late-admin', name: 'Kasni' }];
    const range = vi.fn().mockResolvedValueOnce({ data: full, error: null }).mockResolvedValueOnce({ data: last, error: null });
    const order = vi.fn(() => ({ order, range }));
    const select = vi.fn(() => ({ order, range }));

    const rows = await readActingAdminRows({ select });

    expect(rows).toHaveLength(ACTING_ADMINS_PAGE_ROWS + 1);
    expect(rows[ACTING_ADMINS_PAGE_ROWS]).toEqual(last[0]);
    expect(range).toHaveBeenNthCalledWith(1, 0, ACTING_ADMINS_PAGE_ROWS - 1);
    expect(range).toHaveBeenNthCalledWith(2, ACTING_ADMINS_PAGE_ROWS, 2 * ACTING_ADMINS_PAGE_ROWS - 1);
  });
});

describe('the tabs', () => {
  it('moves as a tablist does: the arrows wrap, Home and End jump, other keys do nothing', () => {
    expect(tabAfterKey(TAB_UNRESOLVED, 'ArrowRight')).toBe(TAB_RESOLVED);
    expect(tabAfterKey(TAB_RESOLVED, 'ArrowRight')).toBe(TAB_UNRESOLVED);
    expect(tabAfterKey(TAB_UNRESOLVED, 'ArrowLeft')).toBe(TAB_RESOLVED);
    expect(tabAfterKey(TAB_RESOLVED, 'Home')).toBe(TAB_UNRESOLVED);
    expect(tabAfterKey(TAB_UNRESOLVED, 'End')).toBe(TAB_RESOLVED);
    expect(tabAfterKey(TAB_UNRESOLVED, 'Tab')).toBeNull();
    expect(conflictsTabId(TAB_RESOLVED)).not.toBe(conflictsTabId(TAB_UNRESOLVED));
  });

  it('words the tabs and the count at zero', () => {
    expect(t('raspored.tabs.unresolved')).toBe('Neriješeni');
    expect(t('raspored.tabs.resolved')).toBe('Riješeni');
    expect(t('raspored.tabs.unresolvedCount', { count: 0 })).toBe('Neriješeni · 0');
  });
});
