import { Fragment, type FormEvent, type ReactNode, type SyntheticEvent } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Notice } from '@/components/ui/notice';
import { t } from '@/lib/i18n';
import type { OrganizationSettings } from '@/features/organization/hooks/use-organization-settings';
import type { OrganizationDialog } from '@/features/organization/utils/dialogs';
import {
  ORGANIZATION_DIALOG_ERROR_ID,
  ORGANIZATION_DIALOG_HEADING_IDS,
  ORGANIZATION_DIALOG_SAVE_ID,
} from '@/features/organization/utils/element-ids';
import { organizationMessageKey } from '@/features/organization/utils/messages';

/** One fact: its label above its value, so nothing breaks on a phone. */
export function OrganizationFact({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <div className="grid min-w-0 gap-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-words text-sm font-medium">{children}</dd>
    </div>
  );
}

/**
 * One of the settings page's five dialogs (story 7.18), on the member page's
 * terms (7.11): MOUNTED ALWAYS and driven by `open`, so every way it closes —
 * ✕, the backdrop, Escape and a landed save — goes through the hook's state
 * and the element's own `close()`, and the browser returns focus to the button
 * that opened it. Escape is routed through that state too, never left to
 * close the element behind it. Not dismissible while its write is in flight.
 *
 * THE BODY IS DRAWN ONLY WHILE OPEN AND KEYED TO THE OPENING, so each opening
 * starts from the row as it is now and a choice held in the body's own state
 * never outlives it, while a refetch during one leaves what was entered alone.
 */
export function OrganizationChangeDialog({
  settings,
  dialog,
  title,
  description,
  children,
}: {
  readonly settings: OrganizationSettings;
  readonly dialog: OrganizationDialog;
  readonly title: string;
  readonly description?: string;
  /** The body: a component that draws its form through {@link OrganizationDialogForm}. */
  readonly children: ReactNode;
}): ReactNode {
  const { opening, organization, pending, close } = settings;
  const shown = opening !== null && opening.dialog === dialog && organization !== null;
  const headingId = ORGANIZATION_DIALOG_HEADING_IDS[dialog];

  return (
    <Dialog
      open={shown}
      dismissible={!pending}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      // ESCAPE closes through the screen's state, never while a save is in flight.
      onCancel={(event: SyntheticEvent<HTMLDialogElement>) => {
        event.preventDefault();
        if (!pending) close();
      }}
      aria-labelledby={headingId}
    >
      {!shown ? null : (
        <>
          <DialogHeader closeLabel={t('organization.close')} onClose={close}>
            <DialogTitle id={headingId}>{title}</DialogTitle>
            {description === undefined ? null : <DialogDescription>{description}</DialogDescription>}
          </DialogHeader>
          <Fragment key={opening.key}>{children}</Fragment>
        </>
      )}
    </Dialog>
  );
}

/**
 * A dialog's form: its fields, the refusal above the buttons, and the one
 * Spremi beside Odustani. `canSave` is false while there is nothing to send —
 * no file picked beside `Odaberi sliku`, or no accent chosen, which the
 * accent's body says in words.
 */
export function OrganizationDialogForm({
  settings,
  onSubmit,
  canSave = true,
  children,
}: {
  readonly settings: OrganizationSettings;
  readonly onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  readonly canSave?: boolean;
  readonly children: ReactNode;
}): ReactNode {
  const { pending, failure, close } = settings;

  return (
    <form
      method="post"
      noValidate
      onSubmit={(event) => {
        void onSubmit(event);
      }}
      className="grid gap-5"
    >
      {children}
      {/* `role="alert"`, above the buttons, and never `destructive`: a
          refused save is not an unresolved conflict (UX-DR4). */}
      {failure === null ? null : (
        <Notice id={ORGANIZATION_DIALOG_ERROR_ID} role="alert">
          {t(organizationMessageKey(failure))}
        </Notice>
      )}
      <DialogFooter>
        <Button className="h-11" type="button" variant="outline" disabled={pending} onClick={close}>
          {t('organization.cancel')}
        </Button>
        <Button
          id={ORGANIZATION_DIALOG_SAVE_ID}
          className="h-11"
          type="submit"
          disabled={pending || !canSave}
          aria-busy={pending}
        >
          {t('organization.save')}
        </Button>
      </DialogFooter>
    </form>
  );
}
