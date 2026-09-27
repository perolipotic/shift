import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { formatMinuteOfDay } from '@/lib/i18n/format';
import { NO_TEXT } from '@/features/members/services/list';
import type { ShiftTypeEditScreen } from '@/features/shift-types/hooks/use-shift-type-edit';
import type { ShiftTimesShown, ShiftTypeDisplayRow, ShiftTypeRow } from '@/features/shift-types/services/list';
import {
  SHIFT_TYPE_DATE_FIELD,
  SHIFT_TYPE_END_FIELD,
  SHIFT_TYPE_START_FIELD,
  TIMES_CANCEL,
  TIMES_SET,
  marksField,
  shiftTypeWriteMessageKey,
  timesFormKey,
  timesOfferOf,
  type ShiftTypeWriteFailure,
  type TimesOffer,
} from '@/features/shift-types/services/write';
import { t } from '@/lib/i18n';

/** The times block's refusal, where the times were written. */
export function ShiftTypeTimesRefusal({ timesFailure }: {
  readonly timesFailure: ShiftTypeWriteFailure | null;
}): ReactNode {
  return timesFailure === null ? null : (
    <Notice id="shift-type-times-error" role="alert">
      {t(shiftTypeWriteMessageKey(timesFailure))}
    </Notice>
  );
}

/** The times form: from a date, a start and an end. */
function renderTimesForm(
  screen: ShiftTypeEditScreen,
  type: ShiftTypeRow,
  offer: Exclude<TimesOffer, { readonly kind: typeof TIMES_CANCEL }>,
  current: ShiftTimesShown | null,
): ReactNode {
  const { saveTimes, dateField, startField, endField, setSaved, timesFailure, pending } = screen;

  return (
    <form
      key={timesFormKey(type)}
      method="post"
      onSubmit={(event) => {
        void saveTimes(event, type);
      }}
      className="grid gap-4"
    >
      <div className="grid gap-2">
        <Label htmlFor="shift-type-times-date">{t('rotation.shiftTypes.timesFrom')}</Label>
        <Input
          ref={dateField}
          id="shift-type-times-date"
          name="effectiveFrom"
          type="date"
          required
          min={offer.minimum}
          defaultValue={offer.minimum}
          onChange={() => {
            setSaved(null);
          }}
          aria-invalid={marksField(timesFailure, SHIFT_TYPE_DATE_FIELD)}
          aria-describedby={timesFailure === null ? undefined : 'shift-type-times-error'}
          className="h-11"
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid min-w-0 gap-2">
          <Label htmlFor="shift-type-times-start">{t('rotation.shiftTypes.start')}</Label>
          <Input
            ref={startField}
            id="shift-type-times-start"
            name="start"
            type="time"
            required
            defaultValue={current === null ? NO_TEXT : formatMinuteOfDay(current.startMinute)}
            onChange={() => {
              setSaved(null);
            }}
            aria-invalid={marksField(timesFailure, SHIFT_TYPE_START_FIELD)}
            aria-describedby={timesFailure === null ? undefined : 'shift-type-times-error'}
            className="h-11 w-full"
          />
        </div>
        <div className="grid min-w-0 gap-2">
          <Label htmlFor="shift-type-times-end">{t('rotation.shiftTypes.end')}</Label>
          <Input
            ref={endField}
            id="shift-type-times-end"
            name="end"
            type="time"
            required
            defaultValue={current === null ? NO_TEXT : formatMinuteOfDay(current.endMinute)}
            onChange={() => {
              setSaved(null);
            }}
            aria-invalid={marksField(timesFailure, SHIFT_TYPE_END_FIELD)}
            aria-describedby={timesFailure === null ? undefined : 'shift-type-times-error'}
            className="h-11 w-full"
          />
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{t('rotation.shiftTypes.timesNote')}</p>
      <div className="flex justify-end">
        <Button className="h-11" type="submit" disabled={pending} aria-busy={pending}>
          <span className="truncate">
            {offer.kind === TIMES_SET
              ? t('rotation.shiftTypes.timesSet')
              : t('rotation.shiftTypes.timesCorrect')}
          </span>
        </Button>
      </div>
    </form>
  );
}

/** The times block: set or correct from a date, or cancel what is scheduled. */
export function ShiftTypeTimes({
  screen,
  type,
  shown,
}: {
  readonly screen: ShiftTypeEditScreen;
  readonly type: ShiftTypeRow;
  readonly shown: ShiftTypeDisplayRow;
}): ReactNode {
  const { today, timesFailure, pending, cancelTimes } = screen;

  if (today === null) return null;

  const offer = timesOfferOf(type, today);

  if (offer === null) return null;

  return (
    <section className="grid gap-4 border-t pt-5">
      <h3 className="text-base font-bold">{t('rotation.shiftTypes.timesHeading')}</h3>
      <ShiftTypeTimesRefusal timesFailure={timesFailure} />
      {offer.kind === TIMES_CANCEL ? (
        <Button
          className="h-11 w-full"
          type="button"
          variant="outline"
          disabled={pending}
          aria-busy={pending}
          onClick={() => {
            void cancelTimes(type);
          }}
        >
          <span className="truncate">{t('rotation.shiftTypes.cancelScheduled')}</span>
        </Button>
      ) : (
        renderTimesForm(screen, type, offer, shown.times)
      )}
    </section>
  );
}
