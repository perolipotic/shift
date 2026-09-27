import { MoveRight } from 'lucide-react';
import type { ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { OutputField } from '@/components/ui/output-field';
import type { HourBandListScreen } from '@/features/hour-bands/hooks/use-hour-band-list';
import { durationMessageKey, durationValuesOf } from '@/features/hour-bands/services/list';
import {
  HOUR_BAND_NAME_FIELD,
  HOUR_BAND_START_FIELD,
  hourBandWriteMessageKey,
  marksField,
} from '@/features/hour-bands/services/write';
import { NO_TEXT } from '@/features/members/services/list';
import { t } from '@/lib/i18n';

/**
 * THE ADD FORM IS A DIALOG (design refresh C), opened from the explainer. The
 * dialog stays mounted while closed, so its uncontrolled fields keep a refused
 * value; a successful add closes it and confirms on the page.
 */
export function HourBandAddDialog({ screen }: { readonly screen: HourBandListScreen }): ReactNode {
  const { adding, setAdding, submit, nameField, startField, setCreated, setTypedStart, failure, preview, pending } =
    screen;

  return (
    // NOT DISMISSIBLE WHILE A CREATE IS IN FLIGHT: Escape, the backdrop, the
    // close control and Cancel all wait for the outcome, so the dialog that
    // reports it cannot be closed before it lands.
    <Dialog
      open={adding}
      onOpenChange={setAdding}
      dismissible={!pending}
      aria-labelledby="hour-band-new-heading"
    >
      <DialogHeader
        closeLabel={t('organization.hourBands.close')}
        onClose={() => {
          if (!pending) setAdding(false);
        }}
      >
        <DialogTitle id="hour-band-new-heading">{t('organization.hourBands.addHeading')}</DialogTitle>
      </DialogHeader>
      <form
        method="post"
        onSubmit={(event) => {
          void submit(event);
        }}
        className="grid gap-5"
      >
        <div className="grid gap-2">
          <Label htmlFor="hour-band-new-name">{t('organization.hourBands.name')}</Label>
          <Input
            ref={nameField}
            id="hour-band-new-name"
            name="name"
            type="text"
            required
            defaultValue={NO_TEXT}
            onChange={() => {
              // A confirmation describes the last save, not what is typed now.
              setCreated(false);
            }}
            aria-invalid={marksField(failure, HOUR_BAND_NAME_FIELD)}
            aria-describedby={failure === null ? undefined : 'hour-band-create-error'}
            className="h-11 w-full"
          />
        </div>
        <div className="grid gap-2">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="hour-band-new-start">{t('organization.hourBands.start')}</Label>
              <Input
                ref={startField}
                id="hour-band-new-start"
                name="start"
                type="time"
                required
                defaultValue={NO_TEXT}
                onChange={(event) => {
                  setCreated(false);
                  setTypedStart(event.currentTarget.value);
                }}
                aria-invalid={marksField(failure, HOUR_BAND_START_FIELD)}
                aria-describedby={failure === null ? 'hour-band-new-end-hint' : 'hour-band-create-error'}
                className="h-11 w-full"
              />
            </div>
            {/* THE END, COMPUTED, beside the start it follows from: the
                domain places the typed start among the stored bands and says
                where it ends. Nothing here is entered or stored. */}
            <div className="grid gap-2">
              <Label htmlFor="hour-band-new-end">{t('organization.hourBands.end')}</Label>
              <OutputField id="hour-band-new-end" htmlFor="hour-band-new-start">
                <MoveRight aria-hidden />
                {preview === null ? t('organization.hourBands.endPending') : preview.end}
              </OutputField>
            </div>
          </div>
          <p id="hour-band-new-end-hint" className="text-xs text-muted-foreground">
            {t('organization.hourBands.endHint')}
          </p>
          {preview === null ? null : (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="text-muted-foreground">{t('organization.hourBands.duration.label')}</span>
              <span className="font-semibold tabular-nums">
                {t(durationMessageKey(preview.durationMinutes), durationValuesOf(preview.durationMinutes))}
              </span>
              {preview.crossesMidnight ? (
                <Badge variant="outline">{t('organization.hourBands.crossesMidnight')}</Badge>
              ) : null}
            </div>
          )}
        </div>
        {/* THE ADD FORM'S OWN REFUSAL, inside the dialog as the form screens
            hold theirs in their card. The list-read refusal belongs to the page. */}
        {failure === null ? null : (
          <Notice id="hour-band-create-error" role="alert">
            {t(hourBandWriteMessageKey(failure))}
          </Notice>
        )}
        <DialogFooter>
          <Button
            className="h-11"
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => {
              setAdding(false);
            }}
          >
            {t('organization.hourBands.cancel')}
          </Button>
          <Button className="h-11" type="submit" disabled={pending} aria-busy={pending}>
            {t('organization.hourBands.add')}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}
