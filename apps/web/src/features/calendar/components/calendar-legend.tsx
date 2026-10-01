import type { ReactNode } from 'react';

import { ModifierGlyphs } from '@/features/calendar/components/modifier-glyphs';
import { legendOf, modifierMessageKey, modifierTreatmentOf } from '@/features/calendar/utils/modifiers';
import type { CalendarCell } from '@/features/calendar/utils/month';
import { LEGEND_HEADING_ID } from '@/features/calendar/utils/element-ids';
import { t } from '@/lib/i18n';

/** The legend of the marks on screen, or nothing when there are none. */
export function CalendarLegend({ cells }: { readonly cells: Iterable<CalendarCell | null> }): ReactNode {
  const legend = legendOf(cells);

  if (legend.length === 0) return null;

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 px-4 pb-3 text-sm">
      <span id={LEGEND_HEADING_ID} className="font-semibold">
        {t('kalendar.legend')}
      </span>
      <ul aria-labelledby={LEGEND_HEADING_ID} className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {legend.map((modifier) => (
          <li key={modifier} className="flex items-center gap-2">
            <span
              aria-hidden
              className={`inline-flex size-6 items-center justify-center rounded-sm bg-card text-xs [font-variant-emoji:text] ${modifierTreatmentOf([modifier]).className}`}
            >
              <ModifierGlyphs glyphs={modifierTreatmentOf([modifier]).glyphs} />
            </span>
            <span>{t(modifierMessageKey(modifier))}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
