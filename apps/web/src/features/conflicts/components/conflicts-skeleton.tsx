import type { ReactNode } from 'react';

const SKELETON_ROWS = [0, 1, 2];

/**
 * *Raspored*'s placeholder while its two reads are unanswered, in the shape
 * the queue will take: the count, then a bar per row. No spinner, and no
 * count until both reads answer.
 */
export function ConflictsSkeleton(): ReactNode {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="h-6 w-48 max-w-full animate-pulse rounded-sm bg-muted" />
      <div className="flex flex-col gap-2">
        {SKELETON_ROWS.map((row) => (
          <div key={row} className="h-16 animate-pulse rounded-md bg-muted" />
        ))}
      </div>
    </div>
  );
}
