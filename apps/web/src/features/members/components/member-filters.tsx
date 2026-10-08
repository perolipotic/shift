import { Search } from 'lucide-react';
import type { ReactNode } from 'react';

import { OptionFilterBar, type OptionChipView } from '@/components/option-filter-bar';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupIcon } from '@/components/ui/input-group';
import { Label } from '@/components/ui/label';
import { t } from '@/lib/i18n';
import type { MemberList } from '@/features/members/hooks/use-member-list';
import {
  ALL_LEVELS,
  ALL_TEAMS,
  CHIP_LEVEL,
  CHIP_STATUS,
  CHIP_TEAM,
  LEVEL_FILTERS,
  MEMBERS_ERROR_ID,
  NO_TEXT,
  STATUS_FILTERS,
  isNarrowed,
  levelFilterMessageKey,
  memberChipActive,
  memberLevelMessageKey,
  membersSummaryMessageKey,
  statusFilterMessageKey,
  statusValueMessageKey,
  teamFilterMessageKey,
  type MembersSummary,
  type TeamFilterOption,
} from '@/features/members/services/list';

/**
 * The member list's search, its three chips — Razina, Smjena and Status — and
 * the summary line with `Poništi filtre` (story 7.13), drawn by the shared
 * option-chip bar (`@/components/filter-bar`, the 7.5 drawing).
 *
 * WHAT EACH PRESS CHANGES is `@/features/members/services/list`'s, through
 * the hook; this only puts the words on it. The chips are drawn from the URL
 * at once, and are dead while there is no answer to narrow.
 */
export function MemberFilters({ list }: { readonly list: MemberList }): ReactNode {
  const { search, searchField, changeSearch, unanswered, refusal, filters, narrowed, summary } = list;
  // THE TEAM THE ROWS WERE NARROWED BY, once there are rows; before that the
  // URL's, so the chip says what was asked for while the list loads.
  const team = unanswered ? filters.team : narrowed.team;
  const chips: OptionChipView[] = [
    {
      key: CHIP_LEVEL,
      active: memberChipActive(filters, team, CHIP_LEVEL),
      text:
        filters.level === ALL_LEVELS
          ? t('ljudi.chip.levelAll')
          : t('ljudi.chip.level', { value: t(memberLevelMessageKey(filters.level)) }),
      removeLabel: t('ljudi.chip.removeLevel', {
        value: filters.level === ALL_LEVELS ? t('ljudi.chip.allLevels') : t(memberLevelMessageKey(filters.level)),
      }),
      pickerLabel: t('ljudi.chip.levelPicker'),
      heading: t('ljudi.chip.levelHeading'),
      options: LEVEL_FILTERS.map((level) => ({
        id: level,
        label: t(levelFilterMessageKey(level)),
        count: t('filter.personCount', { count: narrowed.counts[level] }),
      })),
      chosen: filters.level,
    },
    {
      key: CHIP_TEAM,
      active: memberChipActive(filters, team, CHIP_TEAM),
      text: team === ALL_TEAMS ? t('filter.chip.teamAll') : t('filter.chip.team', { value: teamName(team, narrowed.teams) }),
      removeLabel: t('filter.remove.team', { value: teamName(team, narrowed.teams) }),
      pickerLabel: t('filter.teamPicker'),
      heading: t('filter.team'),
      options: narrowed.teams.map((option) => ({
        id: option.value,
        label: teamName(option.value, narrowed.teams),
        count: t('filter.personCount', { count: option.count }),
      })),
      chosen: team,
    },
    {
      key: CHIP_STATUS,
      active: memberChipActive(filters, team, CHIP_STATUS),
      text: t('ljudi.chip.status', { value: t(statusValueMessageKey(filters.status)) }),
      removeLabel: t('ljudi.chip.removeStatus', { value: t(statusValueMessageKey(filters.status)) }),
      pickerLabel: t('ljudi.chip.statusPicker'),
      heading: t('ljudi.status.heading'),
      options: STATUS_FILTERS.map((status) => ({
        id: status,
        label: t(statusFilterMessageKey(status)),
        count: t('filter.personCount', { count: narrowed.statuses[status] }),
      })),
      chosen: filters.status,
    },
  ];

  return (
    <OptionFilterBar
      chips={chips}
      summary={summaryText(summary)}
      showClear={!unanswered && isNarrowed(filters)}
      shownCount={narrowed.rows.length}
      stateKey={list.stateKey}
      disabled={unanswered}
      describedBy={refusal === null ? undefined : MEMBERS_ERROR_ID}
      leading={
        <div className="grid min-w-0 flex-1 basis-full lg:basis-64">
          <Label htmlFor="ljudi-search" className="sr-only">
            {t('ljudi.search')}
          </Label>
          <InputGroup>
            <InputGroupIcon>
              <Search />
            </InputGroupIcon>
            <Input
              id="ljudi-search"
              ref={searchField}
              type="search"
              className="h-11 w-full"
              value={search}
              onChange={changeSearch}
              disabled={unanswered}
              aria-describedby={refusal === null ? undefined : MEMBERS_ERROR_ID}
            />
          </InputGroup>
        </div>
      }
      onPick={list.pickChip}
      onRemove={list.removeChip}
      onClear={list.resetFilters}
      onReset={list.clearFilters}
    />
  );
}

/**
 * A team option's name: the team's own (data), `Sve smjene`, `Bez smjene`,
 * or — a team the answer has not named yet — a pending mark.
 */
function teamName(value: string, teams: readonly TeamFilterOption[]): string {
  const key = teamFilterMessageKey(value);

  if (key !== null) return t(key);

  return teams.find((option) => option.value === value)?.team ?? t('ljudi.chip.pending');
}

/** The summary line, or nothing before there is an answer to state. */
function summaryText(summary: MembersSummary | null): string {
  return summary === null ? NO_TEXT : t(membersSummaryMessageKey(summary), { ...summary });
}

