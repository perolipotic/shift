import type { ReactNode } from 'react';

import { StatTile, StatTileLabel, StatTileValue } from '@/components/ui/stat-tile';
import { HOURS_BANDS_HEADING_ID, type MyHoursView } from '@/features/hours/services/my-hours';
import { t } from '@/lib/i18n';

/**
 * The viewer's month of hours (story 4.1b): the total and the shift count, a
 * row per band in start order — its name as stored, its hours and the shifts
 * that overlap it — the leave row apart, and, only when there are any, the
 * shifts with no times that no hour counts. Every figure is
 * `@/features/hours/services/my-hours`'s, in tabular numerals.
 */
export function HoursSummary({ view }: { readonly view: MyHoursView }): ReactNode {
  return (
    <div className="flex min-w-0 flex-col gap-4 px-4 pb-4">
      <div className="grid min-w-0 grid-cols-1 gap-3 min-[360px]:grid-cols-2">
        <StatTile>
          <div className="min-w-0">
            <StatTileLabel>{t('sati.total')}</StatTileLabel>
            <StatTileValue>{t(view.total.key, view.total.values)}</StatTileValue>
          </div>
        </StatTile>
        <StatTile>
          <div className="min-w-0">
            <StatTileLabel>{t('sati.shifts')}</StatTileLabel>
            <StatTileValue>{t('sati.shiftCount', { count: view.shiftCount })}</StatTileValue>
          </div>
        </StatTile>
      </div>
      {view.bands.length === 0 ? null : (
        <section className="flex min-w-0 flex-col gap-1">
          <h3 id={HOURS_BANDS_HEADING_ID} className="text-sm font-semibold text-muted-foreground">
            {t('sati.bands')}
          </h3>
          <ul aria-labelledby={HOURS_BANDS_HEADING_ID} className="divide-y divide-border">
            {view.bands.map((band) => (
              <li key={band.bandId} className="flex min-h-11 min-w-0 items-center justify-between gap-3 py-2">
                <span className="min-w-0 break-words font-medium">{band.name}</span>
                <span className="flex shrink-0 flex-col items-end tabular-nums">
                  <span className="font-semibold">{t(band.hours.key, band.hours.values)}</span>
                  <span className="text-xs text-muted-foreground">
                    {t('sati.shiftCount', { count: band.shiftCount })}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="flex min-h-11 min-w-0 items-center justify-between gap-3 border-t border-border pt-2">
        <span className="min-w-0 break-words font-medium">{t('sati.leave')}</span>
        <span className="shrink-0 font-semibold tabular-nums">{t(view.leave.key, view.leave.values)}</span>
      </div>
      {view.untimedShiftCount === null ? null : (
        <p className="text-sm text-muted-foreground">{t('sati.untimed', { count: view.untimedShiftCount })}</p>
      )}
    </div>
  );
}
