import type { ReactNode } from 'react';

import { SKELETON_COLUMN_COUNT, SKELETON_GRID_STYLE, SKELETON_ROW_COUNT } from '@/features/calendar/utils/month';
import { SKELETON_LIST, type CalendarSkeletonShape } from '@/features/calendar/utils/skeleton';

const SKELETON_ROWS = Array.from({ length: SKELETON_ROW_COUNT }, (_, index) => index);
const SKELETON_COLUMNS = Array.from({ length: SKELETON_COLUMN_COUNT + 1 }, (_, index) => index);

/**
 * The month's placeholder while the one read is unanswered, in the shape the
 * screen will show (`calendarSkeletonShapeOf`): the day list's rows — the date
 * beside one bar, at the day list's own height — or the grid's.
 */
export function CalendarSkeleton({ shape }: { readonly shape: CalendarSkeletonShape }): ReactNode {
  if (shape === SKELETON_LIST) {
    return (
      <div className="divide-y divide-border px-4 pb-4">
        {SKELETON_ROWS.map((row) => (
          <div key={row} className="flex min-h-11 items-center gap-3 py-1 pl-3 pr-1">
            <div className="h-[30px] w-20 shrink-0 animate-pulse rounded-sm bg-muted" />
            <div className="h-[30px] min-w-0 flex-1 animate-pulse rounded-sm bg-muted" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid gap-1 px-4 pb-4">
      {SKELETON_ROWS.map((row) => (
        <div key={row} className="grid gap-1" style={SKELETON_GRID_STYLE}>
          {SKELETON_COLUMNS.map((column) => (
            <div key={column} className="h-[30px] animate-pulse rounded-sm bg-muted" />
          ))}
        </div>
      ))}
    </div>
  );
}
