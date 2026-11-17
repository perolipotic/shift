import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DEFAULT_HISTORY_PERIOD,
  filteredHistoryEntries,
  historyBeginsOf,
  historyEntriesOf,
  historyFilterOptionsOf,
  historyPeriodChoicesOf,
  historyPeriodOf,
  type AuditEvent,
  type HistoryPeriod,
} from '@shift/domain';
import { useEffect, useEffectEvent, useMemo } from 'react';

import {
  ABSENCE_TYPES_LIST_KEY,
  ABSENCE_TYPES_TABLE,
  absenceTypesQueryOptions,
} from '@/features/absence-types/services/list';
import { HISTORY_KEY_ROOT, historyQueryOptions, type HistoryTable } from '@/features/history/services/history-read';
import {
  historyBeginsViewOf,
  historyChangeCount,
  historyEventsInZone,
  historyKindOptionsOf,
  historyMemberOptionsOf,
  historyNamesOf,
  historyRowsOf,
  historyTeamOptionsOf,
  type HistoryBeginsView,
  type HistoryOptionView,
  type HistoryRow,
} from '@/features/history/services/history-rows';
import {
  HISTORY_LOADING,
  HISTORY_NO_PERIOD,
  HISTORY_OFFLINE,
  HISTORY_READY,
  HISTORY_UNAVAILABLE_STATE,
} from '@/features/history/services/history-states';
import {
  chooseHistoryChip,
  clearedHistoryFilters,
  historyChipChoiceOf,
  historyChipRemovalOf,
  historyFiltersOf,
  historyFiltersOffered,
  historySearchFor,
  historySearchKeyOf,
  type HistorySearch,
  type HistorySearchFilters,
} from '@/features/history/services/history-search';
import { MEMBERS_LIST_KEY, MEMBERS_TABLE, membersQueryOptions } from '@/features/members/services/list';
import {
  ORGANIZATION_SNAPSHOT_KEY,
  organizationSnapshotQueryOptions,
  organizationTable,
} from '@/features/organization/services/snapshot';
import {
  SHIFT_TYPES_LIST_KEY,
  SHIFT_TYPES_READ_TABLE,
  shiftTypesQueryOptions,
} from '@/features/shift-types/services/list';
import { TEAMS_LIST_KEY, TEAMS_TABLE, teamsQueryOptions } from '@/features/teams/services/list';
import { useOrganizationToday } from '@/hooks/organization-today';
import { useFreshnessClock } from '@/lib/offline/use-snapshot-freshness';
import { supabaseClient } from '@/lib/supabase/client';

/** How the hook writes the URL: the next search, and whether it replaces the entry. */
export type HistoryNavigate = (next: HistorySearch, options: { readonly replace: boolean }) => void;

/** What the screen draws once every read answered. */
export interface HistoryReadyView {
  readonly kind: typeof HISTORY_READY;
  /** The filtered rows, in the order drawn: the value the PDF exports (story 14.3). */
  readonly rows: readonly HistoryRow[];
  /** Every change of the period, before the chips; the start-of-history row is no change. */
  readonly total: number;
  /** The changes among `rows`, for the summary line. */
  readonly shown: number;
  readonly members: readonly HistoryOptionView[];
  readonly teams: readonly HistoryOptionView[];
  readonly kinds: readonly HistoryOptionView[];
  /** Set when the period reaches back to where history begins. */
  readonly begins: HistoryBeginsView | null;
  /** The period has entries and the chips left none: the empty line offers *Poništi filtre*. */
  readonly filteredOut: boolean;
  /** The period's first and last day, ISO: the export's header names them (story 14.3). */
  readonly period: HistoryPeriod;
  /** The organization snapshot's `name`: the export's header and file name. */
  readonly organizationName: string;
  /** The organization's time zone, the export's generation time is read in. */
  readonly zone: string;
}

export type HistoryView =
  | { readonly kind: typeof HISTORY_LOADING }
  | { readonly kind: typeof HISTORY_OFFLINE }
  | { readonly kind: typeof HISTORY_UNAVAILABLE_STATE }
  | HistoryReadyView;

/**
 * *Povijest promjena*'s wiring (story 14.2). Every decision is the domain's
 * (`@shift/domain` history) or `features/history/services/*`'s; this binds
 * the reads, the URL and the states.
 *
 * ONLINE ONLY. The history read is disabled while the device is offline, and
 * while offline the page draws the offline notice — never a cached answer,
 * which nothing persists anyway (`HISTORY_KEY_ROOT` is no kept root).
 *
 * THE READS: the organization (its zone, so the period is whole days in it),
 * one period of `audit_events` under one key (AD-13), with the current rows
 * of the requests whose decisions have no request event in it (retro A3)
 * and the DELETE events of the departed members it names (retro A9), and
 * the four name lists under their own shared keys — members (who each
 * auth user is), teams, shift types and absence types.
 *
 * THE CHIPS filter in the browser over the one snapshot; a value the period
 * does not offer is replaced out of the URL.
 */
export function useChangeHistory(search: HistorySearch, navigate: HistoryNavigate) {
  const queryClient = useQueryClient();
  const { online } = useFreshnessClock();
  const filters = historyFiltersOf(search);

  const organizationRead = useQuery(organizationSnapshotQueryOptions(organizationTable));
  const zone = organizationRead.data?.ok === true ? organizationRead.data.snapshot.timezone : null;
  const organizationName = organizationRead.data?.ok === true ? organizationRead.data.snapshot.name : null;
  const { today } = useOrganizationToday(zone);
  const periods = useMemo(() => (today === null ? null : historyPeriodChoicesOf(today)), [today]);
  const chosenPeriod =
    today === null ? null : (historyPeriodOf(filters.period, today) ?? historyPeriodOf(DEFAULT_HISTORY_PERIOD, today));
  const periodFrom = chosenPeriod?.from ?? null;
  const periodTo = chosenPeriod?.to ?? null;
  // ONE OBJECT PER PERIOD, so the derivations below run once per answer and day.
  const period = useMemo<HistoryPeriod | null>(
    () => (periodFrom === null || periodTo === null ? null : { from: periodFrom, to: periodTo }),
    [periodFrom, periodTo],
  );

  const historyRead = useQuery({
    ...historyQueryOptions(
      (table) => supabaseClient().from(table) as unknown as HistoryTable,
      period ?? HISTORY_NO_PERIOD,
    ),
    enabled: online && period !== null,
  });
  const membersRead = useQuery({
    ...membersQueryOptions(() => supabaseClient().from(MEMBERS_TABLE)),
    enabled: online,
  });
  const teamsRead = useQuery({ ...teamsQueryOptions(() => supabaseClient().from(TEAMS_TABLE)), enabled: online });
  const shiftTypesRead = useQuery({
    ...shiftTypesQueryOptions(() => supabaseClient().from(SHIFT_TYPES_READ_TABLE)),
    enabled: online,
  });
  const absenceTypesRead = useQuery({
    ...absenceTypesQueryOptions(() => supabaseClient().from(ABSENCE_TYPES_TABLE)),
    enabled: online,
  });

  const failed =
    organizationRead.isError ||
    organizationRead.data?.ok === false ||
    historyRead.isError ||
    membersRead.isError ||
    membersRead.data?.ok === false ||
    teamsRead.isError ||
    shiftTypesRead.isError ||
    absenceTypesRead.isError;

  const historyData = historyRead.data;
  const membersData = membersRead.data;
  const teamsData = teamsRead.data;
  const shiftTypesData = shiftTypesRead.data;
  const absenceTypesData = absenceTypesRead.data;

  // THE PERIOD'S ENTRIES, NAMES AND OPTIONS: once per answer, never per chip.
  const snapshot = useMemo(() => {
    if (
      zone === null ||
      period === null ||
      historyData === undefined ||
      membersData === undefined ||
      !membersData.ok ||
      teamsData === undefined ||
      shiftTypesData === undefined ||
      absenceTypesData === undefined
    ) {
      return null;
    }

    const events: readonly AuditEvent[] = historyEventsInZone(historyData.events, zone);
    const entries = historyEntriesOf(events, {
      period,
      members: membersData.members.map((member) => ({ id: member.id, authUserId: member.authUserId })),
      requests: historyData.requests,
      departed: historyData.departed,
    });
    // `namesFrom` reads newest first, so the departed members' DELETE rows go last, newest
    // first: below the read's own rows, the newest DELETE winning among them. The current
    // lists still win over all.
    const names = historyNamesOf([...events, ...[...historyData.departed].reverse()], {
      members: membersData.members,
      teams: teamsData,
      shiftTypes: shiftTypesData.types,
      absenceTypes: absenceTypesData,
    });
    const options = historyFilterOptionsOf(entries);
    const beginning = historyBeginsOf(historyEventsInZone(historyData.markers, zone), entries);
    const begins = historyBeginsViewOf(beginning, period, zone);

    return {
      entries,
      names,
      options,
      begins,
      members: historyMemberOptionsOf(options.members, names),
      teams: historyTeamOptionsOf(options.teams, names),
      kinds: historyKindOptionsOf(options.kinds),
    };
  }, [zone, period, historyData, membersData, teamsData, shiftTypesData, absenceTypesData]);

  const offered = historyFiltersOffered(
    filters,
    periods,
    snapshot === null
      ? null
      : {
          members: snapshot.options.members.map((option) => option.id),
          teams: snapshot.options.teams.map((option) => option.id),
          kinds: snapshot.options.kinds.map((option) => option.id),
        },
  );
  const stateKey = historySearchKeyOf(search);
  const offeredMember = offered.member;
  const offeredTeam = offered.team;
  const offeredKind = offered.kind;

  // THE READY VIEW, ONCE PER SNAPSHOT AND CHIPS (story 14.3): its `rows` keep
  // their identity while the view does, so the export's status and failure
  // lines, keyed on them, go when the period, a chip or a refetch changes them.
  const ready = useMemo<HistoryReadyView | null>(() => {
    if (snapshot === null || zone === null || period === null || organizationName === null) return null;

    const shown = filteredHistoryEntries(snapshot.entries, {
      member: offeredMember,
      team: offeredTeam,
      kind: offeredKind,
    });

    return {
      kind: HISTORY_READY,
      rows: historyRowsOf(shown, snapshot.names, zone),
      filteredOut: shown.length === 0 && snapshot.entries.length > 0,
      total: historyChangeCount(snapshot.entries),
      shown: historyChangeCount(shown),
      members: snapshot.members,
      teams: snapshot.teams,
      kinds: snapshot.kinds,
      begins: snapshot.begins,
      period,
      organizationName,
      zone,
    };
  }, [snapshot, zone, period, organizationName, offeredMember, offeredTeam, offeredKind]);

  let view: HistoryView;

  if (!online) {
    view = { kind: HISTORY_OFFLINE };
  } else if (failed) {
    view = { kind: HISTORY_UNAVAILABLE_STATE };
  } else if (ready === null) {
    view = { kind: HISTORY_LOADING };
  } else {
    view = ready;
  }

  /** Write `next` to the URL, and return the state it leaves. */
  function write(next: HistorySearchFilters, replace: boolean): string {
    const written = historySearchFor(next);
    const key = historySearchKeyOf(written);

    if (key !== stateKey) navigate(written, { replace });

    return key;
  }

  // A VALUE THE SCREEN CANNOT OFFER LEAVES THE URL, replacing the entry.
  const offeredKey = historySearchKeyOf(historySearchFor(offered));
  const dropUnoffered = useEffectEvent((): void => {
    write(offered, true);
  });

  useEffect(() => {
    if (offeredKey === stateKey) return;
    dropUnoffered();
  }, [offeredKey, stateKey]);

  const chipOptions = {
    periods: periods ?? [],
    members: view.kind === HISTORY_READY ? view.members.map((option) => option.id) : [],
    teams: view.kind === HISTORY_READY ? view.teams.map((option) => option.id) : [],
    kinds: view.kind === HISTORY_READY ? view.kinds.map((option) => option.id) : [],
  };

  /** A chip's pick: the URL changes, and the state it leaves is returned. */
  function pickChip(key: string, id: string): string {
    const chip = chooseHistoryChip(key);

    return chip === null ? stateKey : write(historyChipChoiceOf(offered, chip, id, chipOptions), false);
  }

  /** A chip's ✕. */
  function removeChip(key: string): string {
    const chip = chooseHistoryChip(key);

    return chip === null ? stateKey : write(historyChipRemovalOf(offered, chip), false);
  }

  /** Every chip back to its default, in one entry: the sheet's `Poništi`, and `Očisti sve`. */
  function clearFilters(): void {
    write(clearedHistoryFilters(), false);
  }

  /** Read every read the page stands on again: the unavailable notice's retry. */
  function retry(): void {
    for (const queryKey of [
      ORGANIZATION_SNAPSHOT_KEY,
      [HISTORY_KEY_ROOT],
      MEMBERS_LIST_KEY,
      TEAMS_LIST_KEY,
      SHIFT_TYPES_LIST_KEY,
      ABSENCE_TYPES_LIST_KEY,
    ]) {
      void queryClient.invalidateQueries({ queryKey }, { cancelRefetch: false });
    }
  }

  return {
    view,
    filters: offered,
    periods: periods ?? [],
    stateKey,
    loading: view.kind === HISTORY_LOADING,
    retryable: online && view.kind === HISTORY_UNAVAILABLE_STATE,
    pickChip,
    removeChip,
    clearFilters,
    retry,
  };
}

/** What the page's parts are drawn from. */
export type ChangeHistoryScreen = ReturnType<typeof useChangeHistory>;
