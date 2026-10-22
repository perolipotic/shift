import { Archive } from 'lucide-react';
import type { ReactNode } from 'react';

import { OfflineWriteNote } from '@/components/offline-write-note';
import { Button } from '@/components/ui/button';
import { DialogFooter } from '@/components/ui/dialog';
import { Notice } from '@/components/ui/notice';
import type { TeamEditScreen } from '@/features/teams/hooks/use-team-edit';
import type { TeamRow } from '@/features/teams/services/list';
import { ARCHIVE_BUSY, teamWriteMessageKey, type TeamWriteFailure } from '@/features/teams/services/write';
import { t } from '@/lib/i18n';
import { useWriteGate } from '@/lib/offline/use-write-gate';

// ARCHIVING IS ONE-WAY and takes ONE CONFIRMATION naming the team, in neutral
// styling: it removes nothing, so it is not dressed as a destructive action.

/** A refused archive, announced inside the archive block, marking no field invalid. */
export function TeamArchiveRefusal({
  archiveFailure,
}: {
  readonly archiveFailure: TeamWriteFailure | null;
}): ReactNode {
  return archiveFailure === null ? null : (
    <Notice role="alert">
      {t(teamWriteMessageKey(archiveFailure))}
    </Notice>
  );
}

/** The archive offer, beside Save in the dialog's footer. */
export function TeamArchive({
  screen,
  team,
}: {
  readonly screen: TeamEditScreen;
  readonly team: TeamRow;
}): ReactNode {
  const { pending, setArchiveFailure, setSaved, setArmed } = screen;

  return (
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
      {/* A short word, and the whole name for assistive technology, which
          begins with the visible word (WCAG 2.5.3). */}
      <span aria-hidden>{t('smjene.archiveShort')}</span>
      <span className="sr-only">{t('smjene.archive', { name: team.name })}</span>
    </Button>
  );
}

/**
 * THE CONFIRMATION, in place of the form inside the same dialog: one question
 * naming the team, and the two answers side by side. It stays mounted and
 * disabled while the archive is outstanding.
 */
export function TeamArchiveConfirm({
  screen,
  team,
}: {
  readonly screen: TeamEditScreen;
  readonly team: TeamRow;
}): ReactNode {
  const { stage, setArmed, archive, archiveConfirm } = screen;
  const busy = stage === ARCHIVE_BUSY;
  // STORY 8.3b: offline, the archive is gated and the note says why.
  const gate = useWriteGate();

  return (
    <div className="grid gap-5">
      <p className="text-sm font-medium">{t('smjene.archivePrompt', { name: team.name })}</p>
      <OfflineWriteNote gate={gate} />
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
          {t('smjene.archiveCancel')}
        </Button>
        <Button
          ref={archiveConfirm}
          className="h-11 aria-disabled:opacity-50"
          type="button"
          disabled={busy}
          aria-disabled={gate.disabled}
          aria-describedby={gate.describedBy()}
          aria-busy={busy}
          onClick={() => {
            if (!gate.online) return;
            void archive(team);
          }}
        >
          <Archive aria-hidden />
          {t('smjene.archiveConfirm', { name: team.name })}
        </Button>
      </DialogFooter>
    </div>
  );
}
