import { Archive } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { DialogFooter } from '@/components/ui/dialog';
import { Notice } from '@/components/ui/notice';
import type { ShiftTypeEditScreen } from '@/features/shift-types/hooks/use-shift-type-edit';
import type { ShiftTypeRow } from '@/features/shift-types/services/list';
import {
  ARCHIVE_BUSY,
  SHIFT_TYPE_CHANGE_SCHEDULED,
  archiveOfferedOf,
  shiftTypeWriteMessageKey,
  type ShiftTypeWriteFailure,
} from '@/features/shift-types/services/write';
import { t } from '@/lib/i18n';

/** The archive's refusal, announced inside the archive block. */
export function ShiftTypeArchiveRefusal({
  archiveFailure,
}: {
  readonly archiveFailure: ShiftTypeWriteFailure | null;
}): ReactNode {
  return archiveFailure === null ? null : (
    <Notice role="alert">{t(shiftTypeWriteMessageKey(archiveFailure))}</Notice>
  );
}

/** The archive offer, at the foot of the dialog, or why it is not offered. */
export function ShiftTypeArchive({
  screen,
  type,
}: {
  readonly screen: ShiftTypeEditScreen;
  readonly type: ShiftTypeRow;
}): ReactNode {
  const { today, archiveFailure, pending, setArchiveFailure, setSaved, setArmed } = screen;

  // NOT OFFERED WHILE A CORRECTION IS SCHEDULED: `0013` refuses it, so the
  // screen says what to do instead of arming a write that can only fail.
  if (today !== null && !archiveOfferedOf(type, today)) {
    return (
      <p className="text-sm text-muted-foreground">
        {t(shiftTypeWriteMessageKey(SHIFT_TYPE_CHANGE_SCHEDULED))}
      </p>
    );
  }

  return (
    <div className="grid gap-3">
      <ShiftTypeArchiveRefusal archiveFailure={archiveFailure} />
      <DialogFooter>
        <Button
          className="h-11"
          type="button"
          variant="ghost"
          disabled={pending}
          onClick={() => {
            setArchiveFailure(null);
            setSaved(null);
            setArmed(true);
          }}
        >
          <Archive aria-hidden />
          {/* A short word, and the whole name for assistive technology,
              which begins with the visible word (WCAG 2.5.3). */}
          <span aria-hidden>{t('rotation.shiftTypes.archiveShort')}</span>
          <span className="sr-only">{t('rotation.shiftTypes.archive', { name: type.name })}</span>
        </Button>
      </DialogFooter>
    </div>
  );
}

/**
 * THE CONFIRMATION, in place of everything else inside the same dialog: one
 * question naming the type, and the two answers side by side. It stays
 * mounted and disabled while the archive is outstanding.
 */
export function ShiftTypeArchiveConfirm({
  screen,
  type,
}: {
  readonly screen: ShiftTypeEditScreen;
  readonly type: ShiftTypeRow;
}): ReactNode {
  const { stage, setArmed, archive } = screen;
  const busy = stage === ARCHIVE_BUSY;

  return (
    <div className="grid gap-5">
      <p className="text-sm font-medium">
        {t('rotation.shiftTypes.archivePrompt', { name: type.name })}
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
          <span className="truncate">{t('rotation.shiftTypes.archiveCancel')}</span>
        </Button>
        <Button
          className="h-11"
          type="button"
          disabled={busy}
          aria-busy={busy}
          onClick={() => {
            void archive(type);
          }}
        >
          <Archive aria-hidden />
          <span className="truncate">
            {t('rotation.shiftTypes.archiveConfirm', { name: type.name })}
          </span>
        </Button>
      </DialogFooter>
    </div>
  );
}
