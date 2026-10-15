import type { ReactNode } from 'react';

import { SORT_DIRECTION_GLYPHS } from '@/components/sort-glyphs';
import { Button } from '@/components/ui/button';
import { TableHead } from '@/components/ui/table';
import type { SortAriaState, SortControlDirection } from '@/utils/sort-control';

/**
 * ONE SORTABLE TABLE HEADING, shared by *Sati*'s organization table and
 * *Godišnji*'s leave overview (Epic 4 retro D2, E890): a ghost `Button` that
 * fills the cell, `aria-sort` on the cell, and the arrow beside the label,
 * hidden from readers — `aria-sort` says the direction.
 *
 * It decides nothing: the label is the screen's `t()` or data, and BOTH
 * HALVES OF THE SORT SIGNAL come from the screen's own sort module —
 * `ariaSort` (what a screen reader hears) and `direction` (the arrow a
 * sighted person sees, `null` on a column that is not sorted) — so they
 * cannot disagree. Pressing it hands `sortKey` to `onPress`, the screen's
 * heading press. A `numeric` column's heading aligns right, as its figures
 * do.
 */
export function SortableHead<K extends string>({
  sortKey,
  label,
  ariaSort,
  direction,
  numeric = false,
  onPress,
}: {
  readonly sortKey: K;
  readonly label: string;
  readonly ariaSort: SortAriaState;
  readonly direction: SortControlDirection | null;
  readonly numeric?: boolean;
  readonly onPress: (key: K) => void;
}): ReactNode {
  const Glyph = direction === null ? null : SORT_DIRECTION_GLYPHS[direction];

  return (
    <TableHead aria-sort={ariaSort} className="px-2">
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
