import { HOURS_FIGURE_BAND, HOURS_FIGURE_LEAVE, HOURS_FIGURE_TOTAL, type HoursFigureCode } from '@shift/domain';
import { Link } from '@tanstack/react-router';
import { ArrowDown, ArrowUp } from 'lucide-react';
import type { ReactNode, RefObject } from 'react';

import type { FilterBarHandle } from '@/components/filter-bar';
import { Button } from '@/components/ui/button';
import { ExplainButton } from '@/features/hours/components/hours-explanation';
import { EmptyResult } from '@/features/hours/components/organization-hours-empty';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
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
  figureIsEmpty,
  leaveShownOf,
  type HoursSortKey,
} from '@/features/hours/services/my-hours';
import {
  hoursAriaSortOf,
  hoursSortArrowOf,
  type HoursSortArrow,
  type OrganizationHoursView,
} from '@/features/hours/services/organization-hours';
import { CONFLICT_GLYPH } from '@/features/calendar/utils/modifiers';
import { t } from '@/lib/i18n';

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
 * Every member's month (story 4.2): Member, Team, shift count, a column per
 * band (its name as stored; the cell its hours over its shifts), Total and
 * Leave, every heading sortable, and the shifts in unresolved conflict (story
 * 5.3d) — a plain heading, no sort — `⚠` and the number above 0, `0` at
 * zero, the glyph hidden from readers. The name leads to the member's calendar
 * month, where the roster changes behind a figure show. It renders from
 * 640 px and scrolls inside its own container, never the page; below 640 px
 * `OrganizationHoursRows` draws the same view as stacked rows (story 7.6),
 * both drawing `EmptyResult` (`./organization-hours-empty`). A footer totals
 * each figure column over the rows shown (story 7.14), and every hours
 * figure above 0 has an ⓘ that asks for its explanation (`onExplain`). Every figure is
 * `@/features/hours/services/organization-hours`'s, in tabular numerals.
 */
export function OrganizationHoursTable({
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
  const footerLeave = leaveShownOf(view.footer?.leave ?? null);

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
                    <span className="flex items-center justify-end gap-1">
                      <span className="flex flex-col items-end">
                        <span className="font-semibold">{t(band.hours.key, band.hours.values)}</span>
                        <span className="text-xs text-muted-foreground">
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
                  </TableCell>
                ))}
                <TableCell className="whitespace-nowrap text-right font-semibold tabular-nums">
                  <span className="flex items-center justify-end gap-1">
                    {t(row.total.key, row.total.values)}
                    {figureIsEmpty(row.total) ? null : (
                      <ExplainButton
                        figureName={`${t('sati.organization.total')}, ${row.name}`}
                        onPress={() => {
                          onExplain(row.memberId, { code: HOURS_FIGURE_TOTAL });
                        }}
                      />
                    )}
                  </span>
                </TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums">
                  <span className="flex items-center justify-end gap-1">
                    {t(leave.key, leave.values)}
                    {row.leave === null ? null : (
                      <ExplainButton
                        figureName={`${t('sati.organization.leave')}, ${row.name}`}
                        onPress={() => {
                          onExplain(row.memberId, { code: HOURS_FIGURE_LEAVE });
                        }}
                      />
                    )}
                  </span>
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
        {view.footer === null ? null : (
          <TableFooter>
            <TableRow>
              <TableCell colSpan={2} className="whitespace-nowrap">
                {t('sati.organization.footer')}
              </TableCell>
              <TableCell className="whitespace-nowrap text-right tabular-nums">
                {t('sati.shiftCount', { count: view.footer.shiftCount })}
              </TableCell>
              {view.footer.bands.map((band) => (
                <TableCell key={band.bandId} className="whitespace-nowrap text-right tabular-nums">
                  {t(band.hours.key, band.hours.values)}
                </TableCell>
              ))}
              <TableCell className="whitespace-nowrap text-right tabular-nums">
                {t(view.footer.total.key, view.footer.total.values)}
              </TableCell>
              <TableCell className="whitespace-nowrap text-right tabular-nums">
                {t(footerLeave.key, footerLeave.values)}
              </TableCell>
              <TableCell className="whitespace-nowrap text-right tabular-nums">{view.footer.conflictCount}</TableCell>
            </TableRow>
          </TableFooter>
        )}
      </Table>
      {view.untimedShiftCount === null ? null : (
        <p className="px-4 text-sm text-muted-foreground">{t('sati.untimed', { count: view.untimedShiftCount })}</p>
      )}
    </div>
  );
}
