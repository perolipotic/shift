import { onlineManager, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';

import { useErasureConfirmation, type ShownErasures } from '@/features/conflicts/hooks/use-erasure-confirmation';
import { CHECK_REFUSED, CHECK_UNAVAILABLE } from '@/features/conflicts/services/erasure-check';
import {
  byId,
  type CheckedMemberChange,
  type DialogOpening,
  type HeldTeamMove,
  type MemberScreen,
} from '@/features/members/hooks/member-edit-context';
import { MEMBERS_LIST_KEY, type MemberListRow } from '@/features/members/services/list';
import {
  memberErasureCheckOf,
  teamChangeOf,
  type MemberChangeRefusal,
} from '@/features/members/services/member-erasures';
import { shownTeamMovePreviewOf } from '@/features/members/services/team-move-preview';
import {
  MEMBER_TEAM_STALE,
  MEMBER_TEAM_TABLE,
  MEMBER_TEAM_UNPICKED,
  MEMBER_WRITE_UNAVAILABLE,
  NO_TEAM_VALUE,
  TEAM_UNPICKED_VALUE,
  TEAM_MOVE,
  WITHDRAW,
  changeMemberTeam,
  chosenTeam,
  pickedTeamValue,
  teamOfferFor,
  teamPickHistory,
  teamPickRefusalOf,
  teamPositionToSend,
  teamRefusalRereadsOrganization,
  raisedForMember,
  standingTeamConfirmation,
  statusStageOf,
  teamBlockKey,
  teamPreflightOf,
  type RaisedForMember,
  type MemberWriteRefusal,
  type TeamConfirmation,
  type TeamMoveOffer,
  type TeamOffer,
  type TeamPick,
} from '@/features/members/services/write';
import { dateMarkFor, dateMarked, type DateMark } from '@/features/members/utils/date-refusal';
import { MEMBER_TEAM_HEADING_ID } from '@/features/members/utils/element-ids';
import { ORGANIZATION_SNAPSHOT_KEY } from '@/features/organization/services/snapshot';
import { MEMBERSHIP_WRITE_DEPENDENTS, NO_DEPENDENTS, refreshAfterWrite } from '@/features/teams/services/dependents';
import { TEAMS_LIST_KEY } from '@/features/teams/services/list';
import { supabaseClient } from '@/lib/supabase/client';
import { firstEnabledOf, focusLater } from '@/utils/focus-later';
import { NO_TEXT } from '@/utils/text';
import { writesOnline } from '@/lib/offline/use-write-gate';

/**
 * The member page's *Smjena* card (stories 1.7b, 5.5e, 7.11; split out of
 * `useMemberEdit` by the epics 5–7 retro, A16): the team dialog — a move from
 * a date, its picker and position, *Što se mijenja* — the card's withdrawal
 * of a scheduled move, and the erasure guard over both, with its own
 * in-flight ref, pending flag and refusal. Every rule it applies is a pure
 * function in `@/features/members/services/write`.
 */
export function useMemberTeam(screen: MemberScreen) {
  const {
    id,
    openings,
    form,
    today,
    allTeams,
    activeTeams,
    positionsSetting,
    offersPosition,
    calendarSnapshot,
    latest,
    readErasures,
  } = screen;
  const queryClient = useQueryClient();
  /** The date the team dialog holds, so its *Što se mijenja* follows it as it is typed. Keyed to the member. */
  const [teamDay, setTeamDay] = useState<RaisedForMember<string> | null>(null);
  // THE TEAM BLOCK'S OWN STATE and its own in-flight ref.
  const teaming = useRef(false);
  const teamDateField = useRef<HTMLInputElement>(null);
  const teamPicker = useRef<HTMLSelectElement>(null);
  const teamOpener = useRef<HTMLButtonElement>(null);
  const teamWithdrawButton = useRef<HTMLButtonElement>(null);
  const teamSaveButton = useRef<HTMLButtonElement>(null);
  const [teamPending, setTeamPending] = useState(false);
  const [teamOpen, setTeamOpen] = useState<RaisedForMember<DialogOpening<HeldTeamMove>> | null>(null);
  /** The armed WITHDRAWAL of a scheduled move. */
  const [teamArmed, setTeamArmed] = useState<RaisedForMember<TeamConfirmation> | null>(null);
  const [teamSaved, setTeamSaved] = useState<RaisedForMember<true> | null>(null);
  const [teamFailure, setTeamFailure] = useState<RaisedForMember<MemberWriteRefusal> | null>(
    null,
  );
  const [teamDateMark, setTeamDateMark] = useState<DateMark | null>(null);
  // TEAM POSITION. The position control, and the team the picker holds, so the
  // position control can follow it.
  const positionField = useRef<HTMLSelectElement>(null);
  const [teamPick, setTeamPick] = useState<RaisedForMember<TeamPick> | null>(null);
  // THE ERASURE GUARD (story 5.5e): the retry of a check that could not be
  // derived, that refusal, how many conflicts a landed write removed, and the
  // erasure dialog itself — opened over the card's own dialog, which keeps
  // what was entered, so "Natrag na uređivanje" returns to it.
  const teamRetryButton = useRef<HTMLButtonElement>(null);
  const [teamUnchecked, setTeamUnchecked] = useState<RaisedForMember<true> | null>(null);
  const [teamErased, setTeamErased] = useState<RaisedForMember<number> | null>(null);
  const teamErasures = useErasureConfirmation<CheckedMemberChange<TeamConfirmation>>(teamPending, () =>
    firstEnabledOf<HTMLElement>(
      () => teamSaveButton.current,
      () => teamWithdrawButton.current,
      () => teamOpener.current,
    ),
  );

  // The erasure confirmation as last drawn, for the effect below.
  const erasureDialog = useRef(teamErasures);

  useEffect(() => {
    erasureDialog.current = teamErasures;
  });

  // ANOTHER MEMBER, or none: the erasure dialog was about the last one's
  // change, so it closes — once, when the route's member changes. So do the
  // dialog and its date: scoped to their member, they would otherwise open
  // again, unprompted, on the way back (A → B → A).
  useEffect(() => {
    const team = erasureDialog.current;

    if (team.shown !== null && team.shown.subject.member !== id) team.drop();
    setTeamOpen(null);
    setTeamDay(null);
  }, [id]);

  const teamArmedFor = standingTeamConfirmation(
    raisedForMember(teamArmed, id),
    form.member,
    teamPending,
  );
  const teamConfirmed = raisedForMember(teamSaved, id) !== null;
  const teamRefusal = raisedForMember(teamFailure, id);
  const teamDateInvalid = dateMarked(
    teamDateMark,
    teamRefusal,
    form.member === null ? null : teamBlockKey(form.member),
  );
  /** The picker is what the refusal names: nothing was chosen (story 7.11). */
  const teamPickInvalid = teamRefusal?.code === MEMBER_TEAM_UNPICKED;
  const teamStage = statusStageOf(teamArmedFor !== null, teamPending);
  const teamOffer =
    form.member === null ? null : teamOfferFor(form.member, activeTeams, today, positionsSetting);
  /** The team dialog's offer: a move from a date. */
  const teamMoveOffer: TeamMoveOffer | null = teamOffer !== null && teamOffer.change === TEAM_MOVE ? teamOffer : null;
  const teamOpening = raisedForMember(teamOpen, id);
  // THE PICK IS HELD AGAINST THE OFFER THE DIALOG WAS OPENED ON, so a re-read
  // that reorders or adds teams never remounts the picker onto the placeholder.
  const pickedAgainst: TeamOffer | null = teamOpening?.held.offer ?? teamOffer;
  const pickedTeam =
    form.member === null || pickedAgainst === null
      ? NO_TEAM_VALUE
      : pickedTeamValue(raisedForMember(teamPick, id), form.member, pickedAgainst);
  // STILL OFFERED while a move is, on the history it was opened against, and
  // the team picked — if one is — is still one to move onto.
  const teamStillOffered =
    teamOpening !== null &&
    teamMoveOffer !== null &&
    form.member !== null &&
    teamBlockKey(form.member) === teamOpening.held.history &&
    (pickedTeam === TEAM_UNPICKED_VALUE || chosenTeam(pickedTeam, teamMoveOffer) !== undefined);
  // AN OUTSTANDING WRITE OUTLIVES ITS OFFER, as the confirmation's always did.
  const teamDialogOpen = teamOpening !== null && (teamStillOffered || teamPending);
  const teamDayEntered = raisedForMember(teamDay, id) ?? NO_TEXT;
  const teamDialogOffer = teamDialogOpen ? teamOpening.held.offer : null;
  // DECISION 16's *ŠTO SE MIJENJA*: the last shift in the team left and the
  // first in the team picked, from the date as typed, off the same calendar
  // snapshot the status dialog's consequence reads — no request of its own.
  // `null` until a team is picked on a valid date; it never gates the save.
  const movePreview = useMemo(
    () => shownTeamMovePreviewOf(calendarSnapshot, id, teamDialogOffer, pickedTeam, teamDayEntered, today),
    [calendarSnapshot, id, teamDialogOffer, pickedTeam, teamDayEntered, today],
  );

  // THE DIALOG'S OFFER GONE ON A RE-READ (story 7.11): the move it was opened
  // for is no longer offered — another admin scheduled one, the teams went,
  // the team picked went. It closes, its erasure dialog with it, and the card
  // says the record moved — ALWAYS the stale refusal, never an earlier one
  // about what was entered. Never while its own write is pending: that
  // settles first.
  const teamGone = teamOpening !== null && !teamStillOffered && !teamPending;

  useEffect(() => {
    if (!teamGone) return;
    setTeamOpen(null);
    setTeamPick(null);
    if (erasureDialog.current.shown !== null) erasureDialog.current.drop();
    setTeamFailure({ member: id, raised: { code: MEMBER_TEAM_STALE, saved: false } });
    setTeamDateMark(null);
    focusTeamLanded();
  }, [teamGone, id]);

  /** After a landed team write, or a dialog that closed by itself: the opener, the withdrawal, or the card. */
  function focusTeamLanded(): void {
    focusLater([() => teamOpener.current, () => teamWithdrawButton.current], byId(MEMBER_TEAM_HEADING_ID));
  }

  /** `Promijeni`: the team dialog opens EMPTY — no team chosen (story 7.11). */
  function openTeam(): void {
    const member = form.member;

    if (teaming.current || teamMoveOffer === null || member === null) return;

    setTeamFailure(null);
    setTeamSaved(null);
    setTeamErased(null);
    setTeamUnchecked(null);
    setTeamDateMark(null);
    setTeamPick(null);
    setTeamDay({ member: id, raised: teamMoveOffer.minimum });
    openings.current += 1;
    setTeamOpen({
      member: id,
      raised: {
        key: openings.current,
        held: { offer: teamMoveOffer, history: teamBlockKey(member), name: member.name },
      },
    });
  }

  /** The team dialog's cancel, close button and Escape: never while a write is in flight. */
  function closeTeam(): void {
    if (teaming.current) return;

    setTeamOpen(null);
    setTeamFailure(null);
    setTeamUnchecked(null);
    setTeamPick(null);
    setTeamDay(null);
    focusTeamLanded();
  }

  /** The team dialog's date as it is typed, so its *Što se mijenja* follows it. */
  function enterTeamDay(event: ChangeEvent<HTMLInputElement>): void {
    setTeamDay({ member: id, raised: event.currentTarget.value });
  }

  /**
   * The confirmation the team dialog's fields — or the card's withdrawal —
   * earn, or `null`, with the refusal they already earn said and focus on the
   * field it names. Nothing is sent from here. A withdrawal is ARMED, for its
   * confirmation; a move goes straight on from the dialog's one Save.
   *
   * THE PLACEHOLDER IS REFUSED FIRST (story 7.11): `Odaberi smjenu` is no
   * team, and nothing else is judged.
   */
  function armTeam(member: MemberListRow, offered: TeamOffer): TeamConfirmation | null {
    setTeamSaved(null);
    setTeamErased(null);
    setTeamUnchecked(null);

    const unpicked = offered.change === TEAM_MOVE ? teamPickRefusalOf(pickedTeam) : null;

    if (unpicked !== null) {
      setTeamFailure({ member: member.id, raised: { code: unpicked, saved: false } });
      teamPicker.current?.focus();

      return null;
    }

    const dateField = teamDateField.current;
    const day = offered.change === WITHDRAW ? offered.scheduled.effectiveFrom : dateField?.value;
    // THE PICKED TEAM IS THE STATE (`pickedTeam`), the same value the position
    // control follows — never read back off the DOM.
    const team = offered.change === WITHDRAW ? null : chosenTeam(pickedTeam, offered);
    const keepsTeam =
      offered.change === TEAM_MOVE && team !== null && team !== undefined && team.id === offered.current?.id;
    // `null` while no position control is shown; decided in `@/features/members/services/write`.
    const position =
      offered.change === WITHDRAW
        ? null
        : teamPositionToSend(offered, pickedTeam, positionField.current?.value ?? NO_TEXT);

    // NEVER A PRESS WITH NO ANSWER: teams unread, or a pick the offer no longer
    // holds, is a screen behind the database.
    if (allTeams === null || day === undefined || team === undefined || position === undefined) {
      setTeamFailure({ member: member.id, raised: { code: MEMBER_TEAM_STALE, saved: false } });

      return null;
    }

    const refusal = teamPreflightOf(
      offered.change,
      day,
      team?.id ?? null,
      { member, teams: allTeams, today: offered.today, positions: offersPosition },
      position,
    );

    if (refusal !== null) {
      const raised = { code: refusal, saved: false };

      setTeamFailure({ member: member.id, raised });
      setTeamDateMark(dateMarkFor(raised, teamBlockKey(member), true));
      (offered.change === WITHDRAW ? null : dateField)?.focus();

      return null;
    }

    setTeamFailure(null);

    const confirmation: TeamConfirmation = {
      name: member.name,
      change: offered.change,
      team,
      position,
      keepsTeam,
      day,
      history: teamBlockKey(member),
    };

    if (offered.change === WITHDRAW) setTeamArmed({ member: member.id, raised: confirmation });

    return confirmation;
  }

  /**
   * Hold the team the picker now shows, against the history it was picked in,
   * so the position control can follow it (team position).
   */
  function pickTeam(event: ChangeEvent<HTMLSelectElement>): void {
    const member = form.member;

    if (member === null) return;

    setTeamPick({
      member: member.id,
      raised: {
        value: event.currentTarget.value,
        history: pickedAgainst === null ? NO_TEXT : teamPickHistory(member, pickedAgainst),
      },
    });
  }

  /**
   * THE TEAM WRITE ITSELF (story 5.5e: split out of `changeTeam`, which the
   * erasure dialog's save shares), under the in-flight ref its caller already
   * holds: exactly what `confirmation` names, judged against `member` as the
   * list holds it. `erased` is how many conflicts the admin confirmed it
   * removes; 0 for none. A landed write closes the team dialog.
   */
  async function writeTeam(
    member: MemberListRow,
    confirmation: TeamConfirmation,
    teams: NonNullable<typeof allTeams>,
    on: string,
    erased: number,
  ): Promise<void> {
    const outcome = await changeMemberTeam(
      supabaseClient().from(MEMBER_TEAM_TABLE),
      confirmation.change,
      confirmation.day,
      confirmation.team?.id ?? null,
      { member, teams, today: on, positions: offersPosition },
      confirmation.position,
    );

    if (!outcome.ok) {
      setTeamFailure({ member: member.id, raised: outcome.refusal });
      setTeamDateMark(dateMarkFor(outcome.refusal, teamBlockKey(member), false));
    } else {
      setTeamSaved({ member: member.id, raised: true });
      setTeamErased({ member: member.id, raised: erased });
      // The card redraws on the new history; the dialog and its pick close.
      setTeamOpen(null);
      setTeamPick(null);
      focusTeamLanded();
    }

    // THE LIST CARRIES THE TEAM HISTORY, and a refusal is refetched too: the
    // likeliest reason for one is a list behind the database. The teams are
    // refetched as well, because a team archived meanwhile is the other.
    // A LANDED MOVE is re-read wherever it shows — Danas's line, the rosters,
    // and since story 5.5e the leave and resolutions its erasure check stands
    // on (`MEMBERSHIP_WRITE_DEPENDENTS`), started beside the list.
    try {
      await refreshAfterWrite(
        queryClient,
        MEMBERS_LIST_KEY,
        outcome.ok ? MEMBERSHIP_WRITE_DEPENDENTS : NO_DEPENDENTS,
      );
      if (!outcome.ok) await queryClient.invalidateQueries({ queryKey: TEAMS_LIST_KEY });
      // TEAM POSITION: a refusal for a missing position means the setting
      // moved since this screen read it, so the organization is read again.
      if (!outcome.ok && teamRefusalRereadsOrganization(outcome.refusal.code)) {
        await queryClient.invalidateQueries({ queryKey: ORGANIZATION_SNAPSHOT_KEY });
      }
    } catch (cause) {
      console.error(MEMBER_WRITE_UNAVAILABLE, cause);
    }
  }

  /**
   * Send a team change — the dialog's move, or the card's confirmed
   * withdrawal — keeping what started it on screen while it is outstanding.
   *
   * A CHANGE NEVER QUIETLY ERASES A CONFLICT (story 5.5e). It first re-reads
   * the calendar, the organization's leave and its resolutions and derives
   * which unresolved conflicts it would erase. None: the write goes at once.
   * Some: the shared erasure dialog opens over the team dialog (a
   * withdrawal's confirmation closes), carrying the change. A check that
   * cannot be derived writes nothing and says so with a retry; a write
   * refused anyway takes the write's own refusal path. A position-only change
   * runs no check.
   */
  async function changeTeam(member: MemberListRow, confirmation: TeamConfirmation): Promise<void> {
    if (teaming.current) return;
    // STORY 8.3a: offline, nothing is sent — the component's gate is not the only guard.
    if (!writesOnline()) return;

    if (allTeams === null || today === null) {
      setTeamFailure({ member: member.id, raised: { code: MEMBER_TEAM_STALE, saved: false } });
      setTeamArmed(null);

      return;
    }

    // Disarmed when this settles, except while it asks for a retry.
    let disarm = true;

    teaming.current = true;
    setTeamFailure(null);
    setTeamSaved(null);
    setTeamErased(null);
    setTeamUnchecked(null);
    setTeamPending(true);

    try {
      const change = teamChangeOf(member.id, confirmation);

      if (change !== null) {
        const check = await memberErasureCheckOf(readErasures.readAndShare, change, onlineManager.isOnline());

        if (check.kind === CHECK_UNAVAILABLE) {
          disarm = false;
          // STORY 8.3a: the connection dropped while the check was out — the offline gate says why, not the unchecked refusal.
          if (!writesOnline()) return;
          setTeamUnchecked({ member: member.id, raised: true });
          focusLater([() => teamRetryButton.current], () =>
            firstEnabledOf<HTMLElement>(() => teamSaveButton.current, () => teamWithdrawButton.current),
          );

          return;
        }

        // REFUSED ANYWAY: the card's own refusal, said here, and nothing sent.
        if (check.kind === CHECK_REFUSED) {
          await refuseTeamChecked(member, check.code);

          return;
        }

        if (check.rows.length > 0) {
          teamErasures.show(check.rows, { member: member.id, confirmation, change });

          return;
        }
      }

      await writeTeam(member, confirmation, allTeams, today, 0);
    } catch (cause) {
      console.error(MEMBER_WRITE_UNAVAILABLE, cause);
      setTeamFailure({
        member: member.id,
        raised: { code: MEMBER_WRITE_UNAVAILABLE, saved: false },
      });
    } finally {
      teaming.current = false;
      setTeamPending(false);
      if (disarm) setTeamArmed(null);
    }
  }

  /**
   * The team dialog's Spremi (story 7.11): the old offer and its
   * confirmation folded into one press — the placeholder refused, then the
   * same preflight, then the erasure check, then the write. No second confirm.
   */
  async function saveTeam(event?: FormEvent<HTMLFormElement>): Promise<void> {
    event?.preventDefault();

    const member = form.member;

    if (member === null || teamOpening === null || !teamStillOffered || teaming.current) return;
    // STORY 8.3a: offline, nothing is sent — the component's gate is not the only guard.
    if (!writesOnline()) return;

    // THE OFFER THE DIALOG SHOWS, the one its pick was made against.
    const confirmation = armTeam(member, teamOpening.held.offer);

    if (confirmation !== null) await changeTeam(member, confirmation);
  }

  /** The withdrawal confirmation's confirm: sends what it names. */
  function confirmTeam(): void {
    const member = form.member;

    if (member !== null && teamArmedFor !== null) void changeTeam(member, teamArmedFor);
  }

  /** "Pokušaj ponovno": the same team change, asked again from where it was made. */
  function retryTeam(): void {
    if (teamDialogOpen) void saveTeam();
    else confirmTeam();
  }

  /** Focus after a team change was refused once its erasure dialog closed: the dialog's date, else the card. */
  function focusTeamRefused(): void {
    focusLater(
      [() => teamDateField.current, () => teamWithdrawButton.current, () => teamOpener.current],
      byId(MEMBER_TEAM_HEADING_ID),
    );
  }

  /**
   * A team change the database would refuse anyway, as the erasure check
   * found it (story 5.5e): the card's own refusal, with its date mark, and
   * nothing sent. The list and the teams are read again — and the
   * organization for a position refusal — as after the write's own refusal.
   */
  async function refuseTeamChecked(member: MemberListRow, code: MemberChangeRefusal): Promise<void> {
    const refusal = { code, saved: false };

    setTeamFailure({ member: member.id, raised: refusal });
    setTeamDateMark(dateMarkFor(refusal, teamBlockKey(member), false));
    focusTeamRefused();

    try {
      await queryClient.invalidateQueries({ queryKey: MEMBERS_LIST_KEY });
      await queryClient.invalidateQueries({ queryKey: TEAMS_LIST_KEY });
      if (teamRefusalRereadsOrganization(code)) {
        await queryClient.invalidateQueries({ queryKey: ORGANIZATION_SNAPSHOT_KEY });
      }
    } catch (cause) {
      console.error(MEMBER_WRITE_UNAVAILABLE, cause);
    }
  }

  /**
   * The team erasure dialog's own save, once every row is confirmed (story
   * 5.5e), under the same in-flight ref: the check is derived again from
   * fresh reads for the very change it was shown for, and judged against the
   * screen as it is THEN (`latest`). Another member shown: the dialog closes
   * and nothing is said. The member's history changed since the change was
   * made: stale, nothing written. Unavailable: the retry (a withdrawal's
   * confirmation armed again). Refused: the card's own refusal. A changed
   * list: shown again, undecided. Otherwise the write.
   */
  async function confirmTeamErasures(shown: ShownErasures<CheckedMemberChange<TeamConfirmation>>): Promise<void> {
    if (teaming.current || !teamErasures.confirmed) return;
    // STORY 8.3a: offline, nothing is sent — the component's gate is not the only guard.
    if (!writesOnline()) return;

    const { member: memberId, confirmation, change } = shown.subject;
    const before = latest.current;

    if (before.member === null || before.member.id !== memberId) {
      teamErasures.drop();

      return;
    }

    teaming.current = true;
    setTeamPending(true);

    try {
      const check = await memberErasureCheckOf(readErasures.readAndShare, change, onlineManager.isOnline());
      const { member: current, today: on, teams } = latest.current;

      if (current === null || current.id !== memberId) {
        teamErasures.drop();

        return;
      }

      await teamErasures.follow(shown, check, {
        stopped: () => {
          if (teamBlockKey(current) === confirmation.history) return false;

          teamErasures.drop();
          setTeamFailure({ member: memberId, raised: { code: MEMBER_TEAM_STALE, saved: false } });
          focusTeamRefused();

          return true;
        },
        unavailable: () => {
          // STORY 8.3a: offline, the confirmation stays open under the gate.
          if (!writesOnline()) return;
          teamErasures.drop();
          // A WITHDRAWAL'S CONFIRMATION, armed again, refuses with the retry; a
          // move's dialog is still open beneath and says it there.
          if (confirmation.change === WITHDRAW) setTeamArmed({ member: memberId, raised: confirmation });
          setTeamUnchecked({ member: memberId, raised: true });
          focusLater([() => teamRetryButton.current], () =>
            firstEnabledOf<HTMLElement>(() => teamSaveButton.current, () => teamWithdrawButton.current),
          );
        },
        refused: async ({ code }) => {
          teamErasures.drop();
          await refuseTeamChecked(current, code);
        },
        write: async ({ rows }) => {
          teamErasures.drop();

          if (teams === null || on === null) {
            setTeamFailure({ member: memberId, raised: { code: MEMBER_WRITE_UNAVAILABLE, saved: false } });
            focusTeamRefused();

            return;
          }

          await writeTeam(current, confirmation, teams, on, rows.length);
        },
      });
    } catch (cause) {
      console.error(MEMBER_WRITE_UNAVAILABLE, cause);
      teamErasures.drop();
      setTeamFailure({ member: memberId, raised: { code: MEMBER_WRITE_UNAVAILABLE, saved: false } });
      focusTeamRefused();
    } finally {
      teaming.current = false;
      setTeamPending(false);
    }
  }

  return {
    teamDateField,
    positionField,
    teamOffer,
    teamArmedFor,
    teamConfirmed,
    teamRefusal,
    teamDateInvalid,
    teamPickInvalid,
    teamStage,
    teamPending,
    pickedTeam,
    setTeamArmed,
    armTeam,
    pickTeam,
    confirmTeam,
    teamRetryButton,
    retryTeam,
    teamUnchecked: raisedForMember(teamUnchecked, id) !== null,
    teamErased: raisedForMember(teamErased, id) ?? 0,
    teamErasures,
    confirmTeamErasures,
    teamDialog: {
      /** What the card's header offers now. */
      available: teamMoveOffer,
      /** What the open dialog was opened on: it draws from this. */
      opening: teamDialogOpen ? teamOpening : null,
      opener: teamOpener,
      withdrawButton: teamWithdrawButton,
      saveButton: teamSaveButton,
      picker: teamPicker,
      /** Decision 16's *Što se mijenja* for the team picked and the date typed, or `null`. */
      preview: movePreview,
      enterDay: enterTeamDay,
      open: openTeam,
      close: closeTeam,
      save: saveTeam,
    },
  };
}
