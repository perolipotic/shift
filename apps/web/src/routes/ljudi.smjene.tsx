import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createRoute, redirect } from '@tanstack/react-router';
import { useRef, useState, type FormEvent, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { t } from '@/i18n';
import { NO_TEXT, mayReadMembers } from '@/members/list';
import { DESTINATIONS } from '@/navigation/destinations';
import { MEMBER_ROLE_UNAVAILABLE, type MemberRoleOutcome } from '@/navigation/role';
import { appLayoutRoute } from '@/routes/_app';
import { supabaseClient } from '@/supabase/client';
import {
  TEAMS_LIST_KEY,
  TEAMS_READ_STALE_MS,
  TEAMS_TABLE,
  readTeams,
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

  const answer = useQuery({
    queryKey: TEAMS_LIST_KEY,
    queryFn: () => readTeams(supabaseClient().from(TEAMS_TABLE)),
    staleTime: TEAMS_READ_STALE_MS,
    refetchOnWindowFocus: false,
  });

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

      try {
        await queryClient.invalidateQueries({ queryKey: TEAMS_LIST_KEY });
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

  /** A group's rows, or nothing at all when it has none: its count says so. */
  function renderTeams(group: readonly TeamRow[]): ReactNode {
    if (group.length === 0) return null;

    return (
      <ul className="grid gap-2">
        {group.map((team) => (
          <li key={team.id}>
            {/* NAMED FOR THE TEAM IT OPENS; the name is data, interpolated. An
                archived team's row VIEWS it — `teamActionMessageKey` decides,
                because its screen offers no edit. */}
            <Button asChild variant="outline" className="h-11 w-full justify-start">
              <Link to="/ljudi/smjene/$id" params={{ id: team.id }}>
                <span className="truncate">{t(teamActionMessageKey(team), { name: team.name })}</span>
              </Link>
            </Button>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <main className="flex min-w-0 flex-1 flex-col gap-6 p-6" aria-busy={loading}>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-xl font-semibold leading-none tracking-tight">{t('smjene.heading')}</h1>
        <Button asChild variant="outline" className="h-11">
          <Link to="/ljudi">{t('nav.ljudi')}</Link>
        </Button>
      </div>
      <form
        method="post"
        onSubmit={(event) => {
          void submit(event);
        }}
        className="flex flex-wrap items-end gap-4"
      >
        <div className="grid min-w-0 flex-1 gap-2">
          <Label htmlFor="team-new-name">{t('smjene.name')}</Label>
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
        </div>
        <Button className="h-11" type="submit" disabled={pending} aria-busy={pending}>
          {t('smjene.add')}
        </Button>
      </form>
      {failure === null ? null : (
        <p
          id="team-create-error"
          role="alert"
          className="rounded-md border border-input px-3 py-2 text-sm font-medium"
        >
          {t(teamWriteMessageKey(failure))}
        </p>
      )}
      {created ? (
        <p role="status" className="text-sm font-medium">
          {t('smjene.created')}
        </p>
      ) : null}
      {refusal === null ? null : (
        <p role="alert" className="rounded-md border border-input px-3 py-2 text-sm font-medium">
          {t(teamsMessageKey(refusal))}
        </p>
      )}
      {loading ? (
        <div className="grid gap-2">
          {SKELETON_ROWS.map((row) => (
            <div key={row} className="h-11 w-full animate-pulse rounded-md bg-muted" />
          ))}
        </div>
      ) : null}
      {split === null ? null : (
        <section className="grid gap-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold">
              {t('smjene.activeHeading')}
            </h2>
            {/* STATED, AND STATED AT ZERO (UX-DR20). NOT a live region: only
                confirmations announce, and a count announced on every refetch
                is noise that buries them. */}
            <p className="text-sm text-muted-foreground">
              {t('smjene.count', { count: split.active.length })}
            </p>
          </div>
          {renderTeams(split.active)}
        </section>
      )}
      {split === null ? null : (
        <section className="grid gap-4">
          {/* The count IS the heading: `Arhivirano: 2 smjene`. A separate
              `Arhivirano` above it would say the same word twice. */}
          <h2 className="text-base font-semibold">
            {t('smjene.archivedCount', { count: split.archived.length })}
          </h2>
          {renderTeams(split.archived)}
        </section>
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
