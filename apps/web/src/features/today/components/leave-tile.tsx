import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { StatTile, StatTileLabel, StatTileValue } from '@/components/ui/stat-tile';
import { leaveCarriedLineMessageKey } from '@/features/leave/services/leave-section';
import { TodayTileSkeleton } from '@/features/today/components/today-skeleton';
import { TILE_LOADING, TILE_UNAVAILABLE, type LeaveTile as LeaveTileState } from '@/features/today/services/today-tiles';
import { t } from '@/lib/i18n';
import { formatLeaveDays } from '@/lib/i18n/format';

/**
 * The leave balance (story 6.1b), *Godišnji*'s own figures: the days left
 * through `count.days` — a negative balance stays a number — then the days
 * used and the allowance, and under them the carried line when days were
 * carried (story 13.4b). The whole tile — a `StatTile`, at least 44 px
 * tall — links to *Godišnji*; when
 * *Godišnji* would show its unavailable sentence, so does the tile, and it
 * still links there, where the retry is.
 */
export function LeaveTile({ tile }: { readonly tile: LeaveTileState }): ReactNode {
  // ONE RETURN: the skeleton, or the link around the tile.
  return tile.kind === TILE_LOADING ? (
    <TodayTileSkeleton />
  ) : (
    <Link
      to="/godisnji"
      className="flex min-h-11 min-w-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <StatTile className="w-full items-start">
        {tile.kind === TILE_UNAVAILABLE ? (
          <p className="min-w-0 break-words text-sm">{t(tile.key)}</p>
        ) : (
          <div className="grid min-w-0 gap-1">
            <StatTileLabel>{t('danas.tiles.leaveKicker')}</StatTileLabel>
            <StatTileValue>{t('count.days', { count: tile.figures.balanceDays })}</StatTileValue>
            <p className="min-w-0 break-words text-xs text-muted-foreground tabular-nums">
              {t('danas.tiles.leaveHint', {
                used: formatLeaveDays(tile.figures.usedDays),
                allowance: formatLeaveDays(tile.figures.allowanceDays),
              })}
            </p>
            {tile.figures.carried === null ? null : (
              <p className="min-w-0 break-words text-xs text-muted-foreground tabular-nums">
                {t(leaveCarriedLineMessageKey(tile.figures.carried.kind), { ...tile.figures.carried })}
              </p>
            )}
          </div>
        )}
      </StatTile>
    </Link>
  );
}
