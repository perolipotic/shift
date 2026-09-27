import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useRef, useState, type FormEvent } from 'react';

import { ROTATION_KEY } from '@/features/rotation/services/list';
import {
  TEAMS_LIST_KEY,
  TEAMS_TABLE,
  teamsQueryOptions,
  teamsSurfaceStateOf,
  type TeamRow,
} from '@/features/teams/services/list';
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
  teamFormStateOf,
  type TeamSaved,
  type TeamWriteFailure,
  type TeamWriteTable,
} from '@/features/teams/services/write';
import { supabaseClient } from '@/lib/supabase/client';

/**
 * One team's state, its one read and its two writes (story 1.7a): rename it,
 * or archive it.
 *
 * THE SAME ONE READ the list screen makes, under the same key: the team is
 * found in that answer, so the two screens can never show two versions of it.
 * The page keys this by the route's id, so an armed confirmation, a refusal or
 * a confirmation is never carried from one team to another.
 *
 * TWO REFUSAL STATES, each where it happened: the rename's, which the name
 * field is described by, and the archive's, announced inside the archive
 * block, which never marks the name field invalid.
 *
 * Every rule is in `@/features/teams/services/list` and
 * `@/features/teams/services/write`, which the node suite executes; this hook
 * holds state and wiring only.
 */
export function useTeamEdit(id: string) {
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

  return {
    nameField,
    pending,
    setArmed,
    failure,
    archiveFailure,
    setArchiveFailure,
    saved,
    setSaved,
    renames,
    readRefusal,
    loading,
    form,
    refusal,
    stage,
    confirming,
    close,
    submit,
    archive,
  };
}

/** What the edit screen's parts are drawn from. */
export type TeamEditScreen = ReturnType<typeof useTeamEdit>;
