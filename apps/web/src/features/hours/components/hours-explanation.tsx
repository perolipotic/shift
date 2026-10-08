import { Info } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Notice } from '@/components/ui/notice';
import { hoursSourceMessageKey, type HoursExplanationView } from '@/features/hours/services/hours-explanation';
import { t } from '@/lib/i18n';

/**
 * The ⓘ beside an hours figure (story 7.14): a ghost icon button, 44 px,
 * named for the figure it explains. Choosing it opens {@link HoursExplanationDrawer}.
 */
export function ExplainButton({
  figureName,
  onPress,
}: {
  /** The figure's name, which the button's accessible name carries. */
  readonly figureName: string;
  readonly onPress: () => void;
}): ReactNode {
  return (
    <Button
      type="button"
      variant="ghost"
      className="h-11 w-11 shrink-0 p-0"
      aria-label={t('sati.explain.open', { figure: figureName })}
      onClick={onPress}
    >
      <Info aria-hidden className="size-4" />
    </Button>
  );
}

/**
 * What composes a figure, as an equation with dates: a line per shift — its
 * date, team, shift type and where it came from (the rotation, a change or a
 * replacement) with the hours it adds — and, under a rule, `=` and the
 * figure. Every line and the figure are the domain's
 * (`@/features/hours/services/hours-explanation`); the lines sum to it
 * exactly. It is the shared modal Dialog, kept mounted and closed through `open`, so
 * every way of closing (the ✕, the backdrop, Escape) returns focus to the ⓘ
 * that opened it. A figure the domain cannot explain (`explanation` `null`) is the
 * message alone.
 */
export function HoursExplanationDrawer({
  open,
  explanation,
  onClose,
}: {
  /** Whether it is shown; it stays mounted when closed, so the browser returns focus to the ⓘ. */
  readonly open: boolean;
  readonly explanation: HoursExplanationView | null;
  readonly onClose: () => void;
}): ReactNode {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      aria-labelledby="sati-explain-title"
      aria-describedby="sati-explain-context"
    >
      <DialogHeader closeLabel={t('sati.explain.close')} onClose={onClose}>
        <DialogTitle id="sati-explain-title">{explanation?.figureName ?? t('sati.explain.title')}</DialogTitle>
        <DialogDescription id="sati-explain-context">{explanation?.context ?? t('sati.explain.contextUnavailable')}</DialogDescription>
      </DialogHeader>
      <EquationBody explanation={explanation} />
    </Dialog>
  );
}

/** The lines of the equation and the figure under them, or the one sentence that stands in for them. */
function EquationBody({ explanation }: { readonly explanation: HoursExplanationView | null }): ReactNode {
  if (explanation === null) {
    return <Notice role="alert">{t('sati.explain.unavailable')}</Notice>;
  }
  if (explanation.lines.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('sati.explain.empty')}</p>;
  }

  return (
    <>
      <ul className="divide-y divide-border">
        {explanation.lines.map((line) => (
          <li key={line.key} className="flex min-h-11 min-w-0 items-center justify-between gap-3 py-2">
            <span className="flex min-w-0 flex-col">
              <span className="font-medium tabular-nums">{line.date}</span>
              <span className="break-words text-sm text-muted-foreground">
                {t('sati.explain.line', {
                  team: line.team,
                  shiftType: line.shiftType,
                  source: t(hoursSourceMessageKey(line.source)),
                })}
              </span>
            </span>
            <span className="shrink-0 font-semibold tabular-nums">
              <span aria-hidden>{t('sati.explain.plus')} </span>
              {t(line.hours.key, line.hours.values)}
            </span>
          </li>
        ))}
      </ul>
      <p className="flex min-h-11 items-center justify-between gap-3 border-t border-border pt-2 font-bold tabular-nums">
        <span aria-hidden>{t('sati.explain.equals')}</span>
        <span className="sr-only">{t('sati.explain.sum')}</span>
        <span>{t(explanation.total.key, explanation.total.values)}</span>
      </p>
    </>
  );
}
