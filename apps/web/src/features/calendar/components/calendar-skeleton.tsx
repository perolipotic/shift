import type { ReactNode } from 'react';

import { SKELETON_COLUMN_COUNT, SKELETON_GRID_STYLE, SKELETON_ROW_COUNT } from '@/features/calendar/utils/month';

const SKELETON_ROWS = Array.from({ length: SKELETON_ROW_COUNT }, (_, index) => index);
const SKELETON_COLUMNS = Array.from({ length: SKELETON_COLUMN_COUNT + 1 }, (_, index) => index);

/** The month's placeholder while the one read is unanswered. */
export function CalendarSkeleton(): ReactNode {
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
