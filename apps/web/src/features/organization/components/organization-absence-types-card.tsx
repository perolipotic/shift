import { Fragment, useState, type ReactNode, type SyntheticEvent } from 'react';

import { OfflineWriteNote } from '@/components/offline-write-note';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { RadioGroup, RadioRow } from '@/components/ui/radio-group';
import { t } from '@/lib/i18n';
import { useWriteGate } from '@/lib/offline/use-write-gate';
import { absenceTypeDrawsMessageKey, absenceTypesMessageKey, type AbsenceTypeRow } from '@/features/absence-types/services/list';
import {
  ABSENCE_TYPE_DRAWS_FIELD,
  ABSENCE_TYPE_NAME_FIELD,
  DRAWS_OPTIONS,
  absenceTypeSavedMessageKey,
  absenceTypeWriteMessageKey,
  drawsHintShown,
  drawsLocked,
  drawsValue,
  initialDrawsChoice,
  marksAbsenceTypeField,
} from '@/features/absence-types/services/write';
import type { OrganizationAbsenceTypes } from '@/features/organization/hooks/use-organization-absence-types';
import {
  ORGANIZATION_ABSENCE_TYPES_HEADING_ID,
  ORGANIZATION_ABSENCE_TYPE_ANNUAL_HINT_ID,
  ORGANIZATION_ABSENCE_TYPE_ANNUAL_REFUSED_DESCRIPTION,
  ORGANIZATION_ABSENCE_TYPE_DRAWS_HINT_ID,
  ORGANIZATION_ABSENCE_TYPE_DIALOG_HEADING_ID,
  ORGANIZATION_ABSENCE_TYPE_DRAWS_FIELD_ID,
  ORGANIZATION_ABSENCE_TYPE_DRAWS_LABEL_ID,
  ORGANIZATION_ABSENCE_TYPE_ERROR_ID,
  ORGANIZATION_ABSENCE_TYPE_NAME_FIELD_ID,
  ORGANIZATION_ABSENCE_TYPE_SAVE_ID,
} from '@/features/organization/utils/element-ids';
import { NAME_MAX_LENGTH } from '@/utils/name';
import { NO_TEXT } from '@/utils/text';

/**
 * *Vrste odsutnosti* (story 13.1b): the organization's absence types, annual
 * leave first, each with whether it draws down the allowance. `Dodaj` in the
 * header and each row's `Uredi` open one shared dialog: a name and the
 * drawing choice, one Spremi. Nothing deletes a type, and no member sees this
 * card (the page is admin-only, and `0052` gives a member no row).
 *
 * OFFLINE, `Dodaj` and every `Uredi` are gated (story 8.3a): focusable, a
 * press does nothing, and the note says why.
 */
export function OrganizationAbsenceTypesCard({
  absenceTypes,
}: {
  readonly absenceTypes: OrganizationAbsenceTypes;
}): ReactNode {
  const { types, refusal, loading, saved, open } = absenceTypes;
  const gate = useWriteGate();

  function renderTypes(): ReactNode {
    if (types === null) {
      return loading ? <div aria-hidden className="h-10 w-56 max-w-full animate-pulse rounded-md bg-muted" /> : null;
    }

    return (
      <ul className="grid min-w-0 divide-y divide-border">
        {types.map((type) => (
          <li key={type.id} className="flex min-w-0 flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
            <div className="grid min-w-0 gap-1">
              <span className="break-words text-sm font-medium">{type.name}</span>
              <span className="text-xs text-muted-foreground">{t(absenceTypeDrawsMessageKey(type.drawsAllowance))}</span>
            </div>
            <Button
              className="h-11 aria-disabled:opacity-50"
              type="button"
              variant="outline"
              aria-label={t('organization.absenceTypes.editLabel', { name: type.name })}
              aria-disabled={gate.disabled}
              aria-describedby={gate.describedBy()}
              onClick={() => {
                if (!gate.online) return;
                open(type);
              }}
            >
              {t('organization.absenceTypes.edit')}
            </Button>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <>
      <Card role="region" aria-labelledby={ORGANIZATION_ABSENCE_TYPES_HEADING_ID} className="w-full min-w-0 max-w-2xl">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
          <CardTitle asChild>
            <h2 id={ORGANIZATION_ABSENCE_TYPES_HEADING_ID} tabIndex={-1}>
              {t('organization.absenceTypes.heading')}
            </h2>
          </CardTitle>
          {types === null ? null : (
            <Button
              className="h-11 aria-disabled:opacity-50"
              type="button"
              variant="outline"
              aria-label={t('organization.absenceTypes.addLabel')}
              aria-disabled={gate.disabled}
              aria-describedby={gate.describedBy()}
              onClick={() => {
                if (!gate.online) return;
                open(null);
              }}
            >
              {t('organization.absenceTypes.add')}
            </Button>
          )}
        </CardHeader>
        <CardContent className="grid gap-4">
          {refusal === null ? null : <Notice role="alert">{t(absenceTypesMessageKey(refusal))}</Notice>}
          {saved === null ? null : <Notice role="status">{t(absenceTypeSavedMessageKey(saved))}</Notice>}
          {types === null ? null : <OfflineWriteNote gate={gate} />}
          {renderTypes()}
        </CardContent>
      </Card>
      <AbsenceTypeDialog absenceTypes={absenceTypes} />
    </>
  );
}

/**
 * The one dialog, for adding and editing: MOUNTED ALWAYS and driven by the
 * hook's opening, its body drawn only while open and keyed to the opening, as
 * the settings dialogs are — so each opening starts from the type as it is
 * now, and no field is mounted on the page while it is closed. Not
 * dismissible while its write is in flight.
 */
function AbsenceTypeDialog({ absenceTypes }: { readonly absenceTypes: OrganizationAbsenceTypes }): ReactNode {
  const { opening, pending, close } = absenceTypes;
  const shown = opening !== null;

  return (
    <Dialog
      open={shown}
      dismissible={!pending}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      // ESCAPE closes through the hook's state, never while a save is in flight.
      onCancel={(event: SyntheticEvent<HTMLDialogElement>) => {
        event.preventDefault();
        if (!pending) close();
      }}
      aria-labelledby={ORGANIZATION_ABSENCE_TYPE_DIALOG_HEADING_ID}
    >
      {opening === null ? null : (
        <>
          <DialogHeader closeLabel={t('organization.absenceTypes.close')} onClose={close}>
            <DialogTitle id={ORGANIZATION_ABSENCE_TYPE_DIALOG_HEADING_ID}>
              {opening.type === null
                ? t('organization.absenceTypes.addHeading')
                : t('organization.absenceTypes.editHeading')}
            </DialogTitle>
          </DialogHeader>
          <Fragment key={opening.key}>
            <AbsenceTypeForm absenceTypes={absenceTypes} type={opening.type} />
          </Fragment>
        </>
      )}
    </Dialog>
  );
}

/** The name, the two drawing choices (locked on annual leave), the refusal and one Spremi. */
function AbsenceTypeForm({
  absenceTypes,
  type,
}: {
  readonly absenceTypes: OrganizationAbsenceTypes;
  readonly type: AbsenceTypeRow | null;
}): ReactNode {
  const { pending, failure, close, save } = absenceTypes;
  const [chosen, setChosen] = useState<string>(initialDrawsChoice(type));
  const locked = drawsLocked(type);
  // STORY 8.3b: offline, Spremi is gated and the note says why.
  const gate = useWriteGate();
  // Annual leave's locked choice is described by its hint, and by the
  // refusal after one; the other choices by the refusal only.
  // STORY 13.2b (Q8): editing any other type, a static line says what changing its flag does.
  const hinted = drawsHintShown(type);
  const refusedDescription = locked
    ? ORGANIZATION_ABSENCE_TYPE_ANNUAL_REFUSED_DESCRIPTION
    : hinted
      ? `${ORGANIZATION_ABSENCE_TYPE_DRAWS_HINT_ID} ${ORGANIZATION_ABSENCE_TYPE_ERROR_ID}`
      : ORGANIZATION_ABSENCE_TYPE_ERROR_ID;
  const quietDescription = locked
    ? ORGANIZATION_ABSENCE_TYPE_ANNUAL_HINT_ID
    : hinted
      ? ORGANIZATION_ABSENCE_TYPE_DRAWS_HINT_ID
      : undefined;
  const drawsDescription = failure === null ? quietDescription : refusedDescription;

  return (
    <form
      method="post"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        // STORY 8.3b: offline, a submit does nothing.
        if (!gate.online) return;

        const field = event.currentTarget.elements.namedItem(ABSENCE_TYPE_NAME_FIELD);

        if (!(field instanceof HTMLInputElement)) return;
        void save(field.value, chosen);
      }}
      className="grid gap-5"
    >
      <div className="grid gap-2">
        <Label htmlFor={ORGANIZATION_ABSENCE_TYPE_NAME_FIELD_ID}>{t('organization.absenceTypes.name')}</Label>
        <Input
          id={ORGANIZATION_ABSENCE_TYPE_NAME_FIELD_ID}
          name={ABSENCE_TYPE_NAME_FIELD}
          type="text"
          maxLength={NAME_MAX_LENGTH}
          required
          autoComplete="off"
          defaultValue={type === null ? NO_TEXT : type.name}
          disabled={pending}
          aria-invalid={marksAbsenceTypeField(failure, ABSENCE_TYPE_NAME_FIELD)}
          aria-describedby={failure === null ? undefined : ORGANIZATION_ABSENCE_TYPE_ERROR_ID}
          className="h-11 w-full"
        />
      </div>
      <div className="grid gap-3">
        <p id={ORGANIZATION_ABSENCE_TYPE_DRAWS_LABEL_ID} className="text-sm font-semibold leading-none">
          {t('organization.absenceTypes.drawsLabel')}
        </p>
        <RadioGroup
          value={chosen}
          onValueChange={setChosen}
          disabled={pending || locked}
          required
          aria-labelledby={ORGANIZATION_ABSENCE_TYPE_DRAWS_LABEL_ID}
          aria-describedby={drawsDescription}
          aria-invalid={marksAbsenceTypeField(failure, ABSENCE_TYPE_DRAWS_FIELD)}
          className="gap-1"
        >
          {DRAWS_OPTIONS.map((option, index) => (
            <RadioRow
              key={drawsValue(option)}
              id={index === 0 ? ORGANIZATION_ABSENCE_TYPE_DRAWS_FIELD_ID : undefined}
              value={drawsValue(option)}
            >
              {t(absenceTypeDrawsMessageKey(option))}
            </RadioRow>
          ))}
        </RadioGroup>
        {locked ? (
          <p id={ORGANIZATION_ABSENCE_TYPE_ANNUAL_HINT_ID} className="text-sm text-muted-foreground">
            {t('organization.absenceTypes.annualHint')}
          </p>
        ) : null}
        {hinted ? (
          <p id={ORGANIZATION_ABSENCE_TYPE_DRAWS_HINT_ID} className="text-sm text-muted-foreground">
            {t('organization.absenceTypes.drawsHint')}
          </p>
        ) : null}
      </div>
      {/* `role="alert"`, above the buttons, and never `destructive`: a
          refused save is not an unresolved conflict (UX-DR4). */}
      {failure === null ? null : (
        <Notice id={ORGANIZATION_ABSENCE_TYPE_ERROR_ID} role="alert">
          {t(absenceTypeWriteMessageKey(failure))}
        </Notice>
      )}
      <OfflineWriteNote gate={gate} />
      <DialogFooter>
        <Button className="h-11" type="button" variant="outline" disabled={pending} onClick={close}>
          {t('organization.absenceTypes.cancel')}
        </Button>
        <Button
          id={ORGANIZATION_ABSENCE_TYPE_SAVE_ID}
          className="h-11 aria-disabled:opacity-50"
          type="submit"
          // NATIVE `disabled` only while the write is out (the 8.3a convention);
          // offline it stays focusable, `aria-disabled`.
          disabled={pending}
          aria-disabled={gate.disabled}
          aria-describedby={gate.describedBy()}
          aria-busy={pending}
        >
          {t('organization.absenceTypes.save')}
        </Button>
      </DialogFooter>
    </form>
  );
}
