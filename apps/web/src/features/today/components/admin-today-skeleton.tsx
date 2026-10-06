import type { ReactNode } from 'react';

import { Card } from '@/components/ui/card';
import { ADMIN_WEEK_DAYS, NEEDS_YOU_ROWS } from '@/features/today/services/admin-today';

const NEEDS_YOU_BARS = Array.from({ length: NEEDS_YOU_ROWS }, (_, index) => index);
const COVERAGE_BARS = [0, 1];
const WEEK_ROWS = [0, 1, 2, 3];
const WEEK_COLUMNS = Array.from({ length: ADMIN_WEEK_DAYS }, (_, index) => index);

/**
 * An admin's *Danas* while its reads are unanswered (story 6.3), in the shape
 * the four blocks will take: *Treba tebe* with its count and rows and its
 * action, the coverage rows, the absences, and the week's grid. No spinner,
 * and no figure until the reads answer.
 */
export function AdminTodaySkeleton(): ReactNode {
  return (
    <>
      <Card className="grid min-w-0 gap-3 p-4 sm:p-6">
        <div aria-hidden className="h-4 w-24 max-w-full animate-pulse rounded-sm bg-muted" />
        <div aria-hidden className="h-8 w-56 max-w-full animate-pulse rounded-sm bg-muted" />
        {NEEDS_YOU_BARS.map((bar) => (
          <div key={bar} aria-hidden className="h-14 animate-pulse rounded-md bg-muted" />
        ))}
        <div aria-hidden className="h-11 animate-pulse rounded-md bg-muted" />
      </Card>
      <Card className="grid min-w-0 gap-3 p-4 sm:p-6">
        <div aria-hidden className="h-6 w-40 max-w-full animate-pulse rounded-sm bg-muted" />
        {COVERAGE_BARS.map((bar) => (
          <div key={bar} aria-hidden className="h-12 animate-pulse rounded-sm bg-muted" />
        ))}
      </Card>
      <Card className="grid min-w-0 gap-3 p-4 sm:p-6">
        <div aria-hidden className="h-6 w-36 max-w-full animate-pulse rounded-sm bg-muted" />
        <div aria-hidden className="h-10 animate-pulse rounded-sm bg-muted" />
      </Card>
      <Card className="grid min-w-0 gap-2 p-4 sm:p-6">
        <div aria-hidden className="h-6 w-32 max-w-full animate-pulse rounded-sm bg-muted" />
        {WEEK_ROWS.map((row) => (
          <div key={row} aria-hidden className="grid grid-cols-8 gap-1">
            <div className="h-11 animate-pulse rounded-sm bg-muted" />
            {WEEK_COLUMNS.map((column) => (
              <div key={column} className="h-11 animate-pulse rounded-sm bg-muted" />
            ))}
          </div>
        ))}
      </Card>
    </>
  );
}
