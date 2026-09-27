import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import { NO_TEXT } from '@/features/members/services/list';
import { TEAM_CREATE_DEPENDENTS, refreshAfterWrite } from '@/features/teams/services/dependents';
import {
  TEAMS_LIST_KEY,
  TEAMS_TABLE,
  splitTeams,
  teamsQueryOptions,
  teamsNoticeOf,
  teamsSurfaceStateOf,
} from '@/features/teams/services/list';
import {
  TEAM_WRITE_REFUSED,
  TEAM_WRITE_UNAVAILABLE,
  claimedOrganizationOf,
  createTeam,
  type TeamWriteFailure,
  type TeamWriteTable,
} from '@/features/teams/services/write';
import { supabaseClient } from '@/lib/supabase/client';

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

  const answer = useQuery(teamsQueryOptions(() => supabaseClient().from(TEAMS_TABLE)));

  const state = teamsSurfaceStateOf(answer);
  const { teams, loading } = state;
  // THE LIST'S NOTICE: the refusal, or the unavailable message beside rows a
  // refetch paused offline over, which is never a refusal (an edit form keeps them).
  const refusal = teamsNoticeOf(state);
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
    loading,
    split,
  };
}

/** What the list screen's parts are drawn from. */
export type TeamListScreen = ReturnType<typeof useTeamList>;
