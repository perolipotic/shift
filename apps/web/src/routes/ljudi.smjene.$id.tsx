import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createRoute, redirect } from '@tanstack/react-router';
import { useRef, useState, type FormEvent, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PageHeader, PageTitle } from '@/components/ui/page-header';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { t } from '@/i18n';
import { mayReadMembers } from '@/members/list';
import { DESTINATIONS } from '@/navigation/destinations';
import { MEMBER_ROLE_UNAVAILABLE, type MemberRoleOutcome } from '@/navigation/role';
import { appLayoutRoute } from '@/routes/_app';
import { supabaseClient } from '@/supabase/client';
import {
  TEAMS_LIST_KEY,
  TEAMS_READ_STALE_MS,
  TEAMS_TABLE,
  readTeams,
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

  const answer = useQuery({
    queryKey: TEAMS_LIST_KEY,
    queryFn: () => readTeams(supabaseClient().from(TEAMS_TABLE)),
    staleTime: TEAMS_READ_STALE_MS,
    refetchOnWindowFocus: false,
  });

  const { teams, refusal: readRefusal, loading } = teamsSurfaceStateOf(answer);
  const form = teamFormStateOf(teams, loading, id);
  const refusal = failure ?? form.refusal;
  const stage = archiveStageOf(armed, pending);

  /** Re-read the one list, so both screens show what the database holds now. */
  async function refresh(): Promise<void> {
    try {
      await queryClient.invalidateQueries({ queryKey: TEAMS_LIST_KEY });
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

  function renderArchive(team: TeamRow): ReactNode {
    if (stage === ARCHIVE_ARMED || stage === ARCHIVE_BUSY) {
      const busy = stage === ARCHIVE_BUSY;

      return (
        <div className="grid gap-2">
          <p className="text-sm font-medium">{t('smjene.archivePrompt', { name: team.name })}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            <Button
              className="h-11 w-full"
              type="button"
              variant="outline"
              disabled={busy}
              aria-busy={busy}
              onClick={() => {
                void archive(team);
              }}
            >
              {t('smjene.archiveConfirm', { name: team.name })}
            </Button>
            <Button
              className="h-11 w-full"
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setArmed(false);
              }}
            >
              {t('smjene.archiveCancel')}
            </Button>
          </div>
        </div>
      );
    }

    return (
      <div className="grid gap-2">
        {renderArchiveRefusal()}
        <Button
          className="h-11 w-full"
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => {
            setArchiveFailure(null);
            setSaved(null);
            setArmed(true);
          }}
        >
          {t('smjene.archive', { name: team.name })}
        </Button>
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
      <div className="grid gap-6">
        <form
          key={teamFormKey(team, renames)}
          method="post"
          onSubmit={(event) => {
            void submit(event, team);
          }}
          className="grid gap-4"
        >
          <div className="grid gap-2">
            <Label htmlFor="team-name">{t('smjene.name')}</Label>
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
          </div>
          <Button className="h-11 w-full" type="submit" disabled={pending} aria-busy={pending}>
            {t('smjene.save')}
          </Button>
        </form>
        {renderArchive(team)}
      </div>
    );
  }

  function renderBody(): ReactNode {
    if (form.team !== null) return renderTeam(form.team);

    return loading ? <div className="h-11 w-full animate-pulse rounded-md bg-muted" /> : null;
  }

  return (
    <main className="mx-auto flex w-full min-w-0 max-w-5xl flex-1 flex-col gap-6 p-6">
      <PageHeader>
        <PageTitle asChild>
          <h1>
            {t(teamHeadingMessageKey(form.team))}
          </h1>
        </PageTitle>
      </PageHeader>
      <Card className="w-full min-w-0 max-w-lg">
        <CardContent className="grid gap-6">
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
          <Button asChild className="h-11 w-full" variant="outline">
            <Link to="/ljudi/smjene">{t('smjene.back')}</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
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
