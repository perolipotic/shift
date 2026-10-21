import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import { ORGANIZATION_SNAPSHOT_KEY, type OrganizationOutcome } from '@/features/organization/services/snapshot';
import { TEAM_CREATE_DEPENDENTS, refreshAfterWrite, retryRead } from '@/features/teams/services/dependents';
import {
  TEAMS_LIST_KEY,
  TEAMS_TABLE,
  splitTeams,
  teamsQueryOptions,
  teamsNoticeOf,
  teamsSurfaceStateOf,
} from '@/features/teams/services/list';
import { TEAM_LIST_SURFACE_KEYS, teamListTimeZoneOf } from '@/features/teams/services/surface-keys';
import {
  TEAM_WRITE_REFUSED,
  TEAM_WRITE_UNAVAILABLE,
  createTeam,
  type TeamWriteFailure,
  type TeamWriteTable,
} from '@/features/teams/services/write';
import { offlineNoteOf, zoneFromReads } from '@/lib/offline/freshness';
import { useSnapshotFreshness } from '@/lib/offline/use-snapshot-freshness';
import { claimedOrganizationOf } from '@/lib/supabase/claims';
import { supabaseClient } from '@/lib/supabase/client';
import { NO_TEXT } from '@/utils/text';

/**
 * The team list's state, its one read and its add (story 1.7a): the add
 * dialog's uncontrolled name field, its in-flight ref and outcome, and the two
 * groups the list draws.
 *
 * ONE READ (AD-13). The rows, both counts and both groups come from the single
 * `useQuery` under `TEAMS_LIST_KEY`, split by `splitTeams`. The create needs the
 * caller's organization, which is read from the session's own claim at submit
 * time — not a second query — and the database pins it again.
 *
 * Every rule is in `@/features/teams/services/list` and
 * `@/features/teams/services/write`, which the node suite executes; this hook
 * holds state and wiring only.
 */
export function useTeamList() {
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

  const answerRead = useQuery(teamsQueryOptions(() => supabaseClient().from(TEAMS_TABLE)));
  // STORY 8.2d: the list is one snapshot with the organization
  // (`TEAM_LIST_SURFACE_KEYS`): online, a list older than this session's
  // network is never drawn as fresh; offline, the cached list is drawn under
  // the as-of note (`offline`), or the unavailable state is. THE NOTE'S ZONE
  // is the organization's; it is read from the cache, never from a second
  // `useQuery` here — the chrome observes that key, and the freshness decides
  // it from the cache.
  const timeZone = teamListTimeZoneOf(
    queryClient.getQueryData<OrganizationOutcome>(ORGANIZATION_SNAPSHOT_KEY),
  );
  const { freshness, clock, answerOf } = useSnapshotFreshness(
    TEAM_LIST_SURFACE_KEYS,
    [[TEAMS_LIST_KEY, answerRead]],
    zoneFromReads(timeZone),
  );
  const answer = answerOf(answerRead);

  const state = teamsSurfaceStateOf(answer);
  const { teams, loading } = state;
  // THE LIST'S NOTICE: the refusal, or the unavailable message beside rows a
  // refetch paused offline over, which is never a refusal (an edit form keeps
  // them). Under the freshness (story 8.2d) a paused refetch is never seen:
  // the as-of note stands where that message stood.
  const refusal = teamsNoticeOf(state);
  const split = teams === null ? null : splitTeams(teams);
  // STORY 8.2d: the as-of note, while the cached list is drawn offline; none
  // beside the unavailable message.
  const offline = offlineNoteOf(freshness, timeZone, refusal !== null);
  // NO READ RETRY OFFLINE (story 8.2d, decision 2a): `retryable` is the
  // connection's, so offline the message stays without its retry, and the
  // retry comes back with the connection.
  const retryable = clock.online;

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

      // Refused as an ordinary refusal is: the entered value stays and the
      // field takes focus.
      if (organization === null) {
        setFailure(TEAM_WRITE_REFUSED);
        name.focus();

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
        // (story 2.3b), so a new team shows there too (`TEAM_CREATE_DEPENDENTS`).
        // Both start together.
        await refreshAfterWrite(queryClient, TEAMS_LIST_KEY, TEAM_CREATE_DEPENDENTS);
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

  /** Read the list again, from the unavailable notice's retry. */
  function retry(): void {
    void retryRead(queryClient, TEAMS_LIST_KEY);
  }

  return {
    nameField,
    pending,
    failure,
    created,
    setCreated,
    adding,
    setAdding,
    openAdding,
    submit,
    refusal,
    retry,
    retryable,
    loading,
    split,
    offline,
  };
}

/** What the list screen's parts are drawn from. */
export type TeamListScreen = ReturnType<typeof useTeamList>;
