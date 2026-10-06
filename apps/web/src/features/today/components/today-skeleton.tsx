import type { ReactNode } from 'react';

import { Card } from '@/components/ui/card';
import { WEEK_DAYS } from '@/features/today/services/today';

const WEEK_ROWS = Array.from({ length: WEEK_DAYS }, (_, index) => index);

/** One of the two tiles' placeholder while its reads are pending (story 6.1b), in the tile's shape. */
export function TodayTileSkeleton(): ReactNode {
  return <div aria-hidden className="h-28 min-w-0 animate-pulse rounded-md bg-muted" />;
}

/**
 * *Danas*'s placeholder while its reads are unanswered, in the shape the
 * cards will take: today's card, the next shift's, a bar per day of the
 * week, and the two tiles side by side (story 6.1b). No spinner, and no case
 * until the reads answer.
 */
export function TodaySkeleton(): ReactNode {
  return (
    <>
      <Card className="grid min-w-0 gap-3 p-4 sm:p-6">
        <div aria-hidden className="h-7 w-48 max-w-full animate-pulse rounded-sm bg-muted" />
        <div aria-hidden className="h-5 w-64 max-w-full animate-pulse rounded-sm bg-muted" />
      </Card>
      <Card className="grid min-w-0 gap-3 p-4 sm:p-6">
        <div aria-hidden className="h-6 w-56 max-w-full animate-pulse rounded-sm bg-muted" />
        <div aria-hidden className="h-5 w-40 max-w-full animate-pulse rounded-sm bg-muted" />
        <div aria-hidden className="h-5 w-32 max-w-full animate-pulse rounded-sm bg-muted" />
      </Card>
      <Card className="grid min-w-0 gap-2 p-4 sm:p-6">
        <div aria-hidden className="h-6 w-40 max-w-full animate-pulse rounded-sm bg-muted" />
        {WEEK_ROWS.map((row) => (
          <div key={row} aria-hidden className="h-11 animate-pulse rounded-sm bg-muted" />
        ))}
      </Card>
      <div className="grid min-w-0 grid-cols-2 gap-3">
        <TodayTileSkeleton />
        <TodayTileSkeleton />
      </div>
    </>
  );
}
