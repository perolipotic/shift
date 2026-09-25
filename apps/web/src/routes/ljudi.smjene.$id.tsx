import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createRoute, redirect, useNavigate } from '@tanstack/react-router';
import { Archive, Users } from 'lucide-react';
import { useRef, useState, type FormEvent, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupIcon } from '@/components/ui/input-group';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { t } from '@/i18n';
import { mayReadMembers } from '@/members/list';
import { DESTINATIONS } from '@/navigation/destinations';
import { MEMBER_ROLE_UNAVAILABLE, type MemberRoleOutcome } from '@/navigation/role';
import { ROTATION_KEY } from '@/rotation/list';
import { appLayoutRoute } from '@/routes/_app';
import { LjudiSmjeneScreen } from '@/routes/ljudi.smjene';
import { supabaseClient } from '@/supabase/client';
import {
  TEAMS_LIST_KEY,
  TEAMS_TABLE,
  teamsQueryOptions,
  teamHeadingMessageKey,
  teamsMessageKey,
  teamsSurfaceStateOf,
  type TeamRow,
} from '@/teams/list';
import {
  ARCHIVE_ARMED,
  ARCHIVE_BUSY,
  TEAM_ARCHIVED,
  TEAM_RENAMED,
  TEAM_WRITE_UNAVAILABLE,
  archiveStageOf,
  archiveTeam,
  renameTeam,
  renamesAfter,
  teamFormKey,
  teamFormStateOf,
  teamSavedMessageKey,
  teamWriteMessageKey,
  type TeamSaved,
  type TeamWriteFailure,
  type TeamWriteTable,
} from '@/teams/write';

/**
 * `/ljudi/smjene/$id` — rename or archive one team, or view an archived one
 * (story 1.7a).
 *
 * THE SAME ONE READ the list screen makes, under the same key: the team is
 * found in that answer, so the two screens can never show two versions of it.
 *
 * KEYED BY THE ROUTE'S ID. Moving from one team to another keeps this route
 * mounted, and an armed confirmation, a refusal or a confirmation carried over
 * would describe the wrong team — so the screen below is remounted per id and
 * starts clean.
 *
 * ARCHIVING IS ONE-WAY and takes ONE CONFIRMATION naming the team, in neutral
 * styling: it removes nothing, so it is not dressed as a destructive action. An
 * archived team renders its name and a note, and no control that writes.
 *
 * A DIALOG OVER THE LIST (design refresh C), as the hour band editor is: the
 * route renders `Smjene` and opens this team above it, every way the dialog
 * closes navigates back, and the archive's confirmation replaces the form
 * inside it.
 *
 * TWO REFUSALS, EACH WHERE IT HAPPENED. A refused rename is announced above the
 * form and is what the name field is described by; a refused archive is
 * announced inside the archive block, and never marks the name field invalid.
 */

const FIRST_DESTINATION = DESTINATIONS[0];

export function LjudiSmjenaScreen() {
  const { id } = ljudiSmjenaRoute.useParams();

  return <TeamScreen key={id} id={id} />;
}

function TeamScreen({ id }: { readonly id: string }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const nameField = useRef<HTMLInputElement>(null);
  const writing = useRef(false);
  const [pending, setPending] = useState(false);
  const [armed, setArmed] = useState(false);
  /** The RENAME's refusal: the one the name field is described by. */
  const [failure, setFailure] = useState<TeamWriteFailure | null>(null);
  /** The ARCHIVE's refusal, announced inside the archive block. */
  const [archiveFailure, setArchiveFailure] = useState<TeamWriteFailure | null>(null);
  const [saved, setSaved] = useState<TeamSaved | null>(null);
  /** Landed renames; the form key counts them, never the name. */
  const [renames, setRenames] = useState(0);

  const answer = useQuery(teamsQueryOptions(() => supabaseClient().from(TEAMS_TABLE)));

  const readState = teamsSurfaceStateOf(answer);
  const { refusal: readRefusal, loading } = readState;
  // A read failure hides the form, decided in `teamFormStateOf` from the state.
  const form = teamFormStateOf(readState, id);
  const refusal = failure ?? form.refusal;
  const stage = archiveStageOf(armed, pending);
  /** The archive is being asked about, or is in flight. */
  const confirming = stage === ARCHIVE_ARMED || stage === ARCHIVE_BUSY;

  function close(): void {
    void navigate({ to: '/ljudi/smjene' });
  }

  /** Re-read the one list, so both screens show what the database holds now. */
  async function refresh(): Promise<void> {
    try {
      // The rotation builder binds every active team, from its own snapshot
      // (story 2.3b), so a rename or an archive shows there too. Both start
      // together.
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: TEAMS_LIST_KEY }),
        queryClient.invalidateQueries({ queryKey: ROTATION_KEY }),
      ]);
    } catch (cause) {
      console.error(TEAM_WRITE_UNAVAILABLE, cause);
    }
  }

  /**
   * Rename. The field is uncontrolled and the form is keyed by landed renames
   * only, so a refused rename keeps what was typed even when the re-read
   * brings a name changed elsewhere.
   */
  async function submit(event: FormEvent<HTMLFormElement>, team: TeamRow): Promise<void> {
    event.preventDefault();

    const name = nameField.current;

    if (name === null || writing.current) return;

    writing.current = true;
    // A rename is a different decision from the archive it may interrupt.
    setArmed(false);
    setFailure(null);
    setArchiveFailure(null);
    setSaved(null);
    setPending(true);

    try {
      const outcome = await renameTeam(
        supabaseClient().from(TEAMS_TABLE) as unknown as TeamWriteTable,
        team,
        name.value,
      );

      if (!outcome.ok) {
        setFailure(outcome.code);
        name.focus();
      } else {
        setSaved(TEAM_RENAMED);
      }

      await refresh();
      // AFTER the re-read, so a remount shows what the database now holds.
      setRenames((current) => renamesAfter(current, outcome));
    } catch (cause) {
      console.error(TEAM_WRITE_UNAVAILABLE, cause);
      setFailure(TEAM_WRITE_UNAVAILABLE);
    } finally {
      writing.current = false;
      setPending(false);
    }
  }

  /**
   * Archive, once confirmed. The confirmation stays mounted and disabled while
   * the write is outstanding, and is disarmed only in the `finally`.
   */
  async function archive(team: TeamRow): Promise<void> {
    if (writing.current) return;

    writing.current = true;
    setFailure(null);
    setArchiveFailure(null);
    setSaved(null);
    setPending(true);

    try {
      const outcome = await archiveTeam(
        supabaseClient().from(TEAMS_TABLE) as unknown as TeamWriteTable,
        team,
      );

      if (!outcome.ok) {
        setArchiveFailure(outcome.code);
      } else {
        setSaved(TEAM_ARCHIVED);
      }

      await refresh();
    } catch (cause) {
      console.error(TEAM_WRITE_UNAVAILABLE, cause);
      setArchiveFailure(TEAM_WRITE_UNAVAILABLE);
    } finally {
      writing.current = false;
      setPending(false);
      setArmed(false);
    }
  }

  function renderArchiveRefusal(): ReactNode {
    return archiveFailure === null ? null : (
      <Notice role="alert">
        {t(teamWriteMessageKey(archiveFailure))}
      </Notice>
    );
  }

  /** The archive offer, beside Save in the dialog's footer. */
  function renderArchive(team: TeamRow): ReactNode {
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
  function renderConfirm(team: TeamRow): ReactNode {
    const busy = stage === ARCHIVE_BUSY;

    return (
      <div className="grid gap-5">
        <p className="text-sm font-medium">{t('smjene.archivePrompt', { name: team.name })}</p>
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
            className="h-11"
            type="button"
            disabled={busy}
            aria-busy={busy}
            onClick={() => {
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
          {renderArchiveRefusal()}
          {/* THE TWO DECISIONS TOGETHER, at the right: archive, then save.
              Neutral, never `destructive`, which UX-DR4 keeps for conflicts.
              The dialog's close is the way back. */}
          <DialogFooter>
            {renderArchive(team)}
            <Button className="h-11" type="submit" disabled={pending} aria-busy={pending}>
              {t('smjene.save')}
            </Button>
          </DialogFooter>
        </form>
        {confirming ? renderConfirm(team) : null}
      </>
    );
  }

  function renderBody(): ReactNode {
    if (form.team !== null) return renderTeam(form.team);

    return loading ? <div className="h-11 w-full animate-pulse rounded-md bg-muted" /> : null;
  }

  return (
    <>
      {/* THE LIST, behind the dialog: the team is edited where it is listed. */}
      <LjudiSmjeneScreen />
      <Dialog
        open={true}
        onOpenChange={(open) => {
          if (!open) close();
        }}
        aria-labelledby="team-edit-heading"
      >
        <DialogHeader closeLabel={t('smjene.close')} onClose={close}>
          <DialogTitle id="team-edit-heading">{t(teamHeadingMessageKey(form.team))}</DialogTitle>
        </DialogHeader>
        {readRefusal === null ? null : (
          <Notice role="alert">
            {t(teamsMessageKey(readRefusal))}
          </Notice>
        )}
        {refusal === null ? null : (
          <Notice id="team-form-error" role="alert">
            {t(teamWriteMessageKey(refusal))}
          </Notice>
        )}
        {saved === null ? null : (
          <Notice role="status">
            {t(teamSavedMessageKey(saved))}
          </Notice>
        )}
        {renderBody()}
      </Dialog>
    </>
  );
}

export const ljudiSmjenaRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/ljudi/smjene/$id',
  /** The guard `/ljudi` carries, copied verbatim; `router.test.ts` drives it. */
  beforeLoad: async ({ context }) => {
    let outcome: MemberRoleOutcome;

    try {
      outcome = await context.currentMemberRole();
    } catch (cause) {
      console.error(MEMBER_ROLE_UNAVAILABLE, cause);

      outcome = { ok: false, code: MEMBER_ROLE_UNAVAILABLE };
    }

    if (mayReadMembers(outcome)) return;

    throw redirect({ to: FIRST_DESTINATION.path, replace: true });
  },
  component: LjudiSmjenaScreen,
});
