import type { ReactNode } from 'react';

import { OptionFilterBar, type OptionChipView } from '@/components/option-filter-bar';
import { MagnifyingGlass } from '@/components/ui/icon';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupIcon } from '@/components/ui/input-group';
import { Label } from '@/components/ui/label';
import type { LeaveOverviewScreen } from '@/features/leave/hooks/use-leave-overview';
import {
  OVERVIEW_CHIP_STATE,
  OVERVIEW_CHIP_TEAM,
  OVERVIEW_READY,
  OVERVIEW_STATES,
  OVERVIEW_STATE_ALL,
  leaveOverviewNarrowed,
  leaveOverviewStateMessageKey,
  leaveOverviewStateValueMessageKey,
  type LeaveOverviewTeamOption,
} from '@/features/leave/services/leave-overview';
import { ALL_TEAMS, teamFilterMessageKey } from '@/features/members/services/list';
import { t } from '@/lib/i18n';
import { NO_TEXT } from '@/utils/text';

/**
 * The overview's *Traži osobu*, its two chips — Smjena and Stanje — and the
 * summary line with `Poništi filtre` (E884), drawn by the shared option-chip
 * bar as *Ljudi*'s. What each press changes is
 * `@/features/leave/services/leave-overview`'s, through the hook; this only
 * puts the words on it. The chips are drawn from the URL at once and are dead
 * while there are no rows to narrow.
 */
export function LeaveOverviewFilters({ screen }: { readonly screen: LeaveOverviewScreen }): ReactNode {
  const { overview, filters, team, search, searchField, changeSearch } = screen;
  const ready = overview.kind === OVERVIEW_READY ? overview : null;
  const teams = ready?.teams ?? [];
  const chips: OptionChipView[] = [
    {
      key: OVERVIEW_CHIP_TEAM,
      active: team !== ALL_TEAMS,
      text: team === ALL_TEAMS ? t('filter.chip.teamAll') : t('filter.chip.team', { value: teamName(team, teams) }),
      removeLabel: t('filter.remove.team', { value: teamName(team, teams) }),
      pickerLabel: t('filter.teamPicker'),
      heading: t('filter.team'),
      options: teams.map((option) => ({
        id: option.value,
        label: teamName(option.value, teams),
        count: t('filter.personCount', { count: option.count }),
      })),
      chosen: team,
    },
    {
      key: OVERVIEW_CHIP_STATE,
      active: filters.state !== OVERVIEW_STATE_ALL,
      text: t('godisnji.overview.stateChip', { value: t(leaveOverviewStateValueMessageKey(filters.state)) }),
      removeLabel: t('godisnji.overview.stateRemove', { value: t(leaveOverviewStateValueMessageKey(filters.state)) }),
      pickerLabel: t('godisnji.overview.statePicker'),
      heading: t('godisnji.overview.stateHeading'),
      options: OVERVIEW_STATES.map((state) => ({
        id: state,
        label: t(leaveOverviewStateMessageKey(state)),
        count: ready === null ? null : t('filter.personCount', { count: ready.states[state] }),
      })),
      chosen: filters.state,
    },
  ];

  return (
    <OptionFilterBar
      chips={chips}
      summary={
        ready === null
          ? NO_TEXT
          : t('godisnji.overview.summary', {
              count: ready.summary.shown,
              records: ready.summary.records,
              used: ready.summary.usedDays,
              allowance: ready.summary.allowanceDays,
            })
      }
      showClear={ready !== null && leaveOverviewNarrowed({ team, state: filters.state })}
      shownCount={ready?.rows.length ?? 0}
      stateKey={screen.stateKey}
      disabled={ready === null}
      leading={
        <div className="grid min-w-0 flex-1 basis-full lg:basis-64">
          <Label htmlFor="godisnji-overview-search" className="sr-only">
            {t('godisnji.overview.search')}
          </Label>
          <InputGroup>
            <InputGroupIcon>
              <MagnifyingGlass />
            </InputGroupIcon>
            <Input
              id="godisnji-overview-search"
              ref={searchField}
              type="search"
              className="h-11 w-full"
              placeholder={t('godisnji.overview.search')}
              value={search}
              onChange={changeSearch}
            />
          </InputGroup>
        </div>
      }
      onPick={screen.pickChip}
      onRemove={screen.removeChip}
      onClear={screen.resetFilters}
      onReset={screen.clearFilters}
    />
  );
}

/**
 * A team option's name: the team's own (data), `Sve smjene` or `Bez smjene`,
 * or — a team the rows have not named yet — a pending mark.
 */
function teamName(value: string, teams: readonly LeaveOverviewTeamOption[]): string {
  const key = teamFilterMessageKey(value);

  if (key !== null) return t(key);

  return teams.find((option) => option.value === value)?.team ?? t('ljudi.chip.pending');
}
