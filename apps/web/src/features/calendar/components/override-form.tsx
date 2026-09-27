import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { ConfirmDialog, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { Select } from '@/components/ui/select';
import type { OverrideFormState } from '@/features/calendar/hooks/use-override-form';
import { overrideWriteMessageKey } from '@/features/calendar/services/override-write';
import { OVERRIDE_REASON_MAX, OVERRIDE_REFUSED_REASON, type DayDetail } from '@/features/calendar/utils/day-detail';
import {
  OVERRIDE_REASON_FIELD_ID,
  OVERRIDE_REMOVE_ERROR_ID,
  OVERRIDE_REMOVE_PROMPT_ID,
  OVERRIDE_SET_ERROR_ID,
  OVERRIDE_SET_HEADING_ID,
  OVERRIDE_TYPE_FIELD_ID,
} from '@/features/calendar/utils/element-ids';
import { t } from '@/lib/i18n';

/**
 * SETTING AN OVERRIDE (story 3.5b), inside the day detail and for an admin
 * alone: the type, a native `Select` of the types the day may take, and the
 * reason. Both fields are uncontrolled, so a refused save keeps them; the
 * refusal is the form's own `Notice`, inside the Dialog. Neutral: never
 * `destructive` and never the accent.
 */
export function OverrideSetForm({ form }: { readonly form: OverrideFormState }): ReactNode {
  const { typeField, reasonField, pending, failure, options, submit } = form;
  const reasonRefused = failure === OVERRIDE_REFUSED_REASON;
  const typeRefused = failure !== null && !reasonRefused;

  return (
    <section aria-labelledby={OVERRIDE_SET_HEADING_ID} className="grid gap-3">
      <h3 id={OVERRIDE_SET_HEADING_ID} className="font-heading text-base font-semibold">
        {t('kalendar.detail.override.set.heading')}
      </h3>
      <form
        method="post"
        noValidate
        onSubmit={(event) => {
          void submit(event);
        }}
        className="grid gap-4"
      >
        <div className="grid gap-2">
          <Label htmlFor={OVERRIDE_TYPE_FIELD_ID}>{t('kalendar.detail.override.set.type')}</Label>
          <Select
            ref={typeField}
            id={OVERRIDE_TYPE_FIELD_ID}
            name="type"
            defaultValue={options[0]?.id}
            disabled={pending}
            aria-invalid={typeRefused}
            aria-describedby={typeRefused ? OVERRIDE_SET_ERROR_ID : undefined}
            className="h-11"
          >
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor={OVERRIDE_REASON_FIELD_ID}>{t('kalendar.detail.override.set.reason')}</Label>
          <Input
            ref={reasonField}
            id={OVERRIDE_REASON_FIELD_ID}
            name="reason"
            type="text"
            required
            maxLength={OVERRIDE_REASON_MAX}
            autoComplete="off"
            readOnly={pending}
            aria-invalid={reasonRefused}
            aria-describedby={reasonRefused ? OVERRIDE_SET_ERROR_ID : undefined}
            className="h-11 w-full"
          />
        </div>
        {failure === null ? null : (
          <Notice id={OVERRIDE_SET_ERROR_ID} role="alert">
            {t(overrideWriteMessageKey(failure))}
          </Notice>
        )}
        <DialogFooter>
          <Button className="h-11" type="submit" disabled={pending} aria-busy={pending}>
            {pending ? t('kalendar.detail.override.set.saving') : t('kalendar.detail.override.set.save')}
          </Button>
        </DialogFooter>
      </form>
    </section>
  );
}

/** The admin's way to remove the day's override: it opens the confirmation. */
export function OverrideRemoveAction({ form }: { readonly form: OverrideFormState }): ReactNode {
  const { removeAction, pending, openRemove } = form;

  return (
    <DialogFooter>
      <Button
        ref={removeAction}
        className="h-11"
        type="button"
        variant="outline"
        disabled={pending}
        onClick={openRemove}
      >
        {t('kalendar.detail.override.remove.action')}
      </Button>
    </DialogFooter>
  );
}

/**
 * A removal refused once its confirmation has closed (`gone`: the override
 * was removed meanwhile), said in the day detail itself.
 */
export function OverrideRemoveRefusal({ form }: { readonly form: OverrideFormState }): ReactNode {
  const { confirming, removeFailure } = form;

  if (confirming || removeFailure === null) return null;

  return (
    <Notice id={OVERRIDE_REMOVE_ERROR_ID} role="alert">
      {t(overrideWriteMessageKey(removeFailure))}
    </Notice>
  );
}

/**
 * REMOVING AN OVERRIDE (story 3.5b): one neutral modal confirmation that
 * names what is removed — the team and the date — and what is restored, the
 * type the rotation projects. Rendered BESIDE the day detail, never inside
 * it, so its Escape and `close` reach the detail through no React ancestor.
 * While the removal is in flight nothing dismisses it.
 */
export function OverrideRemoveConfirm({
  form,
  detail,
}: {
  readonly form: OverrideFormState;
  readonly detail: DayDetail | null;
}): ReactNode {
  const { confirming, pending, removeFailure, removeCancel, cancelRemove, remove } = form;
  const override = detail?.override ?? null;

  if (!confirming || detail === null || override === null) return null;

  return (
    <ConfirmDialog busy={pending} onCancel={cancelRemove} aria-labelledby={OVERRIDE_REMOVE_PROMPT_ID}>
      <p id={OVERRIDE_REMOVE_PROMPT_ID} className="text-sm font-medium">
        {t('kalendar.detail.override.remove.prompt', {
          team: detail.teamName,
          date: detail.date,
          type: override.projectedTypeName,
        })}
      </p>
      {removeFailure === null ? null : (
        <Notice id={OVERRIDE_REMOVE_ERROR_ID} role="alert">
          {t(overrideWriteMessageKey(removeFailure))}
        </Notice>
      )}
      <DialogFooter>
        <Button
          ref={removeCancel}
          className="h-11"
          type="button"
          variant="outline"
          disabled={pending}
          onClick={cancelRemove}
        >
          {t('kalendar.detail.override.remove.cancel')}
        </Button>
        <Button
          className="h-11"
          type="button"
          disabled={pending}
          aria-busy={pending}
          onClick={() => {
            void remove();
          }}
        >
          {pending ? t('kalendar.detail.override.remove.removing') : t('kalendar.detail.override.remove.confirm')}
        </Button>
      </DialogFooter>
    </ConfirmDialog>
  );
}
