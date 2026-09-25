import { afterEach, describe, expect, it, vi } from 'vitest';

import { TEAMS_UNAVAILABLE, type TeamRow, type TeamsSurfaceState } from '@/teams/list';
import {
  ARCHIVE_ARMED,
  ARCHIVE_BUSY,
  ARCHIVE_IDLE,
  TEAM_ARCHIVED,
  TEAM_IN_USE,
  TEAM_NAME_EMPTY,
  TEAM_NAME_TAKEN,
  TEAM_RENAMED,
  TEAM_STALE,
  TEAM_UNKNOWN,
  TEAM_WRITE_INVALID,
  TEAM_WRITE_REFUSED,
  TEAM_WRITE_UNAVAILABLE,
  archiveFailureOf,
  archiveStageOf,
  archiveTeam,
  claimedOrganizationOf,
  createTeam,
  enteredTeamName,
  renameTeam,
  renamesAfter,
  teamFormKey,
  teamFormStateOf,
  teamSavedMessageKey,
  teamWriteFailureOf,
  teamWriteMessageKey,
  type TeamWriteAnswer,
  type TeamWriteFailure,
  type TeamWriteTable,
} from '@/teams/write';

/** Story 1.7a's write half, executed rather than read (AD-15). */

const ORGANIZATION = '00000000-0000-4000-8000-000000000001';
const ACTIVE: TeamRow = { id: 't1', organizationId: ORGANIZATION, name: 'Prvi', archived: false };
const ARCHIVED: TeamRow = { ...ACTIVE, id: 't2', archived: true };

/** A read's surface state: rows (or none), and whether the read is failing. */
function readOf(teams: readonly TeamRow[] | null, loading: boolean, failed = false): TeamsSurfaceState {
  return { teams, refusal: failed ? TEAMS_UNAVAILABLE : null, loading: failed ? false : loading };
}

interface Recorded {
  readonly verb: 'insert' | 'update';
  readonly values: Readonly<Record<string, unknown>>;
  readonly filter: readonly [string, string] | null;
  readonly columns: string;
}

function tableAnswering(answer: TeamWriteAnswer | Promise<never>): TeamWriteTable & {
  readonly calls: Recorded[];
} {
  const calls: Recorded[] = [];
  const resolve = (): PromiseLike<TeamWriteAnswer> =>
    answer instanceof Promise ? answer : Promise.resolve(answer);

  return {
    calls,
    insert(values) {
      return {
        select(columns) {
          calls.push({ verb: 'insert', values, filter: null, columns });

          return resolve();
        },
      };
    },
    update(values) {
      return {
        eq(column, value) {
          return {
            select(columns) {
              calls.push({ verb: 'update', values, filter: [column, value], columns });

              return resolve();
            },
          };
        },
      };
    },
  };
}

const ONE_ROW: TeamWriteAnswer = { data: [{ id: 'new' }], error: null };
const NO_ROW: TeamWriteAnswer = { data: [], error: null };

function refusedWith(code: string): TeamWriteAnswer {
  return { data: null, error: { code } };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a team name is trimmed and never blank', () => {
  it.each([
    ['Noćni tim', 'Noćni tim'],
    ['  razmak  ', 'razmak'],
    ['   ', null],
    ['', null],
    ['\t\n', null],
  ])('reads %j as %j', (entered, stored) => {
    expect(enteredTeamName(entered)).toBe(stored);
  });
});

describe('create', () => {
  it('inserts the tenant and the trimmed name, and nothing else', async () => {
    const table = tableAnswering(ONE_ROW);

    expect(await createTeam(table, ORGANIZATION, '  Novi tim ')).toEqual({ ok: true });
    expect(table.calls).toEqual([
      {
        verb: 'insert',
        values: { organization_id: ORGANIZATION, name: 'Novi tim' },
        filter: null,
        columns: 'id',
      },
    ]);
  });

  it('refuses a blank name before sending anything', async () => {
    const table = tableAnswering(ONE_ROW);

    expect(await createTeam(table, ORGANIZATION, '   ')).toEqual({ ok: false, code: TEAM_NAME_EMPTY });
    expect(table.calls).toEqual([]);
  });

  it('names a duplicate as the name being taken, not as a generic refusal', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(await createTeam(tableAnswering(refusedWith('23505')), ORGANIZATION, 'Prvi')).toEqual({
      ok: false,
      code: TEAM_NAME_TAKEN,
    });
  });

  it('reports a transport failure as unavailable', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(
      await createTeam(tableAnswering(Promise.reject(new Error('offline'))), ORGANIZATION, 'Prvi'),
    ).toEqual({ ok: false, code: TEAM_WRITE_UNAVAILABLE });
  });
});

describe('rename and archive', () => {
  it('renames in place by id, trimmed', async () => {
    const table = tableAnswering(ONE_ROW);

    expect(await renameTeam(table, ACTIVE, ' Drugi ')).toEqual({ ok: true });
    expect(table.calls).toEqual([
      { verb: 'update', values: { name: 'Drugi' }, filter: ['id', 't1'], columns: 'id' },
    ]);
  });

  it('archives by writing the flag true, and never false', async () => {
    const table = tableAnswering(ONE_ROW);

    expect(await archiveTeam(table, ACTIVE)).toEqual({ ok: true });
    expect(table.calls).toEqual([
      { verb: 'update', values: { archived: true }, filter: ['id', 't1'], columns: 'id' },
    ]);
  });

  it('reads zero rows as the screen no longer matching', async () => {
    expect(await renameTeam(tableAnswering(NO_ROW), ACTIVE, 'Drugi')).toEqual({
      ok: false,
      code: TEAM_STALE,
    });
    expect(await archiveTeam(tableAnswering(NO_ROW), ACTIVE)).toEqual({
      ok: false,
      code: TEAM_STALE,
    });
  });

  it('sends nothing for a team already archived', async () => {
    const table = tableAnswering(ONE_ROW);

    expect(await renameTeam(table, ARCHIVED, 'Drugi')).toEqual({ ok: false, code: TEAM_STALE });
    expect(await archiveTeam(table, ARCHIVED)).toEqual({ ok: false, code: TEAM_STALE });
    expect(table.calls).toEqual([]);
  });

  it('refuses a blank rename before sending anything', async () => {
    const table = tableAnswering(ONE_ROW);

    expect(await renameTeam(table, ACTIVE, '  ')).toEqual({ ok: false, code: TEAM_NAME_EMPTY });
    expect(table.calls).toEqual([]);
  });
});

describe('a database refusal names its problem', () => {
  it.each<[string | undefined, TeamWriteFailure]>([
    ['23505', TEAM_NAME_TAKEN],
    ['23514', TEAM_NAME_EMPTY],
    ['42501', TEAM_WRITE_REFUSED],
    ['23502', TEAM_WRITE_INVALID],
    ['22001', TEAM_WRITE_INVALID],
    ['40001', TEAM_WRITE_UNAVAILABLE],
    ['PGRST204', TEAM_WRITE_UNAVAILABLE],
    [undefined, TEAM_WRITE_UNAVAILABLE],
  ])('maps %s to %s', (code, failure) => {
    expect(teamWriteFailureOf({ code })).toBe(failure);
  });

  it('gives every failure its own message', () => {
    const failures: TeamWriteFailure[] = [
      TEAM_NAME_EMPTY,
      TEAM_NAME_TAKEN,
      TEAM_STALE,
      TEAM_WRITE_REFUSED,
      TEAM_WRITE_INVALID,
      TEAM_WRITE_UNAVAILABLE,
      TEAM_UNKNOWN,
      TEAM_IN_USE,
    ];
    const keys = failures.map((failure) => teamWriteMessageKey(failure));

    expect(new Set(keys).size).toBe(failures.length);
    expect(teamWriteMessageKey(TEAM_NAME_TAKEN)).toBe('smjene.error.taken');
    expect(teamWriteMessageKey(TEAM_NAME_EMPTY)).toBe('smjene.error.empty');
    expect(teamWriteMessageKey(TEAM_STALE)).toBe('smjene.error.stale');
    expect(teamWriteMessageKey(TEAM_IN_USE)).toBe('smjene.error.inUse');
  });
});

describe('an archive of a team somebody is on is refused by name (story 1.7b)', () => {
  it('reads a 42501 answering an ARCHIVE as the in-use rule, and nothing else as it', () => {
    // `0010`'s WITH CHECK raises `42501` for an archive while a membership
    // version for the team is in effect today or dated after today. The
    // archive is offered only to an admin on screen, so that is the rule.
    expect(archiveFailureOf({ code: '42501' })).toBe(TEAM_IN_USE);
    expect(archiveFailureOf({ code: '23505' })).toBe(TEAM_NAME_TAKEN);
    expect(archiveFailureOf({ code: '40001' })).toBe(TEAM_WRITE_UNAVAILABLE);
    expect(archiveFailureOf({})).toBe(TEAM_WRITE_UNAVAILABLE);
  });

  it('settles a refused archive as in use, and a refused rename as a plain refusal', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    expect(await archiveTeam(tableAnswering(refusedWith('42501')), ACTIVE)).toEqual({
      ok: false,
      code: TEAM_IN_USE,
    });
    expect(await renameTeam(tableAnswering(refusedWith('42501')), ACTIVE, 'Drugi')).toEqual({
      ok: false,
      code: TEAM_WRITE_REFUSED,
    });
  });

  it('names the rule rather than the generic refusal', () => {
    expect(teamWriteMessageKey(TEAM_IN_USE)).not.toBe(teamWriteMessageKey(TEAM_WRITE_REFUSED));
    expect(teamWriteMessageKey(TEAM_IN_USE)).not.toBe(teamWriteMessageKey(TEAM_WRITE_UNAVAILABLE));
  });
});

describe('the organization comes from the session claim', () => {
  function token(payload: unknown): string {
    const encoded = btoa(JSON.stringify(payload))
      .replaceAll('+', '-')
      .replaceAll('/', '_')
      .replaceAll('=', '');

    return `header.${encoded}.signature`;
  }

  it('reads the claim', () => {
    expect(claimedOrganizationOf(token({ organization_id: ORGANIZATION }))).toBe(ORGANIZATION);
  });

  it.each([
    ['no token', null],
    ['undefined', undefined],
    ['no payload', 'header'],
    ['a payload that is not JSON', 'header.bm90LWpzb24.signature'],
    ['no claim', token({ sub: 'x' })],
    ['an empty claim', token({ organization_id: '' })],
    ['a numeric claim', token({ organization_id: 7 })],
    ['an array payload', token([1])],
  ])('answers null for %s', (_what, value) => {
    expect(claimedOrganizationOf(value)).toBeNull();
  });
});

describe('the archive control has three stages and busy wins', () => {
  it.each([
    [false, false, ARCHIVE_IDLE],
    [true, false, ARCHIVE_ARMED],
    [true, true, ARCHIVE_BUSY],
    [false, true, ARCHIVE_BUSY],
  ])('armed %s, pending %s is %s', (armed, pending, stage) => {
    expect(archiveStageOf(armed, pending)).toBe(stage);
  });
});

describe('the edit screen finds its team in the one list', () => {
  it('waits while the list has not answered', () => {
    expect(teamFormStateOf(readOf(null, true), 't1')).toEqual({ team: null, refusal: null });
  });

  it('finds an active and an archived team alike', () => {
    expect(teamFormStateOf(readOf([ACTIVE, ARCHIVED], false), 't2')).toEqual({
      team: ARCHIVED,
      refusal: null,
    });
  });

  it('hides the form and names nothing when the read failed, even over cached rows', () => {
    // A form remounted after a landed rename would draw the stale name beside
    // "saved"; the screen shows only the read message instead.
    expect(teamFormStateOf(readOf([ACTIVE, ARCHIVED], false, true), 't1')).toEqual({
      team: null,
      refusal: null,
    });
    expect(teamFormStateOf(readOf([ACTIVE], false, true), 'missing')).toEqual({
      team: null,
      refusal: null,
    });
    expect(teamFormStateOf(readOf(null, false, true), 't1')).toEqual({ team: null, refusal: null });
  });

  it('names a team the answer does not hold', () => {
    expect(teamFormStateOf(readOf([ACTIVE], false), 'missing')).toEqual({
      team: null,
      refusal: TEAM_UNKNOWN,
    });
  });

  it('keeps the form mounted when a re-read brings a name changed elsewhere', () => {
    // A refused rename keeps the entered value (UX-DR34): a refetch changing
    // the stored name must not remount the uncontrolled field.
    expect(teamFormKey({ ...ACTIVE, name: 'Drugi' }, 0)).toBe(teamFormKey(ACTIVE, 0));
  });

  it('remounts the form only after a rename that landed', () => {
    const refused = renamesAfter(0, { ok: false, code: TEAM_NAME_TAKEN });
    const landed = renamesAfter(0, { ok: true });

    expect(refused).toBe(0);
    expect(teamFormKey(ACTIVE, refused)).toBe(teamFormKey(ACTIVE, 0));
    expect(landed).toBe(1);
    expect(teamFormKey(ACTIVE, landed)).not.toBe(teamFormKey(ACTIVE, 0));
  });

  it('keys each team apart', () => {
    expect(teamFormKey(ACTIVE, 0)).not.toBe(teamFormKey({ ...ACTIVE, id: 'other' }, 0));
  });
});

describe('a landed write says what landed', () => {
  it('confirms a rename and an archive with different sentences', () => {
    expect(teamSavedMessageKey(TEAM_RENAMED)).toBe('smjene.saved');
    expect(teamSavedMessageKey(TEAM_ARCHIVED)).toBe('smjene.archivedDone');
  });
});
