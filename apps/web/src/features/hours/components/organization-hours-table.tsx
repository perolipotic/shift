import { Link } from '@tanstack/react-router';
import { ArrowDown, ArrowUp } from 'lucide-react';
import type { ReactNode, RefObject } from 'react';

import type { FilterBarHandle } from '@/components/filter-bar';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  type HoursSearchChange,
  SORT_LEAVE,
  SORT_NAME,
  SORT_SHIFTS,
  SORT_TEAM,
  SORT_TOTAL,
  leaveShownOf,
  type HoursSortKey,
} from '@/features/hours/services/my-hours';
import {
  HOURS_EMPTY_MONTH,
  HOURS_EMPTY_NOT_IN_TEAM,
  hoursAriaSortOf,
  hoursEmptyFactMessageKey,
  hoursEmptyMessageKey,
  hoursSortArrowOf,
  type HoursEmpty,
  type HoursSortArrow,
  type OrganizationHoursView,
} from '@/features/hours/services/organization-hours';
import { CONFLICT_GLYPH } from '@/features/calendar/utils/modifiers';
import { t } from '@/lib/i18n';
import {
  FILTERS_CLEARED,
  FILTER_TEAM,
  filterRemovalOf,
  monthInMessageKey,
  yearOfMonthText,
  type FilterChange,
} from '@/utils/filter-bar';

/**
 * The glyph each sort direction draws. A RECORD keyed by the rule module's
 * own names, never a ternary: which way the arrow points is
 * `hoursSortArrowOf`'s decision, pinned by execution beside `hoursAriaSortOf`.
 */
const SORT_GLYPHS: Record<HoursSortArrow, typeof ArrowUp> = {
  up: ArrowUp,
  down: ArrowDown,
};

/** One sortable heading: a ghost button, `aria-sort` on the cell, the arrow hidden from readers. */
function SortHead({
  view,
  sortKey,
  label,
  numeric,
  onPress,
}: {
  readonly view: OrganizationHoursView;
  readonly sortKey: HoursSortKey;
  readonly label: string;
  readonly numeric: boolean;
  readonly onPress: (key: HoursSortKey) => void;
}): ReactNode {
  const arrow = hoursSortArrowOf(view.sort, sortKey);
  const Glyph = arrow === null ? null : SORT_GLYPHS[arrow];

  return (
    <TableHead aria-sort={hoursAriaSortOf(view.sort, sortKey)} className="px-2">
      <Button
        variant="ghost"
        // Figures align right, and so do their headings.
        data-numeric={numeric}
        className="h-auto min-h-11 w-full justify-start gap-2 whitespace-nowrap px-2 py-1 text-left data-[numeric=true]:justify-end data-[numeric=true]:text-right"
        onClick={() => {
          onPress(sortKey);
        }}
      >
        <span>{label}</span>
        {Glyph === null ? null : <Glyph aria-hidden className="size-4 shrink-0" />}
      </Button>
    </TableHead>
  );
}

/**
 * What an empty table says (story 7.5): what is true, never "no results". The
 * month has nobody, or the person chosen is not in the team chosen — with
 * where they are instead and two ways out: `Ukloni filtar: Smjena B`, which
 * keeps the person, and `Poništi filtre`. Both stay on the screen, and focus
 * goes to the filter bar's first chip once the change has rendered. Should a
 * filter alone ever leave no row, it says the filters show nobody and offers
 * `Poništi filtre`.
 */
function EmptyResult({
  empty,
  view,
  filtersRef,
  onChange,
}: {
  readonly empty: HoursEmpty;
  readonly view: OrganizationHoursView;
  readonly filtersRef: RefObject<FilterBarHandle | null>;
  readonly onChange: (change: HoursSearchChange) => void;
}): ReactNode {
  if (empty.code === HOURS_EMPTY_MONTH) {
    return <p>{t(hoursEmptyMessageKey(empty))}</p>;
  }

  // The bar makes the change and, once it has rendered, focuses its first chip.
  function act(change: FilterChange): void {
    if (filtersRef.current === null) onChange(change);
    else filtersRef.current.changeAndFocusFirst(change);
  }

  const notInTeam = empty.code === HOURS_EMPTY_NOT_IN_TEAM ? empty : null;
  const when =
    notInTeam === null
      ? null
      : { monthIn: t(monthInMessageKey(notInTeam.month)), year: yearOfMonthText(notInTeam.month) };

  return (
    <div className="grid min-w-0 gap-3 whitespace-normal">
      {notInTeam === null || when === null ? (
        <p className="font-medium text-foreground">{t(hoursEmptyMessageKey(empty))}</p>
      ) : (
        <div className="grid gap-1">
          <p className="font-medium text-foreground">
            {t(hoursEmptyMessageKey(notInTeam), { person: notInTeam.person, team: notInTeam.team, ...when })}
          </p>
          <p>
            {t(hoursEmptyFactMessageKey(notInTeam.personTeam), {
              person: notInTeam.person,
              team: notInTeam.personTeam,
              ...when,
            })}
          </p>
        </div>
      )}
      <div className="flex min-w-0 flex-wrap gap-2">
        {notInTeam === null ? null : (
          <Button
            type="button"
            variant="outline"
            className="h-11"
            onClick={() => {
              act(filterRemovalOf(view.filters, FILTER_TEAM));
            }}
          >
            {t('filter.empty.removeTeam', { team: notInTeam.team })}
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          className="h-11"
          onClick={() => {
            act(FILTERS_CLEARED);
          }}
        >
          {t('filter.clear')}
        </Button>
      </div>
    </div>
  );
}

/**
 * Every member's month (story 4.2): Member, Team, shift count, a column per
 * band (its name as stored; the cell its hours over its shifts), Total and
 * Leave, every heading sortable, and the shifts in unresolved conflict (story
 * 5.3d) — a plain heading, no sort — `⚠` and the number above 0, `0` at
 * zero, the glyph hidden from readers. The name leads to the member's calendar
 * month, where the roster changes behind a figure show. It scrolls inside its
 * own container, never the page. Every figure is
 * `@/features/hours/services/organization-hours`'s, in tabular numerals.
 */
export function OrganizationHoursTable({
  view,
  filtersRef,
  onChange,
  onPress,
}: {
  readonly view: OrganizationHoursView;
  readonly filtersRef: RefObject<FilterBarHandle | null>;
  readonly onChange: (change: HoursSearchChange) => void;
  readonly onPress: (key: HoursSortKey) => void;
}): ReactNode {
  return (
    <div className="flex min-w-0 flex-col gap-3 pb-4">
      <Table>
        <TableCaption className="px-4">
          {t('sati.organization.caption', { month: view.header.monthName, year: view.header.year })}
        </TableCaption>
        <TableHeader>
          <TableRow>
            <SortHead view={view} sortKey={SORT_NAME} label={t('sati.organization.member')} numeric={false} onPress={onPress} />
            <SortHead view={view} sortKey={SORT_TEAM} label={t('sati.organization.team')} numeric={false} onPress={onPress} />
            <SortHead view={view} sortKey={SORT_SHIFTS} label={t('sati.organization.shifts')} numeric onPress={onPress} />
            {view.bands.map((band) => (
              <SortHead key={band.bandId} view={view} sortKey={band.sortKey} label={band.name} numeric onPress={onPress} />
            ))}
            <SortHead view={view} sortKey={SORT_TOTAL} label={t('sati.organization.total')} numeric onPress={onPress} />
            <SortHead view={view} sortKey={SORT_LEAVE} label={t('sati.organization.leave')} numeric onPress={onPress} />
            <TableHead className="whitespace-nowrap px-4 text-right">{t('sati.organization.conflicts')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {view.rows.map((row) => {
            const leave = leaveShownOf(row.leave);

            return (
              <TableRow key={row.memberId}>
                <TableCell className="whitespace-nowrap">
                  <Link
                    to="/kalendar"
                    search={row.calendar}
                    className="inline-flex min-h-11 items-center font-medium underline-offset-4 hover:underline"
                  >
                    {row.name}
                  </Link>
                </TableCell>
                <TableCell className="whitespace-nowrap">{row.team?.name ?? t('sati.organization.noTeam')}</TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums">
                  {t('sati.shiftCount', { count: row.shiftCount })}
                </TableCell>
                {row.bands.map((band) => (
                  <TableCell key={band.bandId} className="whitespace-nowrap text-right tabular-nums">
                    <span className="flex flex-col items-end">
                      <span className="font-semibold">{t(band.hours.key, band.hours.values)}</span>
                      <span className="text-xs text-muted-foreground">
                        {t('sati.shiftCount', { count: band.shiftCount })}
                      </span>
                    </span>
                  </TableCell>
                ))}
                <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums">
                  {t(row.total.key, row.total.values)}
                </TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums">
                  {t(leave.key, leave.values)}
                </TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums">
                  {row.conflictCount === 0 ? (
                    row.conflictCount
                  ) : (
                    <span className="inline-flex items-center gap-1 font-semibold">
                      <span aria-hidden>{CONFLICT_GLYPH}</span>
                      <span>{row.conflictCount}</span>
                    </span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
          {view.empty === null ? null : (
            <TableRow>
              <TableCell colSpan={view.columnCount} className="text-muted-foreground">
                <EmptyResult empty={view.empty} view={view} filtersRef={filtersRef} onChange={onChange} />
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
      {view.untimedShiftCount === null ? null : (
        <p className="px-4 text-sm text-muted-foreground">{t('sati.untimed', { count: view.untimedShiftCount })}</p>
      )}
    </div>
  );
}
