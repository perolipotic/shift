import { MoveRight } from 'lucide-react';
import type { ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { OutputField } from '@/components/ui/output-field';
import { HourBandRemove, HourBandRemoveConfirm } from '@/features/hour-bands/components/hour-band-remove';
import type { HourBandEditScreen } from '@/features/hour-bands/hooks/use-hour-band-edit';
import { durationMessageKey, durationValuesOf, type HourBandRow } from '@/features/hour-bands/services/list';
import {
  HOUR_BAND_NAME_FIELD,
  HOUR_BAND_START_FIELD,
  hourBandFormKey,
  marksField,
} from '@/features/hour-bands/services/write';
import { formatMinuteOfDay } from '@/lib/i18n/format';
import { t } from '@/lib/i18n';

/**
 * THE END IS SHOWN BESIDE THE START, computed from the start as typed by
 * `hourBandPreviewOf`, and never entered: a band ends where the next begins.
 * So a changed start shows its new end, duration and midnight flag before it
 * is saved.
 */
function renderEnd(screen: HourBandEditScreen): ReactNode {
  const { preview } = screen;

  return (
    <div className="grid gap-2">
      <Label htmlFor="hour-band-end">{t('organization.hourBands.end')}</Label>
      <OutputField id="hour-band-end" htmlFor="hour-band-start">
        <MoveRight aria-hidden />
        {preview === null ? t('organization.hourBands.endPending') : preview.end}
      </OutputField>
    </div>
  );
}

function renderDuration(screen: HourBandEditScreen): ReactNode {
  const { preview } = screen;

  if (preview === null) return null;

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted-foreground">{t('organization.hourBands.duration.label')}</span>
      <span className="font-semibold tabular-nums">
        {t(durationMessageKey(preview.durationMinutes), durationValuesOf(preview.durationMinutes))}
      </span>
      {/* A pill whose TEXT is the meaning; no status colour. */}
      {preview.crossesMidnight ? (
        <Badge variant="outline">{t('organization.hourBands.crossesMidnight')}</Badge>
      ) : null}
    </div>
  );
}

function renderBand(screen: HourBandEditScreen, band: HourBandRow): ReactNode {
  const { saves, submit, confirming, nameField, startField, setSaved, setTypedStart, failure, pending } = screen;

  return (
    <>
      {/* HIDDEN, NOT UNMOUNTED, while the removal is asked about: a
          cancelled removal returns to the form with what was typed. */}
      <form
        key={hourBandFormKey(band, saves)}
        method="post"
        onSubmit={(event) => {
          void submit(event, band);
        }}
        className={confirming ? 'hidden' : 'grid gap-5'}
      >
        <div className="grid gap-2">
          <Label htmlFor="hour-band-name">{t('organization.hourBands.name')}</Label>
          <Input
            ref={nameField}
            id="hour-band-name"
            name="name"
            type="text"
            required
            defaultValue={band.name}
            onChange={() => {
              // A confirmation describes the last save, not what is typed now.
              setSaved(null);
            }}
            aria-invalid={marksField(failure, HOUR_BAND_NAME_FIELD)}
            aria-describedby={failure === null ? undefined : 'hour-band-form-error'}
            className="h-11"
          />
        </div>
        <div className="grid gap-2">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="hour-band-start">{t('organization.hourBands.start')}</Label>
              <Input
                ref={startField}
                id="hour-band-start"
                name="start"
                type="time"
                required
                defaultValue={formatMinuteOfDay(band.startMinute)}
                onChange={(event) => {
                  setSaved(null);
                  setTypedStart(event.currentTarget.value);
                }}
                aria-invalid={marksField(failure, HOUR_BAND_START_FIELD)}
                aria-describedby={failure === null ? 'hour-band-end-hint' : 'hour-band-form-error'}
                className="h-11"
              />
            </div>
            {renderEnd(screen)}
          </div>
          <p id="hour-band-end-hint" className="text-xs text-muted-foreground">
            {t('organization.hourBands.endHint')}
          </p>
          {renderDuration(screen)}
        </div>
        {/* THE TWO DECISIONS TOGETHER, at the right: remove, then save.
            Neutral, never `destructive`, which UX-DR4 keeps for conflicts;
            the icon and the confirmation that follows carry the weight.
            The dialog's close is the way back. */}
        <DialogFooter>
          <HourBandRemove screen={screen} band={band} />
          <Button className="h-11" type="submit" disabled={pending} aria-busy={pending}>
            {t('organization.hourBands.save')}
          </Button>
        </DialogFooter>
      </form>
      {confirming ? <HourBandRemoveConfirm screen={screen} band={band} /> : null}
    </>
  );
}

/** The dialog's body: the band's form and its removal, or the skeleton while it is read. */
export function HourBandEditBody({ screen }: { readonly screen: HourBandEditScreen }): ReactNode {
  const { form, loading } = screen;

  if (form.band !== null) return renderBand(screen, form.band);

  return loading ? <div className="h-11 w-full animate-pulse rounded-md bg-muted" /> : null;
}
