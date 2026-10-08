import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';

import {
  ALL_TEAMS,
  DEFAULT_FILTERS,
  MEMBERS_TABLE,
  NO_TEXT,
  chooseChip,
  membersAwaitTodayOf,
  memberChipChoiceOf,
  memberChipRemovalOf,
  membersFiltersOf,
  membersQueryOptions,
  membersNoticeOf,
  membersSearchFor,
  membersSearchKeyOf,
  membersSurfaceStateOf,
  membersTodayOf,
  membersViewOf,
  narrowingDependencies,
  nextSortState,
  teamToStore,
  type MemberColumnKey,
  type MembersFilters,
  type MembersSearch,
  type NarrowingInputs,
} from '@/features/members/services/list';
import { supabaseClient } from '@/lib/supabase/client';

/** How the hook writes the URL: the whole search, pushed, or replacing the entry. */
export type MembersNavigate = (search: MembersSearch, options: { readonly replace: boolean }) => void;

/**
 * The member list's state, its one read and its handlers (story 1.5a).
 *
 * ONE SNAPSHOT, ONE QUERY KEY (AD-13). Every figure the screen draws — the rows,
 * the summary line, the counts beside every option, and the team options
 * themselves — comes from the single `useQuery` under `MEMBERS_LIST_KEY` and is
 * derived by `narrowMembers`. There is no second read on this screen and there
 * must not be one: the team options are the teams somebody is on today, never a
 * read of `teams`.
 *
 * THE FILTERS LIVE IN THE URL (story 7.13): `?trazi=&razina=&smjena=&status=&sort=`,
 * parsed by the route's `validateSearch` and handed in as `search`, so a
 * filtered list can be linked, reloaded, and restored by Back. Every chip and
 * sort change pushes an entry; typing in the search REPLACES the entry, so
 * Back does not step through a word letter by letter. The box itself holds
 * what was typed, and follows the URL when it changes from elsewhere (Back,
 * `Poništi filtre`).
 *
 * THIS HOOK AND THE SCREEN'S COMPONENTS HOLD STATE AND MARKUP, NOTHING ELSE.
 * Every rule — the fold, the collation, the sort toggle, the URL's vocabulary
 * and its fallbacks, the faceted counts, whether the reset has anything to
 * reset, the labels — is a pure function in `@/features/members/services/list`.
 */
export function useMemberList(search: MembersSearch, navigate: MembersNavigate) {
  const filters = useMemo(() => membersFiltersOf(search), [search]);
  const [text, setText] = useState(filters.search);
  // THE SEARCH VALUES THIS HOOK WROTE and the URL has not reached yet, as the
  // URL parses them. The URL settling on one of them — an older keystroke
  // included — is this hook catching up, never a change from elsewhere, so the
  // box keeps what was typed since. Any other value is Back, a reload or a
  // link, and the box follows it.
  const pending = useRef<string[]>([]);
  const searchField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const ours = pending.current.indexOf(filters.search);

    if (ours === -1) {
      pending.current = [];
      setText(filters.search);

      return;
    }
    pending.current = pending.current.slice(ours + 1);
  }, [filters.search]);

  const answer = useQuery(membersQueryOptions(() => supabaseClient().from(MEMBERS_TABLE)));

  // EVERY STATE THIS SCREEN CAN BE IN, decided in `@/features/members/services/list`
  // and pinned by execution over real query results.
  const state = membersSurfaceStateOf(answer);
  const { members } = state;
  // THE LIST'S NOTICE: the refusal, or the unavailable message beside rows a
  // refetch paused offline over, which is never a refusal.
  const refusal = membersNoticeOf(state);
  // THE ORGANIZATION'S TODAY, for the status column (story 7.13), from the zone
  // the same one read embeds — `null` until it has settled, which states nobody's.
  const today = membersTodayOf(members, new Date());
  // SKELETON ROWS while the status filter waits for today: rows unfiltered by
  // status under `Status: aktivni` would be a false list (`svi` needs no today).
  const loading = state.loading || membersAwaitTodayOf(members, today, filters.status);

  // ONE OBJECT, and the memo's dependencies are DERIVED from it rather than
  // written beside it: `features/members/services/list.test.ts` pins what it contains.
  const inputs: NarrowingInputs = {
    members,
    search: text,
    level: filters.level,
    team: filters.team,
    status: filters.status,
    sort: filters.sort,
    today,
  };
  // THE SUMMARY LINE COMES OUT OF THE SAME CALL, counting the very rows drawn.
  const { summary, narrowed } = useMemo(
    () => membersViewOf(inputs),
    narrowingDependencies(inputs),
  );

  // THE CONTROLS ARE DEAD WHILE THERE IS NOTHING TO NARROW: a live filter over
  // an absent list states a confidently wrong figure.
  const unanswered = members === null;

  /** What the screen shows, the box's own text included. */
  const shown: MembersFilters = { ...filters, search: text };
  /** The state the URL holds, as one key: the filter bar waits for it to move focus. */
  const stateKey = membersSearchKeyOf(search);

  // A TEAM THAT LEFT THE OPTIONS LEAVES THE URL TOO, replacing the entry: a
  // stale id falls back to every team (`teamToStore`), once the answer is real.
  const settledTeam = teamToStore(filters.team, narrowed.team, members, today);

  /**
   * Write `next` to the URL, and return the state it leaves. A change that
   * leaves the URL as it is navigates nowhere, so it pushes no duplicate entry.
   */
  function write(next: MembersFilters, replace: boolean): string {
    const written = membersSearchFor(next);
    const key = membersSearchKeyOf(written);

    if (key === stateKey) return key;

    const parsed = membersFiltersOf(written).search;

    // Only a search the URL does not already hold is waited for.
    if (parsed !== filters.search) pending.current = [...pending.current, parsed];
    navigate(written, { replace });

    return key;
  }

  // EVERY VALUE THE REPLACE READS IS A DEPENDENCY — `filters` (memoized on the
  // search), `text`, `settledTeam` and `navigate` — so it never carries a
  // stale box (no `react-hooks` lint rule would say so).
  useEffect(() => {
    if (settledTeam === filters.team) return;
    write({ ...filters, search: text, team: ALL_TEAMS }, true);
  }, [settledTeam, filters, text, navigate]);

  /** Write `next` to the URL as a new entry, and return the state it leaves. */
  function go(next: MembersFilters): string {
    return write(next, false);
  }

  function changeSearch(event: ChangeEvent<HTMLInputElement>): void {
    const value = event.target.value;

    setText(value);
    write({ ...shown, search: value }, true);
  }

  /** A chip's pick: the URL changes, and the state it leaves is returned. */
  function pickChip(key: string, id: string): string {
    const chip = chooseChip(key);

    return chip === null ? stateKey : go(memberChipChoiceOf(shown, chip, id, narrowed.teams));
  }

  /** A chip's ✕. */
  function removeChip(key: string): string {
    const chip = chooseChip(key);

    return chip === null ? stateKey : go(memberChipRemovalOf(shown, chip));
  }

  // THE URL BACK TO ITS DEFAULTS — no search, every level, every team,
  // `aktivni`, by name ascending — in one entry. The phone sheet's `Poništi`:
  // focus stays in the sheet.
  function clearFilters(): void {
    setText(NO_TEXT);
    go(DEFAULT_FILTERS);
  }

  // `Poništi filtre` under the chips: the same, and focus to the search.
  function resetFilters(): void {
    clearFilters();
    // THE PRESSED BUTTON IS ABOUT TO GO, which would drop keyboard focus to
    // the page body. The search is where narrowing starts again.
    searchField.current?.focus();
  }

  function pressColumn(column: MemberColumnKey): void {
    go({ ...shown, sort: nextSortState(shown.sort, column) });
  }

  return {
    search: text,
    filters: shown,
    sort: shown.sort,
    stateKey,
    searchField,
    refusal,
    loading,
    today,
    summary,
    narrowed,
    unanswered,
    changeSearch,
    pickChip,
    removeChip,
    clearFilters,
    resetFilters,
    pressColumn,
  };
}

/** Everything the member list's components read, as the hook returns it. */
export type MemberList = ReturnType<typeof useMemberList>;
