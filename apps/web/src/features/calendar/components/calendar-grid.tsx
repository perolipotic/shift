import type { ReactNode } from 'react';

import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CalendarCellBox } from '@/features/calendar/components/calendar-cell';
import { CalendarLegend } from '@/features/calendar/components/calendar-legend';
import type { CalendarScreenState } from '@/features/calendar/hooks/use-calendar-screen';
import { DAY_DETAIL_POPUP } from '@/features/calendar/utils/day-detail';
import { MONTH_HEADING_ID, gridTabStopOf, isSameGridPosition, type GridPosition } from '@/features/calendar/utils/grid-keys';
import type { CalendarCell, CalendarMonth } from '@/features/calendar/utils/month';
import { t } from '@/lib/i18n';

/**
 * One data cell: a `gridcell` named in full by `cellLabelOf` (through
 * `gridCellLabelsOf`) — the date, the team, the type, the range and each
 * modifier, never a letter — with its drawing `aria-hidden` beside it.
 */
function renderCell(
  screen: CalendarScreenState,
  month: string,
  date: string,
  cell: CalendarCell,
  label: string | undefined,
  position: GridPosition,
  tabStop: GridPosition,
): ReactNode {
  return (
    <TableCell
      key={cell.teamId}
      role="gridcell"
      data-row={position.row}
      data-column={position.column}
      tabIndex={isSameGridPosition(position, tabStop) ? 0 : -1}
      aria-label={label}
      aria-haspopup={DAY_DETAIL_POPUP}
      onFocus={() => {
        screen.remember(month, position);
      }}
      onClick={(event) => {
        screen.openDay(cell.teamId, date, event.currentTarget);
      }}
      className="cursor-pointer px-1 py-1 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
    >
      <CalendarCellBox cell={cell} inGrid />
    </TableCell>
  );
}

/**
 * *Sve smjene*'s grid (stories 3.1, 3.2b): a row per date and a column per
 * active team, an ARIA grid with one tab stop that the arrows, Home and End
 * move by `@/features/calendar/utils/grid-keys`, and the legend above it
 * while a mark is on screen. Below 640 px it is COMPRESSED by CSS alone — one
 * letter per team header and per cell, the full names `sr-only` — and is the
 * same table; from 640 px up it is story 3.1's.
 */
export function CalendarGrid({
  shown,
  screen,
}: {
  readonly shown: CalendarMonth;
  readonly screen: CalendarScreenState;
}): ReactNode {
  if (shown.columns.length === 0) {
    return <p className="px-4 pb-4 text-sm text-muted-foreground">{t('kalendar.noTeams')}</p>;
  }

  const tabStop = gridTabStopOf(screen.gridFocus, shown.month, shown.rows, shown.columns.length);

  return (
    <>
      <CalendarLegend cells={shown.rows.flatMap((row) => row.cells)} />
      <Table
        ref={screen.gridRef}
        role="grid"
        aria-readonly
        aria-labelledby={MONTH_HEADING_ID}
        onKeyDown={(event) => {
          screen.moveGridFocus(event, shown);
        }}
        onKeyUp={(event) => {
          screen.openOnKeyUp(event, shown);
        }}
      >
        <TableHeader>
          <TableRow>
            <TableHead scope="col" className="sticky left-0 bg-muted">
              {t('kalendar.columnDate')}
            </TableHead>
            {shown.columns.map((team) => (
              <TableHead key={team.id} scope="col" className="whitespace-nowrap normal-case max-sm:text-center">
                <span aria-hidden className="sm:hidden">
                  {team.letter}
                </span>
                <span className="sr-only sm:not-sr-only">{team.name}</span>
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {shown.rows.map((row, rowIndex) => (
            <TableRow key={row.date} aria-current={row.isToday ? 'date' : undefined}>
              <TableHead
                scope="row"
                className={
                  row.isToday
                    ? 'sticky left-0 h-auto whitespace-nowrap border-l-4 border-foreground bg-card py-1 text-sm font-bold normal-case tracking-normal text-foreground'
                    : 'sticky left-0 h-auto whitespace-nowrap bg-card py-1 text-sm font-medium normal-case tracking-normal text-foreground'
                }
              >
                <span className="block tabular-nums">{row.dayMonth}</span>
                <span className="block text-xs font-normal text-muted-foreground">{row.weekday}</span>
              </TableHead>
              {row.cells.map((cell, column) =>
                renderCell(
                  screen,
                  shown.month,
                  row.date,
                  cell,
                  screen.labels?.[rowIndex]?.[column],
                  { row: rowIndex, column },
                  tabStop,
                ),
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  );
}
