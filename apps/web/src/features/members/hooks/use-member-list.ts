import { useQuery } from '@tanstack/react-query';
import { useMemo, useRef, useState, type ChangeEvent } from 'react';

import {
  ALL_LEVELS,
  ALL_TEAMS,
  DEFAULT_SORT,
  MEMBERS_TABLE,
  NO_TEXT,
  chooseLevel,
  chooseTeam,
  membersQueryOptions,
  membersNoticeOf,
  membersSurfaceStateOf,
  membersTodayOf,
  membersViewOf,
  narrowingDependencies,
  nextSortState,
  teamToStore,
  type LevelFilter,
  type MemberColumnKey,
  type NarrowingInputs,
  type TeamFilter,
} from '@/features/members/services/list';
import { supabaseClient } from '@/lib/supabase/client';

/**
 * The member list's state, its one read and its handlers (story 1.5a).
 *
 * ONE SNAPSHOT, ONE QUERY KEY (AD-13). Every figure the screen draws — the rows,
 * the stated count, the counts beside both filters, and the team options
 * themselves — comes from the single `useQuery` under `MEMBERS_LIST_KEY` and is
 * derived by `narrowMembers`. There is no second read on this screen and there
 * must not be one: the team options are the teams somebody is on today, never a
 * read of `teams`.
 *
 * THIS HOOK AND THE SCREEN'S COMPONENTS HOLD STATE AND MARKUP, NOTHING ELSE.
 * Every rule — the fold, the collation, the sort toggle, the level and team
 * fallbacks, the faceted counts, whether the reset has anything to reset, the
 * labels — is a pure function in `@/features/members/services/list`, because a
 * `.tsx` is collected by nothing (AD-15) and the 1.5a review shipped two
 * swapped sort keys green when the pairing lived in the screen.
 */
export function useMemberList() {
  const [search, setSearch] = useState(NO_TEXT);
  const [level, setLevel] = useState<LevelFilter>(ALL_LEVELS);
  const [team, setTeam] = useState<TeamFilter>(ALL_TEAMS);
  const searchField = useRef<HTMLInputElement>(null);
  const [sort, setSort] = useState(DEFAULT_SORT);

  const answer = useQuery(membersQueryOptions(() => supabaseClient().from(MEMBERS_TABLE)));

  // EVERY STATE THIS SCREEN CAN BE IN, decided in `@/features/members/services/list` and pinned by
  // execution over real query results. Written in the screen it was four lines
  // of conditional that vitest never ran: replacing `answer.isError || paused`
  // with `paused` shipped green, and a thrown query function then rendered
  // headings with no rows, no count and no message.
  const state = membersSurfaceStateOf(answer);
  const { members, loading } = state;
  // THE LIST'S NOTICE: the refusal, or the unavailable message beside rows a
  // refetch paused offline over, which is never a refusal (an edit form keeps them).
  const refusal = membersNoticeOf(state);
  // THE ORGANIZATION'S TODAY, for the inactive marker (story 1.6), from the zone
  // the same one read embeds — `null` until it has settled, which marks nobody.
  const today = membersTodayOf(members, new Date());

  // ONE OBJECT, and the memo's dependencies are DERIVED from it rather than
  // written beside it. `eslint.config.js` registers no `react-hooks` plugin, so
  // nothing lints a dependency array here; dropping `sort` from a hand-written
  // one left the suite green and eslint clean while the arrow flipped and the
  // rows never moved. There is only one list of inputs now, and
  // `features/members/services/list.test.ts` pins what it contains.
  const inputs: NarrowingInputs = { members, search, level, team, sort, today };
  // THE SUMMARY ROW COMES OUT OF THE SAME CALL, from the snapshot and never
  // from the narrowed rows: `membersViewOf` is executed by `features/members/services/list.test.ts`
  // with a search that matches nobody, and the four figures still count everyone.
  const { summary, narrowed } = useMemo(
    () => membersViewOf(inputs),
    narrowingDependencies(inputs),
  );

  // THE CONTROLS ARE DEAD WHILE THERE IS NOTHING TO NARROW. A live filter over
  // an absent list renders `Sve razine: 0 osoba` beside a failure message, and
  // `0 / 0 / 0` under a pulsing skeleton — a confidently wrong figure in the two
  // states where the surface knows it has no answer. Disabled, they say what is
  // true: there is nothing here to search yet.
  const unanswered = members === null;

  // A TEAM THAT LEFT THE OPTIONS LEAVES THE STATE TOO, adjusted during render
  // (React's documented pattern for state derived from props). It cannot loop:
  // once stored, the value IS the applied one and `teamToStore` returns it.
  const settledTeam = teamToStore(team, narrowed.team, members, today);
  if (settledTeam !== team) setTeam(settledTeam);

  function changeSearch(event: ChangeEvent<HTMLInputElement>): void {
    setSearch(event.target.value);
  }

  function changeLevel(event: ChangeEvent<HTMLSelectElement>): void {
    setLevel(chooseLevel(event.target.value));
  }

  // THE CHOICE IS LOOKED UP AMONG THE OPTIONS ON SCREEN, which are data: a
  // value that is not one of them falls back to every team rather than
  // narrowing to a list nobody explained.
  function changeTeam(event: ChangeEvent<HTMLSelectElement>): void {
    setTeam(chooseTeam(event.target.value, narrowed.teams));
  }

  // ONE ACTION FOR ALL THREE (UX-DR17): the search, the level and the team
  // return to their defaults together. The sort is not a filter and stays.
  function resetFilters(): void {
    setSearch(NO_TEXT);
    setLevel(ALL_LEVELS);
    setTeam(ALL_TEAMS);
    // THE PRESSED BUTTON IS ABOUT TO BE DISABLED, which would drop keyboard
    // focus to the page body. The search is where narrowing starts again.
    searchField.current?.focus();
  }

  function pressColumn(column: MemberColumnKey): void {
    setSort((current) => nextSortState(current, column));
  }

  return {
    search,
    level,
    sort,
    searchField,
    refusal,
    loading,
    today,
    summary,
    narrowed,
    unanswered,
    changeSearch,
    changeLevel,
    changeTeam,
    resetFilters,
    pressColumn,
  };
}

/** Everything the member list's components read, as the hook returns it. */
export type MemberList = ReturnType<typeof useMemberList>;
