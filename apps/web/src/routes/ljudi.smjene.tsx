import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createRoute, redirect } from '@tanstack/react-router';
import { Eye, Pencil, Plus, Users, UsersRound } from 'lucide-react';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { IconTile } from '@/components/ui/icon-tile';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupIcon } from '@/components/ui/input-group';
import { Label } from '@/components/ui/label';
import { PageActions, PageDescription, PageHeader, PageTitle } from '@/components/ui/page-header';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Notice } from '@/components/ui/notice';
import { t } from '@/i18n';
import { NO_TEXT, mayReadMembers } from '@/members/list';
import { DESTINATIONS } from '@/navigation/destinations';
import { MEMBER_ROLE_UNAVAILABLE, type MemberRoleOutcome } from '@/navigation/role';
import { ROTATION_KEY } from '@/rotation/list';
import { appLayoutRoute } from '@/routes/_app';
import { supabaseClient } from '@/supabase/client';
import {
  TEAMS_LIST_KEY,
  TEAMS_TABLE,
  teamsQueryOptions,
  splitTeams,
  teamActionMessageKey,
  teamsMessageKey,
  teamsSurfaceStateOf,
  type TeamRow,
} from '@/teams/list';
import {
  TEAM_WRITE_REFUSED,
  TEAM_WRITE_UNAVAILABLE,
  claimedOrganizationOf,
  createTeam,
  teamWriteMessageKey,
  type TeamWriteFailure,
  type TeamWriteTable,
} from '@/teams/write';

/**
 * `/ljudi/smjene` — the organization's teams (story 1.7a).
 *
 * ADMIN ONLY, under the same guard `/ljudi` carries, and NOT a destination: it
 * is reached from the member list, which lights the `Ljudi` tab.
 *
 * ONE READ (AD-13). The rows, both counts and both groups come from the single
 * `useQuery` under `TEAMS_LIST_KEY`, split by `splitTeams`. The create needs the
 * caller's organization, which is read from the session's own claim at submit
 * time — not a second query — and the database pins it again.
 *
 * ANY COUNT (DI-8). Nothing here knows how many teams there are; zero renders
 * `0 smjena` in words beside the create form.
 *
 * THIS FILE HOLDS MARKUP AND STATE. Every rule is in `@/teams/list` and
 * `@/teams/write`, which the node suite executes.
 */

const FIRST_DESTINATION = DESTINATIONS[0];

const SKELETON_ROWS = [0, 1, 2];

export function LjudiSmjeneScreen() {
  const queryClient = useQueryClient();
  const nameField = useRef<HTMLInputElement>(null);
  const creating = useRef(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<TeamWriteFailure | null>(null);
  const [created, setCreated] = useState(false);
  const [adding, setAdding] = useState(false);

  // The first field, once the dialog is open. The dialog's own effect runs
  // first, so `showModal()` has already moved focus into it.
  useEffect(() => {
    if (adding) nameField.current?.focus();
  }, [adding]);

  function openAdding(): void {
    setFailure(null);
    setCreated(false);
    setAdding(true);
  }

  const answer = useQuery(teamsQueryOptions(() => supabaseClient().from(TEAMS_TABLE)));

  const { teams, refusal, loading } = teamsSurfaceStateOf(answer);
  const split = teams === null ? null : splitTeams(teams);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const name = nameField.current;

    if (name === null || creating.current) return;

    creating.current = true;
    setFailure(null);
    setCreated(false);
    setPending(true);

    try {
      const client = supabaseClient();
      const { data } = await client.auth.getSession();
      const organization = claimedOrganizationOf(data.session?.access_token);

      if (organization === null) {
        setFailure(TEAM_WRITE_REFUSED);

        return;
      }

      const outcome = await createTeam(
        client.from(TEAMS_TABLE) as unknown as TeamWriteTable,
        organization,
        name.value,
      );

      // A REFUSED SAVE KEEPS THE ENTERED VALUE: the field is uncontrolled and
      // nothing here clears it on this path (UX-DR34).
      if (!outcome.ok) {
        setFailure(outcome.code);
        name.focus();

        return;
      }

      name.value = NO_TEXT;
      setCreated(true);
      // Closed, and the confirmation is on the page; focus returns to the
      // button that opened the dialog.
      setAdding(false);

      try {
        // The rotation builder binds every active team, from its own snapshot
        // (story 2.3b), so a new team shows there too. Both start together.
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: TEAMS_LIST_KEY }),
          queryClient.invalidateQueries({ queryKey: ROTATION_KEY }),
        ]);
      } catch (cause) {
        console.error(TEAM_WRITE_UNAVAILABLE, cause);
      }
    } catch (cause) {
      console.error(TEAM_WRITE_UNAVAILABLE, cause);
      setFailure(TEAM_WRITE_UNAVAILABLE);
    } finally {
      creating.current = false;
      setPending(false);
    }
  }

  /** A group as a table, or nothing at all when it has none: its count says so. */
  function renderTeams(group: readonly TeamRow[]): ReactNode {
    if (group.length === 0) return null;

    return (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t('smjene.name')}</TableHead>
            <TableHead className="text-right">{t('smjene.actions')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {group.map((team) => (
            <TableRow key={team.id}>
              <TableCell>
                <div className="flex min-w-0 items-center gap-3">
                  <IconTile>
                    <Users />
                  </IconTile>
                  <span className="truncate font-semibold">{team.name}</span>
                </div>
              </TableCell>
              <TableCell className="text-right">
                {/* NAMED FOR THE TEAM IT OPENS; the name is data, interpolated.
                    An archived team's row VIEWS it — `teamActionMessageKey`
                    decides, because its dialog offers no edit. */}
                <Button asChild variant="ghost" className="h-11 w-11 px-0">
                  <Link to="/ljudi/smjene/$id" params={{ id: team.id }}>
                    {team.archived ? <Eye aria-hidden /> : <Pencil aria-hidden />}
                    <span className="sr-only">{t(teamActionMessageKey(team), { name: team.name })}</span>
                  </Link>
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  }

  return (
    <main
      className="mx-auto flex w-full min-w-0 max-w-5xl flex-1 flex-col gap-6 p-6"
      aria-busy={loading}
    >
      <PageHeader>
        <div className="min-w-0">
          <PageTitle asChild>
            <h1>{t('smjene.heading')}</h1>
          </PageTitle>
          <PageDescription>{t('smjene.lede')}</PageDescription>
        </div>
        <PageActions>
          <Button asChild variant="outline" className="h-11">
            <Link to="/ljudi">
              <UsersRound aria-hidden />
              {t('nav.ljudi')}
            </Link>
          </Button>
          <Button className="h-11" type="button" onClick={openAdding}>
            <Plus aria-hidden />
            {t('smjene.open')}
          </Button>
        </PageActions>
      </PageHeader>
      {created ? <Notice role="status">{t('smjene.created')}</Notice> : null}
      {refusal === null ? null : (
        <Notice role="alert">
          {t(teamsMessageKey(refusal))}
        </Notice>
      )}
      <Dialog open={adding} onOpenChange={setAdding} aria-labelledby="team-new-heading">
        <DialogHeader
          closeLabel={t('smjene.close')}
          onClose={() => {
            setAdding(false);
          }}
        >
          <DialogTitle id="team-new-heading">{t('smjene.addHeading')}</DialogTitle>
        </DialogHeader>
        <form
          method="post"
          onSubmit={(event) => {
            void submit(event);
          }}
          className="grid gap-5"
        >
          <div className="grid gap-2">
            <Label htmlFor="team-new-name">{t('smjene.name')}</Label>
            <InputGroup>
              <InputGroupIcon>
                <Users />
              </InputGroupIcon>
              <Input
                ref={nameField}
                id="team-new-name"
                name="name"
                type="text"
                required
                defaultValue={NO_TEXT}
                onChange={() => {
                  // A confirmation describes the last save, not what is typed now.
                  setCreated(false);
                }}
                aria-invalid={failure !== null}
                aria-describedby={failure === null ? undefined : 'team-create-error'}
                className="h-11 w-full"
              />
            </InputGroup>
          </div>
          {/* THE CREATE FORM'S OWN REFUSAL, inside the dialog. The list-read
              refusal belongs to the page. */}
          {failure === null ? null : (
            <Notice id="team-create-error" role="alert">
              {t(teamWriteMessageKey(failure))}
            </Notice>
          )}
          <DialogFooter>
            <Button
              className="h-11"
              type="button"
              variant="outline"
              onClick={() => {
                setAdding(false);
              }}
            >
              {t('smjene.cancel')}
            </Button>
            <Button className="h-11" type="submit" disabled={pending} aria-busy={pending}>
              {t('smjene.add')}
            </Button>
          </DialogFooter>
        </form>
      </Dialog>
      {loading ? (
        <div className="grid gap-2">
          {SKELETON_ROWS.map((row) => (
            <div key={row} className="h-11 w-full animate-pulse rounded-md bg-muted" />
          ))}
        </div>
      ) : null}
      {split === null ? null : (
        <Card className="min-w-0">
          <CardHeader className="flex-row flex-wrap items-center gap-3">
            <CardTitle asChild>
              <h2>{t('smjene.activeHeading')}</h2>
            </CardTitle>
            {/* STATED, AND STATED AT ZERO (UX-DR20). NOT a live region: only
                confirmations announce, and a count announced on every refetch
                is noise that buries them. */}
            <Badge variant="secondary">{t('smjene.count', { count: split.active.length })}</Badge>
          </CardHeader>
          {renderTeams(split.active)}
        </Card>
      )}
      {split === null ? null : (
        <Card className="min-w-0">
          <CardHeader>
            {/* The count IS the heading: `Arhivirano: 2 smjene`. A separate
                `Arhivirano` above it would say the same word twice. */}
            <CardTitle asChild>
              <h2>{t('smjene.archivedCount', { count: split.archived.length })}</h2>
            </CardTitle>
          </CardHeader>
          {renderTeams(split.archived)}
        </Card>
      )}
    </main>
  );
}

export const ljudiSmjeneRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/ljudi/smjene',
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
  component: LjudiSmjeneScreen,
});
