import { DEFAULT_HISTORY_PERIOD } from '@shift/domain';
import type { ReactNode } from 'react';

import { OptionFilterBar, type OptionChipView } from '@/components/option-filter-bar';
import type { ChangeHistoryScreen } from '@/features/history/hooks/use-change-history';
import { HISTORY_READY } from '@/features/history/services/history-states';
import { historyKindText, historyPeriodText, type HistoryOptionView } from '@/features/history/services/history-rows';
import {
  HISTORY_ALL,
  HISTORY_CHIP_KIND,
  HISTORY_CHIP_MEMBER,
  HISTORY_CHIP_PERIOD,
  HISTORY_CHIP_TEAM,
  historyNarrowed,
} from '@/features/history/services/history-search';
import { t } from '@/lib/i18n';
import { NO_TEXT } from '@/utils/text';

function labelOf(options: readonly HistoryOptionView[], id: string | null, pending: string): string {
  if (id === null) return pending;

  return options.find((option) => option.id === id)?.label ?? pending;
}

/**
 * *Povijest promjena*'s four chips (story 14.2) — Razdoblje (a chip once it is not the default)
 * then Osoba, Smjena and Vrsta — on the shared option-chip bar, with the
 * summary line. What each press changes is the hook's; this only puts the
 * words on it. Dead while there is nothing to narrow.
 */
export function HistoryFilters({ screen }: { readonly screen: ChangeHistoryScreen }): ReactNode {
  const { view, filters, periods } = screen;
  const ready = view.kind === HISTORY_READY ? view : null;
  const members = ready?.members ?? [];
  const teams = ready?.teams ?? [];
  const kinds = ready?.kinds ?? [];
  const count = (option: HistoryOptionView): string => t('history.count', { count: option.count });
  const period = historyPeriodText(filters.period);
  const member = labelOf(members, filters.member, NO_TEXT);
  const team = labelOf(teams, filters.team, NO_TEXT);
  const kind = filters.kind === null ? NO_TEXT : historyKindText(filters.kind);

  const chips: OptionChipView[] = [
    {
      key: HISTORY_CHIP_PERIOD,
      // THE PERIOD IS REQUIRED: in the sheet always, a chip of its own only
      // while it is not the default, whose ✕ goes back to the last 30 days.
      active: filters.period !== DEFAULT_HISTORY_PERIOD,
      text: t('history.chip.period', { value: period }),
      removeLabel: t('history.remove.period', { value: period }),
      pickerLabel: t('history.picker.period'),
      heading: t('history.heading.period'),
      options: periods.map((choice) => ({ id: choice, label: historyPeriodText(choice), count: null })),
      chosen: filters.period,
    },
    {
      key: HISTORY_CHIP_MEMBER,
      active: filters.member !== null,
      text: filters.member === null ? t('history.chip.memberAll') : t('history.chip.member', { value: member }),
      removeLabel: t('history.remove.member', { value: member }),
      pickerLabel: t('history.picker.member'),
      heading: t('history.heading.member'),
      options: [
        { id: HISTORY_ALL, label: t('history.all.member'), count: null },
        ...members.map((option) => ({ id: option.id, label: option.label, count: count(option) })),
      ],
      chosen: filters.member ?? HISTORY_ALL,
      allId: HISTORY_ALL,
    },
    {
      key: HISTORY_CHIP_TEAM,
      active: filters.team !== null,
      text: filters.team === null ? t('history.chip.teamAll') : t('history.chip.team', { value: team }),
      removeLabel: t('history.remove.team', { value: team }),
      pickerLabel: t('history.picker.team'),
      heading: t('history.heading.team'),
      options: [
        { id: HISTORY_ALL, label: t('history.all.team'), count: null },
        ...teams.map((option) => ({ id: option.id, label: option.label, count: count(option) })),
      ],
      chosen: filters.team ?? HISTORY_ALL,
      allId: HISTORY_ALL,
    },
    {
      key: HISTORY_CHIP_KIND,
      active: filters.kind !== null,
      text: filters.kind === null ? t('history.chip.kindAll') : t('history.chip.kind', { value: kind }),
      removeLabel: t('history.remove.kind', { value: kind }),
      pickerLabel: t('history.picker.kind'),
      heading: t('history.heading.kind'),
      options: [
        { id: HISTORY_ALL, label: t('history.all.kind'), count: null },
        ...kinds.map((option) => ({ id: option.id, label: option.label, count: count(option) })),
      ],
      chosen: filters.kind ?? HISTORY_ALL,
      allId: HISTORY_ALL,
    },
  ];

  return (
    <OptionFilterBar
      chips={chips}
      summary={ready === null ? NO_TEXT : t('history.summary', { shown: ready.shown, total: ready.total })}
      showClear={historyNarrowed(filters)}
      shownCount={ready?.shown ?? 0}
      stateKey={screen.stateKey}
      disabled={ready === null}
      onPick={screen.pickChip}
      onRemove={screen.removeChip}
      onClear={screen.clearFilters}
      onReset={screen.clearFilters}
    />
  );
}
