import type { ReactNode } from 'react';

const SKELETON_TILES = [0, 1, 2];

/**
 * *Godišnji*'s placeholder while its reads are unanswered, in the shape the
 * figures will take: three tiles. No spinner, and no figure until every read
 * answers.
 */
export function MyLeaveSkeleton(): ReactNode {
  return (
    <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3">
      {SKELETON_TILES.map((tile) => (
        <div key={tile} className="h-[76px] animate-pulse rounded-md bg-muted" />
      ))}
    </div>
  );
}
