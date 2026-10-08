import { useEffect, type ReactNode, type SyntheticEvent } from 'react';

import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { Select } from '@/components/ui/select';
import { ChangeContextDescription, ChangePreviewOutput } from '@/features/calendar/components/change-preview-output';
import type { OverrideFormState } from '@/features/calendar/hooks/use-override-form';
import {
  OVERRIDE_REMOVED,
  overrideDoneMessageKey,
  overrideWriteMessageKey,
} from '@/features/calendar/services/override-write';
import {
  OVERRIDE_NO_TYPE,
  OVERRIDE_REASON_MAX,
  OVERRIDE_REFUSED_REASON,
  overrideRemovalTargetOf,
  type DayDetail,
} from '@/features/calendar/utils/day-detail';
import {
  OVERRIDE_ERASURES_ID,
  OVERRIDE_PREVIEW_ID,
  OVERRIDE_REASON_FIELD_ID,
  OVERRIDE_REMOVE_ERROR_ID,
  OVERRIDE_REMOVE_PROMPT_ID,
  OVERRIDE_SET_ERROR_ID,
  OVERRIDE_SET_HEADING_ID,
  OVERRIDE_TYPE_FIELD_ID,
  OVERRIDE_UNCHECKED_ID,
  describedByOf,
} from '@/features/calendar/utils/element-ids';
import type { CalendarSnapshot } from '@/features/calendar/services/snapshot';
import { ErasureDialog } from '@/features/conflicts/components/erasure-dialog';
import type { ErasureRow } from '@/features/conflicts/services/erasures';
import { OVERRIDE_CHANGE_REMOVE, OVERRIDE_CHANGE_SET } from '@/features/conflicts/services/override-erasures';
import { t } from '@/lib/i18n';

/**
 * SETTING AN OVERRIDE (story 3.5b) — its own dialog since story 7.9 — for an
 * admin alone: a native `Select` of the types the day may take, the reason,
 * and *Što se mijenja* for the type chosen. Both fields are uncontrolled, so a
 * refused save keeps them; the refusal is the form's own `Notice`. One save,
 * and a cancel that closes the dialog. Neutral: never `destructive` and never
 * the accent.
 */
export function OverrideSetForm({
  form,
  busy,
  snapshot,
}: {
  readonly form: OverrideFormState;
  /** The roster form's write is in flight (story 3.6b): nothing here may start one. */
  readonly busy: boolean;
  readonly snapshot: CalendarSnapshot | null;
}): ReactNode {
  const {
    typeField,
    reasonField,
    pending,
    failure,
    options,
    submit,
    saveButton,
    unchecked,
    clearUnchecked,
    chooseType,
    preview,
    closeChange,
  } = form;
  const reasonRefused = failure === OVERRIDE_REFUSED_REASON;
  const typeRefused = failure !== null && !reasonRefused;

  // STORY 7.9: every mount starts the preview from what the `Select` shows,
  // and an unmounted form chooses nothing, so the preview never outlives it.
  useEffect(() => {
    chooseType(typeField.current?.value ?? OVERRIDE_NO_TYPE);

    return () => {
      chooseType(OVERRIDE_NO_TYPE);
    };
  }, [chooseType, typeField]);

  return (
    <form
      method="post"
      noValidate
      onSubmit={(event) => {
        void submit(event);
      }}
      // STORY 5.5f: a field changed, so the refusal to check what was entered before no longer stands.
      onChange={clearUnchecked}
      className="grid gap-4"
    >
      <div className="grid gap-2">
        <Label htmlFor={OVERRIDE_TYPE_FIELD_ID}>{t('kalendar.detail.override.set.type')}</Label>
        <Select
          ref={typeField}
          id={OVERRIDE_TYPE_FIELD_ID}
          name="type"
          // STORY 7.9: nothing is chosen until the admin chooses, so *Što se mijenja* says nothing yet.
          defaultValue={OVERRIDE_NO_TYPE}
          disabled={pending}
          aria-invalid={typeRefused}
          aria-describedby={typeRefused ? OVERRIDE_SET_ERROR_ID : undefined}
          className="h-11"
          onChange={(event) => {
            chooseType(event.target.value);
          }}
        >
          <option value={OVERRIDE_NO_TYPE}>{t('kalendar.detail.override.set.choose')}</option>
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
      <ChangePreviewOutput id={OVERRIDE_PREVIEW_ID} preview={preview} snapshot={snapshot} />
      {failure === null ? null : (
        <Notice id={OVERRIDE_SET_ERROR_ID} role="alert">
          {t(overrideWriteMessageKey(failure))}
        </Notice>
      )}
      {/* STORY 5.5f: a set that could not check what it would erase saved nothing. */}
      {unchecked === OVERRIDE_CHANGE_SET ? <OverrideUnchecked form={form} busy={busy} /> : null}
      <DialogFooter>
        <Button className="h-11" type="button" variant="outline" disabled={pending} onClick={closeChange}>
          {t('kalendar.detail.override.set.cancel')}
        </Button>
        <Button
          ref={saveButton}
          className="h-11"
          type="submit"
          disabled={pending || busy}
          aria-busy={pending}
          aria-describedby={describedByOf(preview === null ? null : OVERRIDE_PREVIEW_ID)}
        >
          {pending ? t('kalendar.detail.override.set.saving') : t('kalendar.detail.override.set.save')}
        </Button>
      </DialogFooter>
    </form>
  );
}

/**
 * "PROMIJENI TIP SMJENE" (story 7.9): the override form in its own small
 * dialog, opened from the day detail's footer and rendered BESIDE it. Its
 * title names the change, its description the team, the date and the type
 * the day works now. Not dismissible while a write is in flight; a save that
 * landed closes it, and its notice is the day detail's. The form is drawn
 * only while it is open, so each opening starts from the day as it is.
 */
export function OverrideChangeDialog({
  form,
  detail,
  snapshot,
  busy,
}: {
  readonly form: OverrideFormState;
  readonly detail: DayDetail | null;
  readonly snapshot: CalendarSnapshot | null;
  /** The roster form's write is in flight (story 3.6b). */
  readonly busy: boolean;
}): ReactNode {
  const { changing, pending, closeChange } = form;

  return (
    <Dialog
      open={changing && detail !== null}
      dismissible={!pending}
      onOpenChange={(next) => {
        if (!next) closeChange();
      }}
      // ESCAPE, AS THE DAY DETAIL'S: the cancel is refused here, and the
      // dialog closes through the screen's state, never while a write is in flight.
      onCancel={(event: SyntheticEvent<HTMLDialogElement>) => {
        event.preventDefault();
        if (!pending) closeChange();
      }}
      aria-labelledby={OVERRIDE_SET_HEADING_ID}
    >
      {!changing || detail === null ? null : (
        <>
          <DialogHeader
            closeLabel={t('kalendar.detail.override.set.close')}
            onClose={() => {
              if (!pending) closeChange();
            }}
          >
            <DialogTitle id={OVERRIDE_SET_HEADING_ID}>{t('kalendar.detail.override.set.heading')}</DialogTitle>
            <ChangeContextDescription detail={detail} />
          </DialogHeader>
          <OverrideSetForm key={`${detail.teamId}:${detail.isoDate}`} form={form} busy={busy} snapshot={snapshot} />
        </>
      )}
    </Dialog>
  );
}

/** The admin's way to remove the day's override: it opens the confirmation. */
export function OverrideRemoveAction({
  form,
  busy,
}: {
  readonly form: OverrideFormState;
  /** The roster form's write is in flight (story 3.6b). */
  readonly busy: boolean;
}): ReactNode {
  const { removeAction, pending, openRemove } = form;

  return (
    <div>
      <Button
        ref={removeAction}
        className="h-11"
        type="button"
        variant="outline"
        disabled={pending || busy}
        onClick={openRemove}
      >
        {t('kalendar.detail.override.remove.action')}
      </Button>
    </div>
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
 * A set refused once the form has given way (story 5.5f): `taken` re-reads
 * the day, and the override that landed first replaces the form — and its
 * Notice with it — so the refusal is said in the day detail itself, in the
 * same words.
 */
export function OverrideSetRefusal({ form }: { readonly form: OverrideFormState }): ReactNode {
  const { offersSet, failure } = form;

  if (offersSet || failure === null) return null;

  return (
    <Notice id={OVERRIDE_SET_ERROR_ID} role="alert">
      {t(overrideWriteMessageKey(failure))}
    </Notice>
  );
}

/**
 * A write that could not check what it would erase (story 5.5f), so it wrote
 * nothing: said with a retry, which asks the same write again.
 */
function OverrideUnchecked({ form, busy }: { readonly form: OverrideFormState; readonly busy: boolean }): ReactNode {
  const { pending, retryButton, retry } = form;

  return (
    <Notice id={OVERRIDE_UNCHECKED_ID} role="alert">
      {t('kalendar.detail.override.erasures.unavailable')}
      <Button
        ref={retryButton}
        className="mt-3 flex h-11"
        type="button"
        variant="outline"
        disabled={pending || busy}
        onClick={retry}
      >
        {t('kalendar.detail.override.erasures.retry')}
      </Button>
    </Notice>
  );
}

/**
 * A write that landed (story 3.5b), said in the day detail as a
 * `role="status"` Notice: the save, or the removal and the type it restored
 * — and, since story 5.5f, how many conflicts it removed, as confirmed in its
 * erasure confirmation.
 */
export function OverrideDoneNotice({ form }: { readonly form: OverrideFormState }): ReactNode {
  const { done, erased } = form;

  if (done === null) return null;

  return (
    <Notice role="status">
      <span className="block">
        {done.code === OVERRIDE_REMOVED && done.projectedTypeName !== null
          ? t(overrideDoneMessageKey(done), { type: done.projectedTypeName })
          : t(overrideDoneMessageKey(done))}
      </span>
      {erased === 0 ? null : (
        <span className="mt-2 block">{t('kalendar.detail.override.erasures.removed', { count: erased })}</span>
      )}
    </Notice>
  );
}

/**
 * REMOVING AN OVERRIDE (story 3.5b): one neutral modal confirmation that
 * names what is removed — the team and the date — and what is restored, the
 * type the rotation projects. Rendered BESIDE the day detail, never inside
 * it, so its Escape and `close` reach the detail through no React ancestor.
 * While the removal is in flight nothing dismisses it. An override pending
 * review (story 3.5c) is removed through the same confirmation; on a day with
 * no rotation it names no type restored.
 */
export function OverrideRemoveConfirm({
  form,
  detail,
  busy,
}: {
  readonly form: OverrideFormState;
  readonly detail: DayDetail | null;
  /** The roster form's write is in flight (story 3.6b). */
  readonly busy: boolean;
}): ReactNode {
  const { confirming, pending, removeFailure, removeCancel, cancelRemove, remove } = form;
  const override = overrideRemovalTargetOf(detail);

  if (!confirming || detail === null || override === null) return null;

  return (
    <ConfirmDialog busy={pending} onCancel={cancelRemove} aria-labelledby={OVERRIDE_REMOVE_PROMPT_ID}>
      <p id={OVERRIDE_REMOVE_PROMPT_ID} className="text-sm font-medium">
        {override.projectedTypeName === null
          ? t('kalendar.detail.override.pending.removePrompt', { team: detail.teamName, date: detail.date })
          : t('kalendar.detail.override.remove.prompt', {
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
      {/* STORY 5.5f: a removal that could not check what it would erase removed nothing. */}
      {form.unchecked === OVERRIDE_CHANGE_REMOVE ? <OverrideUnchecked form={form} busy={busy} /> : null}
      <DialogFooter>
        <Button
          ref={removeCancel}
          className="h-11"
          type="button"
          variant="outline"
          disabled={pending || busy}
          onClick={cancelRemove}
        >
          {t('kalendar.detail.override.remove.cancel')}
        </Button>
        <Button
          className="h-11"
          type="button"
          disabled={pending || busy}
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

/**
 * A SHIFT-TYPE OVERRIDE'S ERASURE CONFIRMATION (story 5.5f): the shared
 * `ErasureDialog` in the calendar's words, rendered BESIDE the day detail as
 * the removal's confirmation is. One row per conflict the write would erase
 * — "{member} na godišnjem · nakon promjene: {team} taj dan slobodna" — and
 * its own save: "Spremi izmjenu" for a set, "Ukloni" for a removal,
 * `aria-disabled` until every row is confirmed. A removal's lede and kept
 * hint say so in its own words. "Natrag na uređivanje" returns to the form
 * with its inputs kept, or to the day detail. Its rows scroll inside it.
 */
export function OverrideErasureConfirm({
  form,
  busy,
}: {
  readonly form: OverrideFormState;
  /** The roster form's write is in flight (story 3.6b). */
  readonly busy: boolean;
}): ReactNode {
  const { erasures, pending, confirmOverrideErasures } = form;
  const shown = erasures.shown;

  if (shown === null) return null;

  const { rows } = shown;
  const removal = shown.subject.kind === OVERRIDE_CHANGE_REMOVE;
  const partsOf = (row: ErasureRow) => ({
    team: row.teamName,
    weekday: row.weekday,
    date: row.dayMonth,
    type: row.shiftTypeName,
  });

  return (
    <ErasureDialog
      id={OVERRIDE_ERASURES_ID}
      rows={rows}
      changed={shown.changed}
      decisions={erasures.decisions}
      busy={pending || busy}
      firstErasure={erasures.firstErasure}
      // A shift-type override can erase the conflict of every member on leave
      // that day, so the rows scroll inside the dialog (as the member page's).
      scrollRows
      copy={{
        title: t('kalendar.detail.override.erasures.title', { count: rows.length }),
        lede: removal
          ? t('kalendar.detail.override.erasures.ledeRemoval', { count: rows.length })
          : t('kalendar.detail.override.erasures.lede', { count: rows.length }),
        changed: t('kalendar.detail.override.erasures.changed'),
        rowTitle: (row) => t('kalendar.detail.override.erasures.rowTitle', partsOf(row)),
        // ALWAYS "TAJ DAN SLOBODNA": a shift-type override never changes who
        // is rostered, so a conflict it erases is one whose team no longer
        // works that day — `teamWorks` is false on every row here.
        rowDetail: (row) =>
          t('kalendar.detail.override.erasures.rowFree', { member: row.memberName, team: row.teamName }),
        decision: (row) => t('kalendar.detail.override.erasures.decision', partsOf(row)),
        confirm: t('kalendar.detail.override.erasures.confirm'),
        keep: t('kalendar.detail.override.erasures.keep'),
        back: t('kalendar.detail.override.erasures.back'),
        kept: removal
          ? t('kalendar.detail.override.erasures.keptRemoval')
          : t('kalendar.detail.override.erasures.kept'),
        save: removal ? t('kalendar.detail.override.remove.confirm') : t('kalendar.detail.override.set.save'),
      }}
      onDecide={erasures.decide}
      onBack={erasures.close}
      onSave={() => {
        void confirmOverrideErasures(shown);
      }}
    />
  );
}
