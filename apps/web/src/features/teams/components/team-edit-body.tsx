import { Users } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupIcon } from '@/components/ui/input-group';
import { Label } from '@/components/ui/label';
import {
  TeamArchive,
  TeamArchiveConfirm,
  TeamArchiveRefusal,
} from '@/features/teams/components/team-archive';
import type { TeamEditScreen } from '@/features/teams/hooks/use-team-edit';
import type { TeamRow } from '@/features/teams/services/list';
import { teamFormKey } from '@/features/teams/services/write';
import { t } from '@/lib/i18n';

/**
 * The dialog's body: the team's rename form and its archive, an archived
 * team's name and note, or the skeleton while it is read.
 *
 * The two helpers are declared inside the component, at its two-space
 * indentation, so the sign-in suite's scoped extraction reads each one.
 */
export function TeamEditBody({ screen }: { readonly screen: TeamEditScreen }): ReactNode {
  const { form, loading, renames, submit, confirming, nameField, setSaved, failure, archiveFailure, pending } =
    screen;

  /** An archived team: frozen, so its name and a note, and nothing that writes. */
  function renderArchived(team: TeamRow): ReactNode {
    return (
      <div className="grid gap-2">
        <p className="break-words text-base font-medium">{team.name}</p>
        <p className="text-sm text-muted-foreground">{t('smjene.archivedNote')}</p>
      </div>
    );
  }

  function renderTeam(team: TeamRow): ReactNode {
    if (team.archived) return renderArchived(team);

    return (
      <>
        {/* HIDDEN, NOT UNMOUNTED, while the archive is asked about: a
            cancelled archive returns to the form with what was typed. */}
        <form
          key={teamFormKey(team, renames)}
          method="post"
          onSubmit={(event) => {
            void submit(event, team);
          }}
          className={confirming ? 'hidden' : 'grid gap-5'}
        >
          <div className="grid gap-2">
            <Label htmlFor="team-name">{t('smjene.name')}</Label>
            <InputGroup>
              <InputGroupIcon>
                <Users />
              </InputGroupIcon>
              <Input
                ref={nameField}
                id="team-name"
                name="name"
                type="text"
                required
                defaultValue={team.name}
                onChange={() => {
                  // A confirmation describes the last save, not what is typed now.
                  setSaved(null);
                }}
                aria-invalid={failure !== null}
                aria-describedby={failure === null ? undefined : 'team-form-error'}
                className="h-11"
              />
            </InputGroup>
          </div>
          <TeamArchiveRefusal archiveFailure={archiveFailure} />
          {/* THE TWO DECISIONS TOGETHER, at the right: archive, then save.
              Neutral, never `destructive`, which UX-DR4 keeps for conflicts.
              The dialog's close is the way back. */}
          <DialogFooter>
            <TeamArchive screen={screen} team={team} />
            <Button className="h-11" type="submit" disabled={pending} aria-busy={pending}>
              {t('smjene.save')}
            </Button>
          </DialogFooter>
        </form>
        {confirming ? <TeamArchiveConfirm screen={screen} team={team} /> : null}
      </>
    );
  }

  if (form.team !== null) return renderTeam(form.team);

  return loading ? <div className="h-11 w-full animate-pulse rounded-md bg-muted" /> : null;
}
