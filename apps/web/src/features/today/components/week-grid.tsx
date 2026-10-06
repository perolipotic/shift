import { Link } from '@tanstack/react-router';
import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

import { Card } from '@/components/ui/card';
import {
  GRID_CELL_SELECTOR,
  GRID_ORIGIN,
  gridCellSelectorOf,
  gridFocusAfter,
  gridPositionOf,
  isSameGridPosition,
  keyModifiersOf,
  type GridPosition,
} from '@/features/calendar/utils/grid-keys';
import { CONFLICT_GLYPH, modifierTreatmentOf } from '@/features/calendar/utils/modifiers';
import { MODE_SVE, NO_ROTATION_SHOWN } from '@/features/calendar/utils/month';
import { weekCellMessageKey, type Week, type WeekCell, type WeekDay } from '@/features/today/services/admin-today';
import { t } from '@/lib/i18n';

/** The tab stop kept inside the grid, should its rows or columns shrink on a refetch. */
function clampedStop(stop: GridPosition, rows: number, columns: number): GridPosition {
  return {
    row: Math.min(Math.max(stop.row, 0), Math.max(rows - 1, 0)),
    column: Math.min(Math.max(stop.column, 0), Math.max(columns - 1, 0)),
  };
}

/** A cell's full name in words: the day, the team, the type with its range, and the conflict. */
function cellName(cell: WeekCell, day: WeekDay, teamName: string): string {
  return t(weekCellMessageKey(cell), {
    weekday: day.weekday,
    date: day.dayMonth,
    team: teamName,
    type: cell.name ?? t('kalendar.noRotation'),
    range: cell.range,
  });
}

/**
 * *Ovaj tjedan* (story 6.3): every active team across today and the six days
 * after it, each cell the calendar's own, then the legend of the letters and
 * ⚠, and the way to the calendar.
 *
 * KALENDAR'S GRID MODEL (`@/features/calendar/utils/grid-keys`): an ARIA grid
 * with ONE tab stop, a roving `tabIndex`, and the arrows, Home and End moving
 * focus between its cells — a row per team, a column per day, today's first
 * team's cell the stop until another is focused. Each `gridcell` is named in
 * words; its drawing is `aria-hidden`. The grid scrolls inside its own region,
 * never the page.
 */
export function WeekGrid({ week }: { readonly week: Week }): ReactNode {
  const headingId = useId();
  const legendId = useId();
  const gridRef = useRef<HTMLTableElement>(null);
  const [remembered, setRemembered] = useState<GridPosition>(GRID_ORIGIN);
  const columns = week.days.length;
  const stop = clampedStop(remembered, week.rows.length, columns);

  /** A key on the grid, from the cell that has focus: move focus by `gridFocusAfter`, or leave the key alone. */
  function moveFocus(event: KeyboardEvent<HTMLTableElement>): void {
    const target = event.target instanceof HTMLElement ? event.target.closest<HTMLElement>(GRID_CELL_SELECTOR) : null;
    const from = target === null ? null : gridPositionOf(target.dataset);

    if (from === null) return;

    const next = gridFocusAfter(event.key, keyModifiersOf(event), from, { rows: week.rows.length, columns });

    if (next === null) return;

    event.preventDefault();
    setRemembered(next);
    gridRef.current?.querySelector<HTMLElement>(gridCellSelectorOf(next))?.focus();
  }

  /** One team on one date: its drawing hidden, its name in words, and the grid's tab stop or not. */
  function renderCell(cell: WeekCell, day: WeekDay, teamName: string, position: GridPosition): ReactNode {
    const treatment = modifierTreatmentOf(cell.modifiers);

    return (
      <td
        key={cell.date}
        role="gridcell"
        data-row={position.row}
        data-column={position.column}
        tabIndex={isSameGridPosition(position, stop) ? 0 : -1}
        aria-label={cellName(cell, day, teamName)}
        onFocus={() => {
          setRemembered(position);
        }}
        className="rounded-sm p-0.5 outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        <div
          aria-hidden
          className={`${cell.className} ${treatment.className} min-h-11 min-w-9 items-center justify-center tabular-nums`}
        >
          <span className="flex items-center gap-0.5">
            {cell.conflict ? <span className="[font-variant-emoji:text]">{CONFLICT_GLYPH}</span> : null}
            <span>{cell.letter ?? NO_ROTATION_SHOWN}</span>
          </span>
        </div>
      </td>
    );
  }

  return (
    <Card className="min-w-0">
      <section aria-labelledby={headingId} className="grid min-w-0 grid-cols-1 gap-3 p-4 sm:p-6">
        <h2 id={headingId} className="font-heading text-lg font-semibold">
          {t('danas.admin.week.heading')}
        </h2>
        <div role="region" aria-label={t('danas.admin.week.region')} className="relative min-w-0 overflow-x-auto">
          <table
            ref={gridRef}
            role="grid"
            aria-readonly
            aria-labelledby={headingId}
            onKeyDown={moveFocus}
            className="w-full border-separate border-spacing-0 text-sm"
          >
            <thead>
              <tr>
                <th scope="col" className="p-1 text-left text-xs font-semibold text-muted-foreground">
                  {t('danas.admin.week.team')}
                </th>
                {week.days.map((day) => (
                  <th
                    key={day.date}
                    scope="col"
                    aria-current={day.isToday ? 'date' : undefined}
                    className="p-1 text-center text-xs font-normal tabular-nums"
                  >
                    <span className="block">{day.weekdayShort}</span>
                    <span className="block font-semibold">{day.dayMonth}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {week.rows.map((row, rowIndex) => (
                <tr key={row.teamId}>
                  <th scope="row" className="max-w-28 p-1 text-left text-xs font-semibold break-words">
                    {row.teamName}
                  </th>
                  {row.cells.map((cell, column) => {
                    const day = week.days[column];

                    return day === undefined ? null : renderCell(cell, day, row.teamName, { row: rowIndex, column });
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 text-sm">
          <span id={legendId} className="font-semibold">
            {t('danas.admin.week.legend')}
          </span>
          <ul aria-labelledby={legendId} className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {week.legend.map((entry) => (
              <li key={`${entry.letter}-${entry.name}`}>
                {t('danas.admin.week.legendType', { letter: entry.letter, name: entry.name })}
              </li>
            ))}
            {week.anyConflict ? (
              <li className="[font-variant-emoji:text]">
                {t('danas.admin.week.legendConflict', { glyph: CONFLICT_GLYPH })}
              </li>
            ) : null}
          </ul>
        </div>
        <Link
          to="/kalendar"
          search={{ prikaz: MODE_SVE }}
          className="inline-flex min-h-11 items-center font-medium underline underline-offset-4"
        >
          {t('danas.admin.week.link')}
        </Link>
      </section>
    </Card>
  );
}
