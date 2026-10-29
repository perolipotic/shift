import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { QueryClient, QueryObserver, environmentManager, onlineManager, type QueryKey } from '@tanstack/react-query';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { CALENDAR_KEY } from '@/features/calendar/services/snapshot';
import {
  MY_CONFLICT_RESOLUTIONS_KEY,
  ORGANIZATION_CONFLICT_RESOLUTIONS_KEY,
} from '@/features/conflicts/services/resolutions';
import { HOUR_BANDS_LIST_KEY } from '@/features/hour-bands/services/list';
import {
  LEAVE_OVERVIEW_RECORDS_KEY,
  LEAVE_RECORDS_KEY,
  MY_LEAVE_RECORDS_KEY,
  ORGANIZATION_LEAVE_RECORDS_KEY,
} from '@/features/leave/services/leave-list';
import {
  LEAVE_REQUEST_KEY,
  LEAVE_REQUEST_ROOT_KEY,
  MY_LEAVE_REQUESTS_KEY,
  ORGANIZATION_LEAVE_REQUESTS_KEY,
} from '@/features/leave/services/leave-requests';
import { MEMBERS_LIST_KEY } from '@/features/members/services/list';
import { SESSION_SUBJECT_KEY } from '@/features/members/services/write';
import { MEMBER_NAME_KEY } from '@/features/navigation/services/profile';
import { MEMBER_ROLE_KEY } from '@/features/navigation/services/role';
import { ORGANIZATION_SNAPSHOT_KEY } from '@/features/organization/services/snapshot';
import { ACTING_ADMINS_KEY } from '@/features/conflicts/services/resolved-conflicts';
import { ROTATION_KEY } from '@/features/rotation/services/list';
import { SHIFT_TYPES_LIST_KEY } from '@/features/shift-types/services/list';
import {
  CONFLICT_REPLACE_TAKEN_DEPENDENTS,
  CONFLICT_REPLACE_WRITE_DEPENDENTS,
  CONFLICT_RESOLUTION_GONE_DEPENDENTS,
  CONFLICT_RESOLUTION_HELD_DEPENDENTS,
  CONFLICT_RESOLUTION_WRITE_DEPENDENTS,
  HOUR_BAND_WRITE_DEPENDENTS,
  LEAVE_REQUEST_APPROVAL_DEPENDENTS,
  LEAVE_REQUEST_REJECTION_DEPENDENTS,
  LEAVE_REQUEST_WRITE_DEPENDENTS,
  LEAVE_WRITE_DEPENDENTS,
  MEMBERSHIP_WRITE_DEPENDENTS,
  MEMBER_SAVE_DEPENDENTS,
  NO_DEPENDENTS,
  OVERRIDE_WRITE_DEPENDENTS,
  ROSTER_WRITE_DEPENDENTS,
  ROTATION_CANCEL_DEPENDENTS,
  ROTATION_SAVE_DEPENDENTS,
  TEAM_CHANGE_DEPENDENTS,
  TEAM_CREATE_DEPENDENTS,
  refreshAfterWrite,
  retryRead,
  type InvalidatingClient,
} from '@/features/teams/services/dependents';
import { TEAMS_LIST_KEY } from '@/features/teams/services/list';
import { OWN_TEAM_KEY, TEAM_ROSTERS_KEY, TEAM_ROSTER_KEY } from '@/features/teams/services/roster';

/**
 * The amended AD-13 convention, executed against a REAL cache: a write
 * invalidates its own key and every key whose read embeds or derives from the
 * rows it writes, and nothing else.
 *
 * Each case seeds EVERY query key the application exports, runs the one
 * re-read a write makes, and asserts which entries came out invalidated.
 * Seeded with `setQueryData` and observed by nobody, so no `queryFn` ever
 * runs: an invalidation only marks an entry, which is exactly what is asserted.
 */

/** Two teams' rosters, so the prefix is shown to reach every one. */
const ROSTER_A = TEAM_ROSTER_KEY('team-a');
const ROSTER_B = TEAM_ROSTER_KEY('team-b');
/** Two members' leave records, so a leave write is shown to re-read its own member's alone. */
const LEAVE_A = LEAVE_RECORDS_KEY('member-a');
const LEAVE_B = LEAVE_RECORDS_KEY('member-b');
/** Two requests read by their ids (story 9.4), so a request write is shown to re-read every one. */
const REQUEST_A = LEAVE_REQUEST_KEY('request-a');
const REQUEST_B = LEAVE_REQUEST_KEY('request-b');

/**
 * EVERY EXPORTED QUERY KEY, by its exported name. The sweep below reads the
 * source for every `export const X_KEY = [` and `export function X_KEY(`, so a
 * key added anywhere fails here until it is placed — and placing it is the
 * moment to decide which writes it depends on.
 */
const CLASSIFIED: Readonly<Record<string, readonly QueryKey[]>> = {
  TEAMS_LIST_KEY: [TEAMS_LIST_KEY],
  MEMBERS_LIST_KEY: [MEMBERS_LIST_KEY],
  OWN_TEAM_KEY: [OWN_TEAM_KEY],
  TEAM_ROSTERS_KEY: [TEAM_ROSTERS_KEY],
  TEAM_ROSTER_KEY: [ROSTER_A, ROSTER_B],
  ROTATION_KEY: [ROTATION_KEY],
  CALENDAR_KEY: [CALENDAR_KEY],
  MEMBER_NAME_KEY: [MEMBER_NAME_KEY],
  MEMBER_ROLE_KEY: [MEMBER_ROLE_KEY],
  SESSION_SUBJECT_KEY: [SESSION_SUBJECT_KEY],
  HOUR_BANDS_LIST_KEY: [HOUR_BANDS_LIST_KEY],
  SHIFT_TYPES_LIST_KEY: [SHIFT_TYPES_LIST_KEY],
  ORGANIZATION_SNAPSHOT_KEY: [ORGANIZATION_SNAPSHOT_KEY],
  LEAVE_RECORDS_KEY: [LEAVE_A, LEAVE_B],
  MY_LEAVE_RECORDS_KEY: [MY_LEAVE_RECORDS_KEY],
  ORGANIZATION_LEAVE_RECORDS_KEY: [ORGANIZATION_LEAVE_RECORDS_KEY],
  // Story 7.15: the admin's overview on *Godišnji*, beside the organization's records wherever they are named.
  LEAVE_OVERVIEW_RECORDS_KEY: [LEAVE_OVERVIEW_RECORDS_KEY],
  MY_CONFLICT_RESOLUTIONS_KEY: [MY_CONFLICT_RESOLUTIONS_KEY],
  ORGANIZATION_CONFLICT_RESOLUTIONS_KEY: [ORGANIZATION_CONFLICT_RESOLUTIONS_KEY],
  // Story 7.16: the Odlučeno tab's names; stale from the first read, so no write names it.
  ACTING_ADMINS_KEY: [ACTING_ADMINS_KEY],
  // Story 9.3: the viewer's own leave requests, which only a request write names.
  MY_LEAVE_REQUESTS_KEY: [MY_LEAVE_REQUESTS_KEY],
  // Story 9.4: one request by its id, on the admin's decision screen, under one prefix.
  LEAVE_REQUEST_ROOT_KEY: [LEAVE_REQUEST_ROOT_KEY],
  LEAVE_REQUEST_KEY: [REQUEST_A, REQUEST_B],
  // Story 9.5: every request of the organization, which Za odluku and Danas read.
  ORGANIZATION_LEAVE_REQUESTS_KEY: [ORGANIZATION_LEAVE_REQUESTS_KEY],
};

/**
 * Every entry seeded before each case. The bare roster prefix is left out: no
 * read is ever made under it, only under a team's own key; and so is the bare
 * request prefix (story 9.4), for the same reason.
 */
const EVERY_KEY: readonly QueryKey[] = Object.entries(CLASSIFIED)
  .filter(([name]) => name !== 'TEAM_ROSTERS_KEY' && name !== 'LEAVE_REQUEST_ROOT_KEY')
  .flatMap(([, keys]) => keys);

const SRC = fileURLToPath(new URL('../../../', import.meta.url));

/** An exported query key: an array literal, or a function building one. */
const KEY_EXPORT = /export (?:const ([A-Z][A-Z0-9_]*_KEY)\s*=\s*\[|function ([A-Z][A-Z0-9_]*_KEY)\()/g;

/** The exported names that are query keys: an array literal, or a function. */
function exportedQueryKeys(): string[] {
  const names = new Set<string>();
  const files = readdirSync(SRC, { recursive: true, encoding: 'utf8' }).filter(
    (name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !/\.d\.ts$/.test(name),
  );

  for (const file of files) {
    const text = readFileSync(join(SRC, file), 'utf8');

    for (const found of text.matchAll(KEY_EXPORT)) {
      names.add(found[1] ?? found[2] ?? '');
    }
  }

  return [...names].sort();
}

let client: QueryClient;

beforeEach(() => {
  client = new QueryClient();
  for (const key of EVERY_KEY) client.setQueryData(key, { seeded: true });
});

afterEach(() => {
  client.clear();
  onlineManager.setOnline(true);
});

function invalidated(): QueryKey[] {
  return EVERY_KEY.filter((key) => client.getQueryState(key)?.isInvalidated === true);
}

describe('every query key is classified', () => {
  it('names every exported query key, and nothing that is not one', () => {
    const found = exportedQueryKeys();

    // Non-vacuity: the reader reaches both shapes.
    expect(found, 'the sweep misses a const key').toContain('MEMBERS_LIST_KEY');
    expect(found, 'the sweep misses a function key').toContain('TEAM_ROSTER_KEY');
    expect(found, 'a new query key is not classified here').toEqual(Object.keys(CLASSIFIED).sort());
  });

  it('would notice an unclassified key, and not a string constant', () => {
    const reader = (text: string): string[] =>
      [...text.matchAll(KEY_EXPORT)].map((found) => found[1] ?? found[2] ?? '');

    expect(reader("export const NEW_KEY = ['new'] as const;")).toEqual(['NEW_KEY']);
    expect(reader('export function NEW_KEY(id: string) {')).toEqual(['NEW_KEY']);
    expect(reader("export const PARTIAL_SAVE_KEY = 'ljudi.form.error.saved';")).toEqual([]);
  });
});

describe('the Danas line and the rosters are re-read only through the declared lists', () => {
  /** A cache call that names one of the two keys, in `text`. */
  const namesDependent = (text: string): boolean =>
    /\b(?:invalidateQueries|refetchQueries)\(\s*\{[^}]*\b(?:OWN_TEAM_KEY|TEAM_ROSTERS?_KEY)\b/.test(text);

  it('names neither key in any cache call outside the dependents module', () => {
    const files = readdirSync(SRC, { recursive: true, encoding: 'utf8' }).filter(
      (name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) && !/\.d\.ts$/.test(name),
    );
    const offenders = files.filter(
      (file) =>
        !file.endsWith(join('teams', 'services', 'dependents.ts')) &&
        namesDependent(readFileSync(join(SRC, file), 'utf8')),
    );

    expect(files.length, 'the sweep read nothing').toBeGreaterThan(100);
    expect(offenders, 'a write re-reads a dependent past the declared lists').toEqual([]);
  });

  it('would notice either key in either call, and not the read itself', () => {
    expect(namesDependent('queryClient.invalidateQueries({ queryKey: OWN_TEAM_KEY })')).toBe(true);
    expect(namesDependent('client.refetchQueries({\n  queryKey: TEAM_ROSTER_KEY(id),\n})')).toBe(true);
    expect(namesDependent('invalidateQueries({ queryKey: TEAM_ROSTERS_KEY })')).toBe(true);
    expect(namesDependent('useQuery({ queryKey: TEAM_ROSTER_KEY(id) })')).toBe(false);
  });
});

describe('the reads a team or membership write makes stale', () => {
  it.each([
    {
      write: 'a team create',
      own: TEAMS_LIST_KEY,
      dependents: TEAM_CREATE_DEPENDENTS,
      stale: [TEAMS_LIST_KEY, ROTATION_KEY],
    },
    {
      write: 'a team rename or archive',
      own: TEAMS_LIST_KEY,
      dependents: TEAM_CHANGE_DEPENDENTS,
      // The member list embeds `teams(name)`, Danas's line the same, every
      // roster answers the team's name and archived flag, and the calendar
      // draws every team.
      stale: [TEAMS_LIST_KEY, MEMBERS_LIST_KEY, OWN_TEAM_KEY, ROSTER_A, ROSTER_B, ROTATION_KEY, CALENDAR_KEY],
    },
    {
      write: 'a team move or a status change',
      own: MEMBERS_LIST_KEY,
      dependents: MEMBERSHIP_WRITE_DEPENDENTS,
      // Who is on which team today: Danas's line, every roster, the calendar;
      // and the leave and resolutions its erasure check stands on (5.5e).
      stale: [
        MEMBERS_LIST_KEY,
        OWN_TEAM_KEY,
        ROSTER_A,
        ROSTER_B,
        CALENDAR_KEY,
        ORGANIZATION_LEAVE_RECORDS_KEY,
        LEAVE_OVERVIEW_RECORDS_KEY,
        ORGANIZATION_CONFLICT_RESOLUTIONS_KEY,
        // 0041: a deactivation closes the member's pending leave requests.
        REQUEST_A,
        REQUEST_B,
        ORGANIZATION_LEAVE_REQUESTS_KEY,
      ],
    },
    {
      write: "a member's own row saved",
      own: MEMBERS_LIST_KEY,
      dependents: MEMBER_SAVE_DEPENDENTS,
      // The rosters show the name and the rank, the builder's history the name,
      // and the chrome's name and role are the admin's own when they edit
      // themselves.
      stale: [MEMBERS_LIST_KEY, ROSTER_A, ROSTER_B, ROTATION_KEY, MEMBER_NAME_KEY, MEMBER_ROLE_KEY],
    },
    {
      write: 'an hour band write (story 4.1b)',
      own: HOUR_BANDS_LIST_KEY,
      dependents: HOUR_BAND_WRITE_DEPENDENTS,
      // The calendar snapshot embeds every band, which *Sati* splits hours by.
      stale: [CALENDAR_KEY, HOUR_BANDS_LIST_KEY],
    },
    {
      write: 'a leave record saved (story 5.1c)',
      own: LEAVE_A,
      dependents: LEAVE_WRITE_DEPENDENTS,
      // The member's own records, since story 5.2c the viewer's own
      // (*Godišnji*), and since story 5.3b the organization's, which the
      // conflicts queue derives from; never another member's. Since story
      // 5.4a both resolution reads, which a removal or an amend can end.
      stale: [LEAVE_A, MY_LEAVE_RECORDS_KEY, ORGANIZATION_LEAVE_RECORDS_KEY, LEAVE_OVERVIEW_RECORDS_KEY, MY_CONFLICT_RESOLUTIONS_KEY, ORGANIZATION_CONFLICT_RESOLUTIONS_KEY],
    },
    {
      write: 'a leave request sent or withdrawn (story 9.3)',
      own: MY_LEAVE_REQUESTS_KEY,
      dependents: LEAVE_REQUEST_WRITE_DEPENDENTS,
      // The requests alone: a pending request derives nothing, so no leave,
      // balance or resolution read is re-read. Since story 9.4 every request
      // read by its id too, which the admin's decision screen holds, and
      // since story 9.5 the organization's, which Za odluku and Danas list.
      stale: [MY_LEAVE_REQUESTS_KEY, REQUEST_A, REQUEST_B, ORGANIZATION_LEAVE_REQUESTS_KEY],
    },
    {
      write: 'a leave request rejected (story 9.4)',
      own: REQUEST_A,
      dependents: LEAVE_REQUEST_REJECTION_DEPENDENTS,
      // Only the decision is recorded: the request keys alone.
      stale: [MY_LEAVE_REQUESTS_KEY, REQUEST_A, REQUEST_B, ORGANIZATION_LEAVE_REQUESTS_KEY],
    },
    {
      write: 'a leave request approved (story 9.4)',
      own: REQUEST_A,
      dependents: [...LEAVE_REQUEST_APPROVAL_DEPENDENTS, LEAVE_A],
      // The request keys, and what a leave record saved makes stale: the
      // member's own records (named by the screen), the viewer's own, the
      // organization's and the overview's, and both resolution reads.
      stale: [
        LEAVE_A,
        MY_LEAVE_RECORDS_KEY,
        ORGANIZATION_LEAVE_RECORDS_KEY,
        LEAVE_OVERVIEW_RECORDS_KEY,
        MY_CONFLICT_RESOLUTIONS_KEY,
        ORGANIZATION_CONFLICT_RESOLUTIONS_KEY,
        MY_LEAVE_REQUESTS_KEY,
        REQUEST_A,
        REQUEST_B,
        ORGANIZATION_LEAVE_REQUESTS_KEY,
      ],
    },
    {
      write: 'a conflict resolution recorded (story 5.4b)',
      own: ORGANIZATION_CONFLICT_RESOLUTIONS_KEY,
      dependents: CONFLICT_RESOLUTION_WRITE_DEPENDENTS,
      // Both resolution reads: the queue, the calendar's marks and an
      // admin's *Sati* derive from the organization's, a member's *Sati* from
      // their own. No leave, schedule or member row changes.
      stale: [MY_CONFLICT_RESOLUTIONS_KEY, ORGANIZATION_CONFLICT_RESOLUTIONS_KEY],
    },
    {
      write: 'a conflict resolved by a replacement (story 5.4c)',
      own: ORGANIZATION_CONFLICT_RESOLUTIONS_KEY,
      dependents: CONFLICT_REPLACE_WRITE_DEPENDENTS,
      // Both resolution reads, and the calendar snapshot: the override 0032
      // writes puts the replacement on the day's roster and in *Sati*.
      stale: [CALENDAR_KEY, MY_CONFLICT_RESOLUTIONS_KEY, ORGANIZATION_CONFLICT_RESOLUTIONS_KEY],
    },
    {
      write: 'a replacement refused as already on the shift (story 5.4c)',
      own: ORGANIZATION_CONFLICT_RESOLUTIONS_KEY,
      dependents: CONFLICT_REPLACE_TAKEN_DEPENDENTS,
      // The resolutions, and the snapshot the candidates are derived from.
      stale: [CALENDAR_KEY, ORGANIZATION_CONFLICT_RESOLUTIONS_KEY],
    },
    {
      write: 'a decision refused on a key a replacement that does not apply holds (story 5.5d)',
      own: ORGANIZATION_CONFLICT_RESOLUTIONS_KEY,
      dependents: CONFLICT_RESOLUTION_HELD_DEPENDENTS,
      // Both resolution reads, and the snapshot that decides whether the replacement applies.
      stale: [CALENDAR_KEY, MY_CONFLICT_RESOLUTIONS_KEY, ORGANIZATION_CONFLICT_RESOLUTIONS_KEY],
    },
    {
      write: 'a conflict resolution refused as no longer open (story 5.4b)',
      own: ORGANIZATION_CONFLICT_RESOLUTIONS_KEY,
      dependents: CONFLICT_RESOLUTION_GONE_DEPENDENTS,
      // The resolutions, and the leave a P0002 says is gone.
      stale: [ORGANIZATION_LEAVE_RECORDS_KEY, LEAVE_OVERVIEW_RECORDS_KEY, ORGANIZATION_CONFLICT_RESOLUTIONS_KEY],
    },
    {
      write: 'a rotation saved (story 5.5a)',
      own: ROTATION_KEY,
      dependents: ROTATION_SAVE_DEPENDENTS,
      // The builder's own read, the calendar snapshot that embeds every
      // version, and the leave and resolutions the erasure check and the
      // queue derive from with it.
      stale: [ROTATION_KEY, CALENDAR_KEY, ORGANIZATION_LEAVE_RECORDS_KEY, LEAVE_OVERVIEW_RECORDS_KEY, ORGANIZATION_CONFLICT_RESOLUTIONS_KEY],
    },
    {
      write: 'a scheduled rotation change cancelled (story 5.5g)',
      own: ROTATION_KEY,
      dependents: ROTATION_CANCEL_DEPENDENTS,
      // The builder's own read, the calendar snapshot that loses the
      // cancelled versions, and the leave and resolutions the erasure check
      // and the queue derive from with it.
      stale: [ROTATION_KEY, CALENDAR_KEY, ORGANIZATION_LEAVE_RECORDS_KEY, LEAVE_OVERVIEW_RECORDS_KEY, ORGANIZATION_CONFLICT_RESOLUTIONS_KEY],
    },
    {
      write: 'a calendar roster change saved or removed (story 5.5b)',
      own: CALENDAR_KEY,
      dependents: ROSTER_WRITE_DEPENDENTS,
      // The calendar snapshot the change is drawn in, and the leave and
      // resolutions the erasure check and the queue derive from with it;
      // since 0033 a removal can end a replacement, so both resolution reads.
      stale: [
        CALENDAR_KEY,
        ORGANIZATION_LEAVE_RECORDS_KEY,
        LEAVE_OVERVIEW_RECORDS_KEY,
        MY_CONFLICT_RESOLUTIONS_KEY,
        ORGANIZATION_CONFLICT_RESOLUTIONS_KEY,
      ],
    },
    {
      write: 'a calendar shift-type override set or removed (story 5.5f)',
      own: CALENDAR_KEY,
      dependents: OVERRIDE_WRITE_DEPENDENTS,
      // The calendar snapshot the override is drawn in, and the leave and
      // resolutions the erasure check and the queue derive from with it.
      stale: [CALENDAR_KEY, ORGANIZATION_LEAVE_RECORDS_KEY, LEAVE_OVERVIEW_RECORDS_KEY, ORGANIZATION_CONFLICT_RESOLUTIONS_KEY],
    },
    {
      write: 'a refusal',
      own: MEMBERS_LIST_KEY,
      dependents: NO_DEPENDENTS,
      stale: [MEMBERS_LIST_KEY],
    },
  ])('re-reads exactly what $write shows, and nothing else', async ({ own, dependents, stale }) => {
    expect(invalidated(), 'the cache started invalidated').toEqual([]);

    await refreshAfterWrite(client, own, dependents);

    expect(invalidated()).toEqual(stale);
  });

  it('re-reads a key named as its own and as a dependent once (story 9.3)', async () => {
    const named: QueryKey[] = [];
    const stub: InvalidatingClient = {
      invalidateQueries: ({ queryKey }) => {
        named.push(queryKey);

        return Promise.resolve();
      },
    };

    await refreshAfterWrite(stub, MY_LEAVE_REQUESTS_KEY, LEAVE_REQUEST_WRITE_DEPENDENTS);

    expect(named).toEqual([MY_LEAVE_REQUESTS_KEY, LEAVE_REQUEST_ROOT_KEY, ORGANIZATION_LEAVE_REQUESTS_KEY]);
  });

  it('reaches every roster through the one prefix', () => {
    expect(TEAM_ROSTER_KEY('x').slice(0, TEAM_ROSTERS_KEY.length)).toEqual([...TEAM_ROSTERS_KEY]);
    expect(TEAM_ROSTERS_KEY).toEqual(['team-roster']);
  });

  it('reaches every request read by its id through the one prefix (story 9.4)', () => {
    expect(LEAVE_REQUEST_KEY('x').slice(0, LEAVE_REQUEST_ROOT_KEY.length)).toEqual([...LEAVE_REQUEST_ROOT_KEY]);
    expect(LEAVE_REQUEST_ROOT_KEY).toEqual(['leave-request']);
  });
});

describe('a failed re-read never turns a landed write into a refusal', () => {
  /**
   * On a REAL client, with the dependent actually observed so its `queryFn`
   * runs. `invalidateQueries` refetches with `throwOnError` false, so the call
   * resolves over a rejecting re-read and over one paused offline; that is
   * what the write handlers stand on, rather than their `try`. Node counts as
   * a server, where TanStack never pauses, so the environment is told it is a
   * browser for these cases.
   */
  const wasServer = environmentManager.isServer();

  beforeAll(() => {
    environmentManager.setIsServer(() => false);
  });

  afterAll(() => {
    environmentManager.setIsServer(() => wasServer);
  });

  function watch(queryKey: QueryKey, queryFn: () => Promise<unknown>) {
    const observer = new QueryObserver(client, { queryKey, queryFn, retry: false });
    const unsubscribe = observer.subscribe(() => undefined);

    return { observer, unsubscribe };
  }

  it('resolves when a dependent re-read rejects, and leaves that read failed', async () => {
    let calls = 0;
    const { observer, unsubscribe } = watch(ROTATION_KEY, () => {
      calls += 1;

      return calls === 1 ? Promise.resolve({ fresh: true }) : Promise.reject(new Error('offline'));
    });

    try {
      // The mount's own read settles first, over the seeded entry.
      await vi.waitFor(() => {
        expect(observer.getCurrentResult().data).toEqual({ fresh: true });
        expect(observer.getCurrentResult().fetchStatus).toBe('idle');
      });
      await expect(refreshAfterWrite(client, TEAMS_LIST_KEY, TEAM_CREATE_DEPENDENTS)).resolves.toBeUndefined();
      expect(calls, 'the dependent was never re-read').toBe(2);
      expect(observer.getCurrentResult().isError).toBe(true);
    } finally {
      unsubscribe();
    }
  });

  it('resolves at once while offline, the re-read paused', async () => {
    const { observer, unsubscribe } = watch(OWN_TEAM_KEY, () => Promise.resolve({ fresh: true }));

    try {
      // The mount's own read settles first, over the seeded entry.
      await vi.waitFor(() => {
        expect(observer.getCurrentResult().data).toEqual({ fresh: true });
        expect(observer.getCurrentResult().fetchStatus).toBe('idle');
      });
      onlineManager.setOnline(false);
      await expect(
        refreshAfterWrite(client, MEMBERS_LIST_KEY, MEMBERSHIP_WRITE_DEPENDENTS),
      ).resolves.toBeUndefined();
      expect(client.getQueryState(OWN_TEAM_KEY)?.fetchStatus, 'the re-read did not pause').toBe('paused');
    } finally {
      unsubscribe();
    }
  });
});

describe('a read failure’s retry reads its own key again, and leaves a read in flight to land', () => {
  const wasServer = environmentManager.isServer();

  beforeAll(() => {
    environmentManager.setIsServer(() => false);
  });

  afterAll(() => {
    environmentManager.setIsServer(() => wasServer);
  });

  it('re-reads a failed key, and nothing that depends on it', async () => {
    let calls = 0;
    const observer = new QueryObserver(client, {
      queryKey: TEAMS_LIST_KEY,
      queryFn: () => {
        calls += 1;

        return calls === 1 ? Promise.reject(new Error('offline')) : Promise.resolve({ fresh: true });
      },
      retry: false,
    });
    const unsubscribe = observer.subscribe(() => undefined);

    try {
      await vi.waitFor(() => {
        expect(observer.getCurrentResult().isError).toBe(true);
      });
      await expect(retryRead(client, TEAMS_LIST_KEY)).resolves.toBeUndefined();
      expect(observer.getCurrentResult().data).toEqual({ fresh: true });
      // NO WRITE LANDED: a dependent of a team write is left as it was.
      expect(client.getQueryState(ROTATION_KEY)?.isInvalidated).toBe(false);
    } finally {
      unsubscribe();
    }
  });

  it('never restarts a read already in flight, however often it is pressed', async () => {
    const calls: number[] = [];
    let land: (value: unknown) => void = () => undefined;
    const observer = new QueryObserver(client, {
      queryKey: TEAMS_LIST_KEY,
      queryFn: ({ signal }) => {
        calls.push(calls.length);
        signal.addEventListener('abort', () => {
          calls.push(-1);
        });

        return new Promise((resolve) => {
          land = resolve;
        });
      },
      retry: false,
    });
    const unsubscribe = observer.subscribe(() => undefined);

    try {
      await vi.waitFor(() => {
        expect(observer.getCurrentResult().fetchStatus).toBe('fetching');
      });
      const first = retryRead(client, TEAMS_LIST_KEY);
      const second = retryRead(client, TEAMS_LIST_KEY);

      land({ fresh: true });
      await Promise.all([first, second]);
      expect(calls, 'a press cancelled or restarted the read in flight').toEqual([0]);
    } finally {
      unsubscribe();
    }
  });
});

describe('the one re-read a write makes', () => {
  it('starts every re-read together, the own key first, before any answers', async () => {
    const calls: QueryKey[] = [];
    const answers: (() => void)[] = [];
    const stub: InvalidatingClient = {
      invalidateQueries: ({ queryKey }) => {
        calls.push(queryKey);

        return new Promise<void>((resolve) => {
          answers.push(resolve);
        });
      },
    };
    const done = refreshAfterWrite(stub, TEAMS_LIST_KEY, TEAM_CHANGE_DEPENDENTS);

    // Nothing has answered yet, and every re-read has already started.
    expect(calls).toEqual([TEAMS_LIST_KEY, ...TEAM_CHANGE_DEPENDENTS]);
    answers.forEach((answer) => answer());
    await expect(done).resolves.toBeUndefined();
  });
});
