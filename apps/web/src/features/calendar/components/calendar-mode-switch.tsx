import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { MODE_MOJ, MODE_SVE, type CalendarMode } from '@/features/calendar/utils/month';
import { t } from '@/lib/i18n';

/**
 * The two modes (story 3.2a). The pressed mode is filled from its own
 * `aria-pressed`, so the fill and the state never disagree; it differs from
 * the other by fill AND border.
 */
export function CalendarModeSwitch({
  chosen,
  onChoose,
}: {
  readonly chosen: CalendarMode;
  readonly onChoose: (prikaz: CalendarMode) => void;
}): ReactNode {
  return (
    <div role="group" aria-label={t('kalendar.mode.label')} className="flex w-full gap-2 sm:w-auto">
      <Button
        type="button"
        variant="outline"
        className="h-11 min-w-11 flex-1 aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground sm:flex-none"
        aria-pressed={chosen === MODE_MOJ}
        onClick={() => {
          onChoose(MODE_MOJ);
        }}
      >
        {t('kalendar.mode.moj')}
      </Button>
      <Button
        type="button"
        variant="outline"
        className="h-11 min-w-11 flex-1 aria-pressed:border-primary aria-pressed:bg-primary aria-pressed:text-primary-foreground sm:flex-none"
        aria-pressed={chosen === MODE_SVE}
        onClick={() => {
          onChoose(MODE_SVE);
        }}
      >
        {t('kalendar.mode.sve')}
      </Button>
    </div>
  );
}
