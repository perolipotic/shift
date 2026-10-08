import type { ReactNode } from 'react';

import { StackedSkeletonRow } from '@/components/ui/stacked-list';
import { usePhone } from '@/hooks/viewport';

const SKELETON_ROWS = [0, 1, 2];

/**
 * *Sati*'s placeholder while the one read is unanswered, in the shape the
 * figures will take: the two tiles, then a bar per row — or, below 640 px,
 * a row in the stacked rows' shape (story 7.6): a title, a line under it,
 * the total, and three figure cells. No spinner, and no figure until the
 * read answers.
 */
export function HoursSkeleton(): ReactNode {
  const isPhone = usePhone();

  return (
    <div className="flex min-w-0 flex-col gap-4 px-4 pb-4">
      <div className="grid min-w-0 grid-cols-1 gap-3 min-[360px]:grid-cols-2">
        <div className="h-[76px] animate-pulse rounded-sm bg-muted" />
        <div className="h-[76px] animate-pulse rounded-sm bg-muted" />
      </div>
      {isPhone ? (
        <ul aria-hidden className="-mx-4 grid divide-y border-y">
          {SKELETON_ROWS.map((row) => (
            <StackedSkeletonRow key={row} figures={3} />
          ))}
        </ul>
      ) : null}
      {isPhone ? null : (
        <div className="flex flex-col gap-2">
          {SKELETON_ROWS.map((row) => (
            <div key={row} className="h-11 animate-pulse rounded-sm bg-muted" />
          ))}
        </div>
      )}
    </div>
  );
}
