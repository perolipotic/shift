import type { ReactNode } from 'react';

/**
 * The resolution screen's placeholder while its reads are unanswered, in the
 * shape the screen will take: the facts card, the one option card, and the
 * footer. No spinner, and no figure until every read answers.
 */
export function ResolutionSkeleton(): ReactNode {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="h-32 animate-pulse rounded-lg bg-muted" />
      <div className="h-6 w-40 max-w-full animate-pulse rounded-sm bg-muted" />
      <div className="h-36 animate-pulse rounded-lg bg-muted" />
      <div className="h-11 animate-pulse rounded-md bg-muted" />
    </div>
  );
}
