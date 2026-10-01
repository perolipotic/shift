import type { ReactNode } from 'react';

import { ModifierGlyphs } from '@/features/calendar/components/modifier-glyphs';
import { modifierNamesTextOf, modifierTreatmentOf } from '@/features/calendar/utils/modifiers';
import {
  COMPRESSED_CELL_CLASS,
  DAY_CELL_CLASS,
  DAY_RANGE_CLASS,
  GRID_RANGE_CLASS,
  NO_ROTATION_SHOWN,
  type CalendarCell,
} from '@/features/calendar/utils/month';
import { translateCellLabel } from '@/features/calendar/utils/cell-label';
import { t } from '@/lib/i18n';

/** A cell's name or letter; in the grid, every part `aria-hidden` and the letter first. */
function renderCellName(cell: CalendarCell, inGrid: boolean): ReactNode {
  if (cell.name === null) {
    return (
      <>
        <span aria-hidden>{NO_ROTATION_SHOWN}</span>
        {inGrid ? null : <span className="sr-only">{t('kalendar.noRotation')}</span>}
      </>
    );
  }

  if (!inGrid) {
    return <span>{cell.name}</span>;
  }

  return (
    <>
      <span aria-hidden className="sm:hidden">
        {cell.letter}
      </span>
      <span aria-hidden className="hidden sm:inline">
        {cell.name}
      </span>
    </>
  );
}

/**
 * THE ONE CELL RENDERER, for the grid (full and compressed) and the day
 * list: the type's fill, any modifier's ring or hatch over it, and the
 * glyphs beside the name or letter. In the grid every part is `aria-hidden`,
 * because the `gridcell`'s label names it in full; in the day list the
 * marks' names are there for a screen reader.
 */
export function CalendarCellBox({
  cell,
  inGrid,
}: {
  readonly cell: CalendarCell;
  readonly inGrid: boolean;
}): ReactNode {
  const treatment = modifierTreatmentOf(cell.modifiers);

  return (
    <div className={`${cell.className} ${inGrid ? COMPRESSED_CELL_CLASS : DAY_CELL_CLASS} ${treatment.className}`}>
      {treatment.glyphs.length === 0 ? (
        renderCellName(cell, inGrid)
      ) : (
        <span className="flex items-center gap-1">
          {renderCellName(cell, inGrid)}
          <ModifierGlyphs glyphs={treatment.glyphs} />
        </span>
      )}
      {cell.range === null ? null : (
        <span
          aria-hidden={inGrid ? true : undefined}
          className={inGrid ? GRID_RANGE_CLASS : DAY_RANGE_CLASS}
        >
          {cell.range}
        </span>
      )}
      {inGrid || treatment.modifiers.length === 0 ? null : (
        <span className="sr-only">{modifierNamesTextOf(treatment.modifiers, translateCellLabel)}</span>
      )}
    </div>
  );
}
