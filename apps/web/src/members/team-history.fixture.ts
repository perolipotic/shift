/**
 * ONE MEMBERSHIP HISTORY, READ BY BOTH SIDES (story 1.7b, AC 2).
 *
 * `0010`'s `member_team_on` and `members/list.ts`'s `memberTeamOn` are two
 * implementations of one reading. `test/rls-isolation.test.ts` writes this
 * history into the database and asserts `member_team_on` against
 * {@link TEAM_HISTORY_ANSWERS}; `members/list.test.ts` builds the same history
 * as embedded versions and asserts `memberTeamOn` against the same answers. Two
 * suites against one written-out table is what makes them agree on every date,
 * rather than each agreeing with a history of its own.
 *
 * A LEAF WITH NO IMPORTS, for the reason `members/wire.ts` gives: the root
 * project cannot resolve anything that reaches `@supabase/supabase-js`.
 *
 * Days are offsets from the organization's today. Team labels are letters, not
 * names: nothing may branch on a team's name.
 */

export type TeamHistoryLabel = 'A' | 'B';

export interface TeamHistoryVersion {
  readonly offset: number;
  /** `null` is a version saying "no team from this date". */
  readonly team: TeamHistoryLabel | null;
}

/** Oldest first; at most one after today, as `0010` admits. */
export const TEAM_HISTORY: readonly TeamHistoryVersion[] = [
  { offset: -12, team: 'A' },
  { offset: -4, team: 'B' },
  { offset: -1, team: null },
  { offset: 3, team: 'A' },
];

/** The first and last offsets asked about, both inclusive. */
export const TEAM_HISTORY_SPAN = { from: -15, to: 8 } as const;

/**
 * The team as at each offset, WRITTEN OUT rather than derived, so neither
 * implementation is checked against a copy of itself.
 */
export const TEAM_HISTORY_ANSWERS: ReadonlyMap<number, TeamHistoryLabel | null> = new Map([
  [-15, null],
  [-14, null],
  [-13, null],
  [-12, 'A'],
  [-11, 'A'],
  [-10, 'A'],
  [-9, 'A'],
  [-8, 'A'],
  [-7, 'A'],
  [-6, 'A'],
  [-5, 'A'],
  [-4, 'B'],
  [-3, 'B'],
  [-2, 'B'],
  [-1, null],
  [0, null],
  [1, null],
  [2, null],
  [3, 'A'],
  [4, 'A'],
  [5, 'A'],
  [6, 'A'],
  [7, 'A'],
  [8, 'A'],
]);
