import { HOURS_FIGURE_BAND, HOURS_FIGURE_LEAVE, HOURS_FIGURE_TOTAL, type HoursFigureCode } from '@shift/domain';
import type { ReactNode } from 'react';

import { StatTile, StatTileLabel, StatTileValue } from '@/components/ui/stat-tile';
import { CONFLICT_GLYPH } from '@/features/calendar/utils/modifiers';
import { ExplainButton } from '@/features/hours/components/hours-explanation';
import {
  HOURS_BANDS_HEADING_ID,
  figureIsEmpty,
  leaveShownOf,
  type MyHoursView,
} from '@/features/hours/services/my-hours';
import { t } from '@/lib/i18n';

/**
 * The viewer's month of hours (story 4.1b): the total and the shift count, a
 * row per band in start order — its name as stored, its hours and the shifts
 * that overlap it — the leave row apart, and, only when there are any, the
 * shifts with no times that no hour counts. Every figure is
 * `@/features/hours/services/my-hours`'s, in tabular numerals.
 *
 * Each hours figure that is more than 0 has an ⓘ beside it (story 7.14), which
 * asks for its explanation through `onExplain`.
 *
 * Beside the figures, only when there are any, the shifts in unresolved
 * conflict (story 5.3d): `⚠`, hidden from readers, and the words that carry
 * the meaning. The figures above still count those shifts.
 */
export function HoursSummary({
  view,
  onExplain,
}: {
  readonly view: MyHoursView;
  readonly onExplain: (figure: HoursFigureCode) => void;
}): ReactNode {
  const leave = leaveShownOf(view.leave);

  return (
    <div className="flex min-w-0 flex-col gap-4 px-4 pb-4">
      <div className="grid min-w-0 grid-cols-1 gap-3 min-[360px]:grid-cols-2">
        <StatTile>
          <div className="min-w-0">
            <StatTileLabel>{t('sati.total')}</StatTileLabel>
            <StatTileValue>{t(view.total.key, view.total.values)}</StatTileValue>
          </div>
          {figureIsEmpty(view.total) ? null : (
            <ExplainButton
              figureName={t('sati.total')}
              onPress={() => {
                onExplain({ code: HOURS_FIGURE_TOTAL });
              }}
            />
          )}
        </StatTile>
        <StatTile>
          <div className="min-w-0">
            <StatTileLabel>{t('sati.shifts')}</StatTileLabel>
            <StatTileValue>{t('sati.shiftCount', { count: view.shiftCount })}</StatTileValue>
          </div>
        </StatTile>
      </div>
      {view.conflictCount === null ? null : (
        <p className="flex min-w-0 items-center gap-2 font-semibold">
          <span aria-hidden>{CONFLICT_GLYPH}</span>
          <span className="min-w-0 break-words">{t('sati.conflicts', { count: view.conflictCount })}</span>
        </p>
      )}
      {view.bands.length === 0 ? null : (
        <section className="flex min-w-0 flex-col gap-1">
          <h3 id={HOURS_BANDS_HEADING_ID} className="text-sm font-semibold text-muted-foreground">
            {t('sati.bands')}
          </h3>
          <ul aria-labelledby={HOURS_BANDS_HEADING_ID} className="divide-y divide-border">
            {view.bands.map((band) => (
              <li key={band.bandId} className="flex min-h-11 min-w-0 items-center justify-between gap-3 py-2">
                <span className="min-w-0 break-words font-medium">{band.name}</span>
                <span className="flex shrink-0 items-center gap-1">
                  <span className="flex flex-col items-end tabular-nums">
                    <span className="font-semibold">{t(band.hours.key, band.hours.values)}</span>
                    <span className="text-xs text-muted-foreground">
                      {t('sati.shiftCount', { count: band.shiftCount })}
                    </span>
                  </span>
                  {figureIsEmpty(band.hours) ? null : (
                    <ExplainButton
                      figureName={band.name}
                      onPress={() => {
                        onExplain({ code: HOURS_FIGURE_BAND, bandId: band.bandId });
                      }}
                    />
                  )}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="flex min-h-11 min-w-0 items-center justify-between gap-3 border-t border-border pt-2">
        <span className="min-w-0 break-words font-medium">{t('sati.leave')}</span>
        <span className="flex shrink-0 items-center gap-1">
          <span className="font-semibold tabular-nums">{t(leave.key, leave.values)}</span>
          {view.leave === null ? null : (
            <ExplainButton
              figureName={t('sati.leave')}
              onPress={() => {
                onExplain({ code: HOURS_FIGURE_LEAVE });
              }}
            />
          )}
        </span>
      </div>
      {view.untimedShiftCount === null ? null : (
        <p className="text-sm text-muted-foreground">{t('sati.untimed', { count: view.untimedShiftCount })}</p>
      )}
    </div>
  );
}
