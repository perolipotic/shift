import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { StatTile, StatTileLabel, StatTileValue } from '@/components/ui/stat-tile';
import { CONFLICT_GLYPH } from '@/features/calendar/utils/modifiers';
import { TodayTileSkeleton } from '@/features/today/components/today-skeleton';
import { TILE_LOADING, TILE_UNAVAILABLE, type HoursTile as HoursTileState } from '@/features/today/services/today-tiles';
import { t } from '@/lib/i18n';

/**
 * The month's hours (story 6.1b), *Sati*'s own figures for today's month:
 * the kicker naming the month, the total, every band in *Sati*'s order — 0 h
 * bands included — and *Sati*'s conflict line when there is one. The whole
 * tile — a `StatTile`, at least 44 px tall — links to *Sati*; when *Sati* would show its unavailable sentence, so
 * does the tile, and it still links there, where the retry is.
 */
export function HoursTile({ tile }: { readonly tile: HoursTileState }): ReactNode {
  // ONE RETURN: the skeleton, or the link around the tile.
  return tile.kind === TILE_LOADING ? (
    <TodayTileSkeleton />
  ) : (
    <Link
      to="/sati"
      className="flex min-h-11 min-w-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <StatTile className="w-full items-start">
        {tile.kind === TILE_UNAVAILABLE ? (
          <p className="min-w-0 break-words text-sm">{t(tile.key)}</p>
        ) : (
          <div className="grid min-w-0 gap-1">
            <StatTileLabel>
              {t('danas.tiles.hoursKicker', { month: tile.figures.monthName, year: tile.figures.year })}
            </StatTileLabel>
            <StatTileValue>{t(tile.figures.total.key, tile.figures.total.values)}</StatTileValue>
            {tile.figures.bands.length === 0 ? null : (
              <p className="min-w-0 break-words text-xs text-muted-foreground tabular-nums">
                {tile.figures.bands.map((band, index) => (
                  <span key={band.bandId}>
                    {index === 0 ? null : t('danas.tiles.separator')}
                    {t('danas.tiles.band', { name: band.name, hours: t(band.hours.key, band.hours.values) })}
                  </span>
                ))}
              </p>
            )}
            {tile.figures.conflictCount === null ? null : (
              <p className="flex min-w-0 items-center gap-1 text-xs font-semibold">
                <span aria-hidden>{CONFLICT_GLYPH}</span>
                <span className="min-w-0 break-words">{t('sati.conflicts', { count: tile.figures.conflictCount })}</span>
              </p>
            )}
          </div>
        )}
      </StatTile>
    </Link>
  );
}
