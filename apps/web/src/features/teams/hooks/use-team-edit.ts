import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { useRef, useState, type FormEvent } from 'react';

import { ORGANIZATION_SNAPSHOT_KEY, type OrganizationOutcome } from '@/features/organization/services/snapshot';
import {
  NO_DEPENDENTS,
  TEAM_CHANGE_DEPENDENTS,
  refreshAfterWrite,
  retryRead,
} from '@/features/teams/services/dependents';
import {
  TEAMS_LIST_KEY,
  TEAMS_TABLE,
  teamsQueryOptions,
  teamsSurfaceStateOf,
  type TeamRow,
} from '@/features/teams/services/list';
import { TEAM_LIST_SURFACE_KEYS, teamListTimeZoneOf } from '@/features/teams/services/surface-keys';
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
import { zoneFromReads } from '@/lib/offline/freshness';
import { useSnapshotFreshness } from '@/lib/offline/use-snapshot-freshness';
import { droppedOffline, writesOnline } from '@/lib/offline/use-write-gate';
import { supabaseClient } from '@/lib/supabase/client';
import { focusLater } from '@/utils/focus-later';

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
  /** The archive's own confirm (story 8.3b): focus returns to it when the connection drops under the archive. */
  const archiveConfirm = useRef<HTMLButtonElement>(null);
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

  const answerRead = useQuery(teamsQueryOptions(() => supabaseClient().from(TEAMS_TABLE)));
  // STORY 8.2d: the same one snapshot the list behind the dialog decides
  // (`TEAM_LIST_SURFACE_KEYS`), so the form and the list are drawn from the
  // cached rows together, or are unavailable together. The as-of note is the
  // list's, under its heading; the dialog adds none.
  const timeZone = teamListTimeZoneOf(
    queryClient.getQueryData<OrganizationOutcome>(ORGANIZATION_SNAPSHOT_KEY),
  );
  const { clock, answerOf } = useSnapshotFreshness(
    TEAM_LIST_SURFACE_KEYS,
    [[TEAMS_LIST_KEY, answerRead]],
    zoneFromReads(timeZone),
  );
  const answer = answerOf(answerRead);

  const readState = teamsSurfaceStateOf(answer);
  const { refusal: readRefusal, loading } = readState;
  // NO READ RETRY OFFLINE (story 8.2d, decision 2a): `retryable` means "show
  // the read retry now" (story 8.2e) — the read's message is up, and the
  // connection is: offline the message stays without its retry, and the
  // retry comes back with the connection.
  const retryable = clock.online && readRefusal !== null;
  // A read failure hides the form, decided in `teamFormStateOf` from the state.
  const form = teamFormStateOf(readState, id);
  const refusal = failure ?? form.refusal;
  const stage = archiveStageOf(armed, pending);
  /** The archive is being asked about, or is in flight. */
  const confirming = stage === ARCHIVE_ARMED || stage === ARCHIVE_BUSY;

  function close(): void {
    void navigate({ to: '/ljudi/smjene' });
  }

  /**
   * Re-read the one list, so both screens show what the database holds now,
   * on either outcome. Once the write LANDED, every read that shows a team's
   * name or flag is re-read beside it — the builder, the member list, Danas's
   * line, the rosters and the calendar (`TEAM_CHANGE_DEPENDENTS`) — all
   * started together. A failed or paused re-read resolves rather than rejects
   * (pinned in `dependents.test.ts`); the `try` is for a client that throws
   * before any re-read starts.
   */
  async function refresh(landed: boolean): Promise<void> {
    try {
      await refreshAfterWrite(queryClient, TEAMS_LIST_KEY, landed ? TEAM_CHANGE_DEPENDENTS : NO_DEPENDENTS);
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
    // STORY 8.3b: offline, nothing is sent — the component's gate is not the only guard.
    if (!writesOnline()) return;

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

      // STORY 8.3b: the connection dropped under the write — the gate's note says why, not the write refusal.
      if (!outcome.ok && droppedOffline(outcome.code, TEAM_WRITE_UNAVAILABLE)) {
        name.focus();

        return;
      }

      if (!outcome.ok) {
        setFailure(outcome.code);
        name.focus();
      } else {
        setSaved(TEAM_RENAMED);
      }

      await refresh(outcome.ok);
      // AFTER the re-read, so a remount shows what the database now holds.
      setRenames((current) => renamesAfter(current, outcome));
    } catch (cause) {
      console.error(TEAM_WRITE_UNAVAILABLE, cause);
      // STORY 8.3b: offline now, the gate's note says why, not the write refusal.
      if (!writesOnline()) {
        name.focus();

        return;
      }
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
    // STORY 8.3b: offline, nothing is sent — the component's gate is not the only guard.
    if (!writesOnline()) return;

    // STORY 8.3b: the connection dropped under the archive — its confirmation stays armed.
    let keepArmed = false;

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

      // STORY 8.3b: the connection dropped under the write — the gate's note says why, not the write refusal.
      if (!outcome.ok && droppedOffline(outcome.code, TEAM_WRITE_UNAVAILABLE)) {
        keepArmed = true;
        focusLater([() => archiveConfirm.current], () => nameField.current);

        return;
      }

      if (!outcome.ok) {
        setArchiveFailure(outcome.code);
      } else {
        setSaved(TEAM_ARCHIVED);
      }

      await refresh(outcome.ok);
    } catch (cause) {
      console.error(TEAM_WRITE_UNAVAILABLE, cause);
      // STORY 8.3b: offline now, the gate's note says why, not the write refusal.
      if (!writesOnline()) {
        keepArmed = true;
        focusLater([() => archiveConfirm.current], () => nameField.current);

        return;
      }
      setArchiveFailure(TEAM_WRITE_UNAVAILABLE);
    } finally {
      writing.current = false;
      setPending(false);
      if (!keepArmed) setArmed(false);
    }
  }

  /** Read the list again, from the unavailable notice's retry. */
  function retry(): void {
    void retryRead(queryClient, TEAMS_LIST_KEY);
  }

  return {
    nameField,
    archiveConfirm,
    pending,
    setArmed,
    failure,
    archiveFailure,
    setArchiveFailure,
    saved,
    setSaved,
    renames,
    readRefusal,
    retry,
    retryable,
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
