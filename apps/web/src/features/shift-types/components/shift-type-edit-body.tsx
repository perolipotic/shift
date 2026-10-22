import type { ReactNode } from 'react';

import { OfflineWriteNote } from '@/components/offline-write-note';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  ShiftTypeArchive,
  ShiftTypeArchiveConfirm,
  ShiftTypeArchiveRefusal,
} from '@/features/shift-types/components/shift-type-archive';
import { ShiftTypeFacts } from '@/features/shift-types/components/shift-type-facts';
import { ShiftTypeTimes, ShiftTypeTimesRefusal } from '@/features/shift-types/components/shift-type-times';
import type { ShiftTypeEditScreen } from '@/features/shift-types/hooks/use-shift-type-edit';
import type { ShiftTypeRow } from '@/features/shift-types/services/list';
import { SHIFT_TYPE_NAME_FIELD, marksField, shiftTypeFormKey } from '@/features/shift-types/services/write';
import { t } from '@/lib/i18n';
import { useWriteGate, type WriteGate } from '@/lib/offline/use-write-gate';
import { NAME_MAX_LENGTH } from '@/utils/name';

function renderType(screen: ShiftTypeEditScreen, type: ShiftTypeRow, gate: WriteGate): ReactNode {
  const { row, timesFailure, archiveFailure, confirming, saves, submit, nameField, setSaved, failure, pending } =
    screen;
  const shown = row;

  if (shown === null) return null;

  // AN ARCHIVED TYPE is frozen: its facts and a note, and nothing that writes.
  if (type.archived) {
    return (
      <div className="grid gap-3">
        {/* A refusal set just before the re-read revealed the type as
            archived is still said here, where the blocks it belonged to
            no longer render. */}
        <ShiftTypeTimesRefusal timesFailure={timesFailure} />
        <ShiftTypeArchiveRefusal archiveFailure={archiveFailure} />
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <ShiftTypeFacts shown={shown} />
        </div>
        <p className="text-sm text-muted-foreground">{t('rotation.shiftTypes.archivedNote')}</p>
      </div>
    );
  }

  return (
    <>
      {/* HIDDEN, NOT UNMOUNTED, while the archive is asked about: a
          cancelled archive returns to both forms with what was typed. */}
      <div className={confirming ? 'hidden' : 'grid gap-5'}>
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 rounded-md bg-muted p-3 text-sm">
          <ShiftTypeFacts shown={shown} />
        </div>
        <form
          key={shiftTypeFormKey(type, saves)}
          method="post"
          noValidate
          onSubmit={(event) => {
            if (!gate.online) {
              event.preventDefault();
              return;
            }
            void submit(event, type);
          }}
          className="grid gap-2"
        >
          <Label htmlFor="shift-type-name">{t('rotation.shiftTypes.name')}</Label>
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
            <Input
              ref={nameField}
              id="shift-type-name"
              name="name"
              maxLength={NAME_MAX_LENGTH}
              type="text"
              required
              defaultValue={type.name}
              onChange={() => {
                // A confirmation describes the last save, not what is typed now.
                setSaved(null);
              }}
              aria-invalid={marksField(failure, SHIFT_TYPE_NAME_FIELD)}
              aria-describedby={failure === null ? undefined : 'shift-type-form-error'}
              className="h-11 min-w-0 flex-1"
            />
            <Button
              className="h-11 aria-disabled:opacity-50"
              type="submit"
              variant="outline"
              disabled={pending}
              aria-disabled={gate.disabled}
              aria-describedby={gate.describedBy()}
              aria-busy={pending}
            >
              {t('rotation.shiftTypes.save')}
            </Button>
          </div>
        </form>
        <ShiftTypeTimes screen={screen} type={type} shown={shown} gate={gate} />
        <div className="border-t pt-5">
          <ShiftTypeArchive screen={screen} type={type} />
        </div>
      </div>
      {confirming ? <ShiftTypeArchiveConfirm screen={screen} type={type} gate={gate} /> : null}
      {/* STORY 8.3b: THE DIALOG'S ONE NOTE, at its foot and outside the block
          the archive's confirmation hides, named by every gated control here:
          the rename, the times and their cancel, and the archive's confirm. */}
      <OfflineWriteNote gate={gate} />
    </>
  );
}

/** The dialog's body: the type's facts and its three blocks, or the skeleton while it is read. */
export function ShiftTypeEditBody({ screen }: { readonly screen: ShiftTypeEditScreen }): ReactNode {
  const { form, loading } = screen;
  // STORY 8.3b: one gate for the whole dialog, and one note at its foot.
  const gate = useWriteGate();

  if (form.type !== null) return renderType(screen, form.type, gate);

  return loading ? <div className="h-11 w-full animate-pulse rounded-md bg-muted" /> : null;
}
