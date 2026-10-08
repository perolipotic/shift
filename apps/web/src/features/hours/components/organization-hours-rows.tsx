import { HOURS_FIGURE_BAND, HOURS_FIGURE_LEAVE, HOURS_FIGURE_TOTAL, type HoursFigureCode } from '@shift/domain';
import { Link } from '@tanstack/react-router';
import type { ReactNode, RefObject } from 'react';

import type { FilterBarHandle } from '@/components/filter-bar';
import { SortControl } from '@/components/sort-control';
import { StackedField, StackedFields, StackedList, StackedRow } from '@/components/ui/stacked-list';
import { CONFLICT_GLYPH } from '@/features/calendar/utils/modifiers';
import { ExplainButton } from '@/features/hours/components/hours-explanation';
import { EmptyResult } from '@/features/hours/components/organization-hours-empty';
import {
  SORT_LEAVE,
  SORT_NAME,
  SORT_SHIFTS,
  SORT_TEAM,
  SORT_TOTAL,
  figureIsEmpty,
  leaveShownOf,
  type HoursSearchChange,
  type HoursSortKey,
} from '@/features/hours/services/my-hours';
import { hoursSortDirectionArrowOf, type OrganizationHoursView } from '@/features/hours/services/organization-hours';
import { t } from '@/lib/i18n';
import type { SortControlColumn } from '@/utils/sort-control';

/**
 * Every member's month on a phone (story 7.6): the organization table's own
 * view model as stacked rows, so no figure can differ between the two forms.
 * A row is the name (the link to their calendar month, as in the table) with
 * `{team} · {n} smjena` under it, `Ukupno` over the total at the top right,
 * then a grid of three: a cell per band and the leave, each with its
 * visible label, its hours and, for a band, its shifts. The shifts in
 * unresolved conflict show only above zero, as `⚠` and words, never colour.
 *
 * EVERY VALUE IS A `StackedField`, so each is announced with its column's
 * own label even where the position carries it (`labelHidden`). The sort is
 * the shared `SortControl`, whose pick is the heading press; an empty result
 * is the shared `EmptyResult` with its two ways out, in place of the
 * list and its sort control. Every hours figure above 0 has an ⓘ (story 7.14,
 * `onExplain`), and under the list stands the total of the rows shown.
 */
export function OrganizationHoursRows({
  view,
  filtersRef,
  onChange,
  onPress,
  onExplain,
}: {
  readonly view: OrganizationHoursView;
  readonly filtersRef: RefObject<FilterBarHandle | null>;
  readonly onChange: (change: HoursSearchChange) => void;
  readonly onPress: (key: HoursSortKey) => void;
  readonly onExplain: (memberId: string, figure: HoursFigureCode) => void;
}): ReactNode {
  const columns: readonly SortControlColumn<HoursSortKey>[] = [
    { key: SORT_NAME, label: t('sati.organization.member') },
    { key: SORT_TEAM, label: t('sati.organization.team') },
    { key: SORT_SHIFTS, label: t('sati.organization.shifts') },
    ...view.bands.map((band) => ({ key: band.sortKey, label: band.name })),
    { key: SORT_TOTAL, label: t('sati.organization.total') },
    { key: SORT_LEAVE, label: t('sati.organization.leave') },
  ];

  return (
    <div className="flex min-w-0 flex-col gap-1 pb-4">
      {/* NO SORT OVER NO ROW: an empty result has nothing to order. */}
      {view.empty === null ? (
        <SortControl
          columns={columns}
          active={view.sort.key}
          direction={hoursSortDirectionArrowOf(view.sort)}
          onPick={onPress}
        />
      ) : null}
      {view.empty === null ? (
        <StackedList
          aria-label={t('sati.organization.caption', { month: view.header.monthName, year: view.header.year })}
          className="border-y"
        >
          {view.rows.map((row) => {
            const leave = leaveShownOf(row.leave);

            return (
              <StackedRow key={row.memberId}>
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <StackedFields className="flex min-w-0 flex-wrap items-baseline text-sm text-muted-foreground">
                    <StackedField label={t('sati.organization.member')} labelHidden className="basis-full">
                      <Link
                        to="/kalendar"
                        search={row.calendar}
                        className="inline-flex min-h-11 items-center font-medium text-foreground underline-offset-4 hover:underline"
                      >
                        {row.name}
                      </Link>
                    </StackedField>
                    <StackedField label={t('sati.organization.team')} labelHidden>
                      {row.team?.name ?? t('sati.organization.noTeam')}
                    </StackedField>
                    <StackedField label={t('sati.organization.shifts')} labelHidden separated>
                      {t('sati.shiftCount', { count: row.shiftCount })}
                    </StackedField>
                  </StackedFields>
                  <StackedFields className="shrink-0 text-right">
                    <StackedField label={t('sati.organization.total')}>
                      <span className="flex items-center justify-end gap-1">
                        <span className="text-xl font-bold">{t(row.total.key, row.total.values)}</span>
                        {figureIsEmpty(row.total) ? null : (
                          <ExplainButton
                            figureName={`${t('sati.organization.total')}, ${row.name}`}
                            onPress={() => {
                              onExplain(row.memberId, { code: HOURS_FIGURE_TOTAL });
                            }}
                          />
                        )}
                      </span>
                    </StackedField>
                  </StackedFields>
                </div>
                <StackedFields className="grid grid-cols-3 gap-2">
                  {row.bands.map((band) => (
                    <StackedField label={band.name} key={band.bandId} className="rounded-md bg-muted px-2 py-1.5">
                      <span className="flex items-center justify-between gap-1">
                        <span className="min-w-0">
                          <span className="block font-semibold">{t(band.hours.key, band.hours.values)}</span>
                          <span className="block text-xs text-muted-foreground">
                            {t('sati.shiftCount', { count: band.shiftCount })}
                          </span>
                        </span>
                        {figureIsEmpty(band.hours) ? null : (
                          <ExplainButton
                            figureName={`${band.name}, ${row.name}`}
                            onPress={() => {
                              onExplain(row.memberId, { code: HOURS_FIGURE_BAND, bandId: band.bandId });
                            }}
                          />
                        )}
                      </span>
                    </StackedField>
                  ))}
                  <StackedField label={t('sati.organization.leave')} className="rounded-md bg-muted px-2 py-1.5">
                    <span className="flex items-center justify-between gap-1">
                      <span className="font-semibold">{t(leave.key, leave.values)}</span>
                      {row.leave === null ? null : (
                        <ExplainButton
                          figureName={`${t('sati.organization.leave')}, ${row.name}`}
                          onPress={() => {
                            onExplain(row.memberId, { code: HOURS_FIGURE_LEAVE });
                          }}
                        />
                      )}
                    </span>
                  </StackedField>
                </StackedFields>
                {row.conflictCount === 0 ? null : (
                  <StackedFields className="text-sm font-semibold">
                    <StackedField label={t('sati.organization.conflicts')} labelHidden>
                      <span className="inline-flex items-center gap-1">
                        <span aria-hidden>{CONFLICT_GLYPH}</span>
                        <span>{t('sati.conflicts', { count: row.conflictCount })}</span>
                      </span>
                    </StackedField>
                  </StackedFields>
                )}
              </StackedRow>
            );
          })}
        </StackedList>
      ) : (
        <div className="px-4 text-muted-foreground">
          <EmptyResult empty={view.empty} view={view} filtersRef={filtersRef} onChange={onChange} />
        </div>
      )}
      {view.footer === null ? null : (
        <p className="flex min-w-0 items-baseline justify-between gap-3 px-4 pt-2 font-semibold tabular-nums">
          <span>{t('sati.organization.footer')}</span>
          <span>{t(view.footer.total.key, view.footer.total.values)}</span>
        </p>
      )}
      {view.untimedShiftCount === null ? null : (
        <p className="px-4 pt-2 text-sm text-muted-foreground">{t('sati.untimed', { count: view.untimedShiftCount })}</p>
      )}
    </div>
  );
}
