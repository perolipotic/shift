import { Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { DialogFooter } from '@/components/ui/dialog';
import { Notice } from '@/components/ui/notice';
import type { HourBandEditScreen } from '@/features/hour-bands/hooks/use-hour-band-edit';
import type { HourBandRow } from '@/features/hour-bands/services/list';
import { REMOVE_BUSY, hourBandWriteMessageKey, type HourBandWriteFailure } from '@/features/hour-bands/services/write';
import { t } from '@/lib/i18n';

// REMOVAL TAKES ONE CONFIRMATION naming the band, in neutral styling. Any band
// may be removed, the last one included: the day it leaves uncovered is
// hatched on the list screen's bar, which is where the consequence is stated.

/**
 * A refused removal, announced below the band, OUTSIDE its block so it
 * survives the block unmounting, and marking no field invalid.
 */
export function HourBandRemoveRefusal({
  removeFailure,
}: {
  readonly removeFailure: HourBandWriteFailure | null;
}): ReactNode {
  return removeFailure === null ? null : (
    <Notice role="alert">{t(hourBandWriteMessageKey(removeFailure))}</Notice>
  );
}

/** The removal offer, beside Save in the dialog's footer. */
export function HourBandRemove({
  screen,
  band,
}: {
  readonly screen: HourBandEditScreen;
  readonly band: HourBandRow;
}): ReactNode {
  const { pending, setRemoveFailure, setSaved, setArmed } = screen;

  return (
    <Button
      className="h-11"
      type="button"
      variant="ghost"
      disabled={pending}
      onClick={() => {
        setRemoveFailure(null);
        setSaved(null);
        setArmed(true);
      }}
    >
      <Trash2 aria-hidden />
      {/* THE WORD IS SHORT, THE NAME IS WHOLE: sighted people read the
          band's name in the field above, and the accessible name still
          names it — and begins with the visible word (WCAG 2.5.3). */}
      <span aria-hidden>{t('organization.hourBands.removeShort')}</span>
      <span className="sr-only">{t('organization.hourBands.remove', { name: band.name })}</span>
    </Button>
  );
}

/**
 * THE CONFIRMATION, in place of the form inside the same dialog: one question
 * naming the band, and the two answers side by side. It stays mounted and
 * disabled while the removal is outstanding.
 */
export function HourBandRemoveConfirm({
  screen,
  band,
}: {
  readonly screen: HourBandEditScreen;
  readonly band: HourBandRow;
}): ReactNode {
  const { stage, setArmed, remove } = screen;
  const busy = stage === REMOVE_BUSY;

  return (
    <div className="grid gap-5">
      <p className="text-sm font-medium">
        {t('organization.hourBands.removePrompt', { name: band.name })}
      </p>
      <DialogFooter>
        <Button
          className="h-11"
          type="button"
          variant="outline"
          disabled={busy}
          onClick={() => {
            setArmed(false);
          }}
        >
          <span className="truncate">{t('organization.hourBands.removeCancel')}</span>
        </Button>
        <Button
          className="h-11"
          type="button"
          disabled={busy}
          aria-busy={busy}
          onClick={() => {
            void remove(band);
          }}
        >
          <Trash2 aria-hidden />
          <span className="truncate">
            {t('organization.hourBands.removeConfirm', { name: band.name })}
          </span>
        </Button>
      </DialogFooter>
    </div>
  );
}
