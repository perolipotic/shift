import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type ChangeEvent, type FormEvent } from 'react';

import {
  MEMBERS_LIST_KEY,
  MEMBERS_TABLE,
  NO_TEXT,
  membersSurfaceStateOf,
  membersTodayOf,
  membersQueryOptions,
  type MemberListRow,
} from '@/features/members/services/list';
import {
  MEMBER_STATUS_TABLE,
  MEMBER_TEAM_STALE,
  MEMBER_TEAM_TABLE,
  MEMBER_WRITE_INVALID,
  MEMBER_WRITE_UNAVAILABLE,
  NO_TEAM_VALUE,
  SESSION_SUBJECT_KEY,
  TEAM_MOVE,
  WITHDRAW,
  changeMemberStatus,
  changeMemberTeam,
  chosenTeam,
  chosenRole,
  enteredAllowance,
  memberFormRefusalOf,
  pickedTeamValue,
  teamOfferFor,
  teamPickHistory,
  teamPositionToSend,
  teamPositionsOn,
  teamPositionsRefusalOf,
  teamPositionsSettingOf,
  teamRefusalRereadsOrganization,
  raisedForMember,
  readSessionSubject,
  resetPassword,
  resetStageOf,
  saveMember,
  standingConfirmation,
  standingTeamConfirmation,
  statusBlockKey,
  statusOfferOf,
  statusPreflightOf,
  statusStageOf,
  storedEmail,
  teamBlockKey,
  teamPreflightOf,
  type RaisedForMember,
  type MemberFunctions,
  type MemberWriteRefusal,
  type ResetCredential,
  type StatusConfirmation,
  type StatusOffer,
  type TeamConfirmation,
  type TeamOffer,
  type TeamPick,
} from '@/features/members/services/write';
import { rankEditOf, ranksShown } from '@/features/members/utils/rank';
import {
  ORGANIZATION_READ_STALE_MS,
  ORGANIZATION_SNAPSHOT_KEY,
  ORGANIZATION_TABLE,
  readOrganization,
} from '@/features/organization/services/snapshot';
import { currentSession, supabaseClient } from '@/lib/supabase/client';
import {
  TEAMS_LIST_KEY,
  TEAMS_TABLE,
  teamsQueryOptions,
  splitTeams,
  teamsSurfaceStateOf,
  writableTeamsOf,
} from '@/features/teams/services/list';

/**
 * `/ljudi/$id`'s state, its four reads and its handlers (story 1.5b). The page
 * composes the header and four cards — basics, team, status, reset — and each
 * card is a component in `@/features/members/components` that reads this hook's
 * result.
 *
 * THE READS. The member comes out of `MEMBERS_LIST_KEY` (AD-13) rather than a
 * second read of one row, and `memberFormRefusalOf` turns that one answer into
 * "this member", "still loading" or "nothing here to edit". The organization is
 * read under the chrome's own key and cache policy, for the rank and position
 * settings; the session subject, so the status block is never offered on the
 * caller's own row; and the teams under `TEAMS_LIST_KEY`, for the picker.
 *
 * THE STATE. Every piece that is raised about a member — a refusal, a
 * confirmation, an armed change, an issued credential — is scoped through
 * `raisedForMember`, because one component instance serves every row and
 * navigating between two members changes a route param, not the component.
 *
 * THE HANDLERS. Four await a write, and each has its own in-flight ref, pending
 * flag and refusal, so no block's request disables another's controls:
 * `submit` (the form, through `saveMember`, which decides whether the
 * privileged function is reached at all), `issue` (the password reset),
 * `changeStatus` and `changeTeam`. `armStatus` and `armTeam` only arm a
 * confirmation or name the refusal already earned; `pickTeam` holds the picked
 * team so the position control can follow it. Every rule any of them applies is
 * a pure function in `@/features/members/services/write`, where a test runs it.
 *
 * Why the reset lives outside the form, and how its stage is decided: see
 * `member-reset-card.tsx`.
 */
export function useMemberEdit(id: string) {
  const queryClient = useQueryClient();
  const nameField = useRef<HTMLInputElement>(null);
  const usernameField = useRef<HTMLInputElement>(null);
  const emailField = useRef<HTMLInputElement>(null);
  const leaveField = useRef<HTMLInputElement>(null);
  const roleField = useRef<HTMLSelectElement>(null);
  const rankField = useRef<HTMLSelectElement>(null);
  // A REF as well as state: state drives the disabled button, and state is
  // stale inside a handler already called once this tick.
  const saving = useRef(false);
  const [pending, setPending] = useState(false);
  // SCOPED TO THE MEMBER IT WAS RAISED ABOUT. One component instance serves
  // every row — navigating between two members changes a route param, not the
  // component — so unscoped state outlives the record it describes.
  const [failure, setFailure] = useState<RaisedForMember<MemberWriteRefusal> | null>(null);
  /** Which field a locally-detected refusal is about. See the create screen. */
  const [invalidField, setInvalidField] = useState<string | null>(null);
  /**
   * That a save landed, and the ONLY thing on this screen that says so.
   *
   * Every field is uncontrolled and remounts to the values it was just saved
   * with, so a successful save leaves the screen looking EXACTLY as it did
   * before the press — indistinguishable from a click that did nothing, on the
   * one surface in this application whose whole job is changing a record. The
   * create screen gets a credential panel; this needed its own confirmation.
   *
   * KEYED TO THE MEMBER it confirms, so a save on one row cannot leave a
   * confirmation standing over another's form.
   */
  const [saved, setSaved] = useState<RaisedForMember<true> | null>(null);
  // THE RESET'S OWN THREE PIECES OF STATE, and its own in-flight ref. A second
  // awaiting handler on one screen needs a second guard: `saving` belongs to the
  // form, and sharing it would make a reset in flight disable the save and the
  // other way round — two unrelated actions blocking each other.
  const resetting = useRef(false);
  const [resetPending, setResetPending] = useState(false);
  /**
   * The armed confirmation, carrying the NAME it is about.
   *
   * The name travels with it rather than being read off the row at render time,
   * so the confirmation and the busy state stay on screen — and stay truthful —
   * through a refetch that drops the row underneath them.
   */
  const [armed, setArmed] = useState<RaisedForMember<string> | null>(null);
  /**
   * The issued credential, and THE ONLY COPY OF IT THERE IS.
   *
   * It outranks everything else on this screen: it survives a refetch, a read
   * that re-settles failed, and a row that vanishes, because looking again
   * cannot recover it. It is cleared by the dismiss control and by nothing
   * else — and until it is, a second reset is impossible.
   */
  const [issued, setIssued] = useState<RaisedForMember<ResetCredential> | null>(null);
  // THE STATUS BLOCK'S OWN FIVE PIECES OF STATE and its own in-flight ref, for
  // the reason the reset has its own: sharing either with another action would
  // make one block's request disable the other's controls — and its own
  // refusal, so the date control is described by the status block's alert and
  // never by an unrelated error on the form above it.
  const statusing = useRef(false);
  const dateField = useRef<HTMLInputElement>(null);
  const [statusPending, setStatusPending] = useState(false);
  /** The armed confirmation, carrying the name, the change and the DATE it is
   *  about, so what is confirmed is exactly what is sent. */
  const [statusArmed, setStatusArmed] = useState<RaisedForMember<StatusConfirmation> | null>(
    null,
  );
  /** That a status change landed. Keyed to the member it confirms. */
  const [statusSaved, setStatusSaved] = useState<RaisedForMember<true> | null>(null);
  /** Why the last status change did not land. Keyed to the member. */
  const [statusFailure, setStatusFailure] =
    useState<RaisedForMember<MemberWriteRefusal> | null>(null);
  // THE TEAM BLOCK'S OWN STATE and its own in-flight ref, for the reason the
  // status block has its own.
  const teaming = useRef(false);
  const teamDateField = useRef<HTMLInputElement>(null);
  const [teamPending, setTeamPending] = useState(false);
  const [teamArmed, setTeamArmed] = useState<RaisedForMember<TeamConfirmation> | null>(null);
  const [teamSaved, setTeamSaved] = useState<RaisedForMember<true> | null>(null);
  const [teamFailure, setTeamFailure] = useState<RaisedForMember<MemberWriteRefusal> | null>(
    null,
  );
  // TEAM POSITION. The position control, and the team the picker holds, so the
  // position control can follow it.
  const positionField = useRef<HTMLSelectElement>(null);
  const [teamPick, setTeamPick] = useState<RaisedForMember<TeamPick> | null>(null);

  const answer = useQuery(membersQueryOptions(() => supabaseClient().from(MEMBERS_TABLE)));

  // MEMBER RANK. Whether the rank control is offered, read from the one
  // organization snapshot under its shared key (AD-13) — the chrome already
  // reads it on every screen. Until it arrives the control is absent and the
  // save leaves the stored rank alone.
  const organization = useQuery({
    queryKey: ORGANIZATION_SNAPSHOT_KEY,
    queryFn: () => readOrganization(supabaseClient().from(ORGANIZATION_TABLE)),
    // The chrome's own cache policy for this entry, so this is a second
    // consumer of one cache entry rather than a second read policy on it.
    retry: false,
    staleTime: ORGANIZATION_READ_STALE_MS,
  });
  const organizationSnapshot =
    organization.data !== undefined && organization.data.ok ? organization.data.snapshot : null;
  const offersRank = ranksShown(organizationSnapshot);
  // TEAM POSITION: the same setting, as `@/features/members/services/write` reads it — on, off,
  // pending or failed. Until it is KNOWN no move is offered, so no position is
  // ever sent on a guess.
  const positionsSetting = teamPositionsSettingOf(organization);
  const offersPosition = teamPositionsOn(positionsSetting);
  const positionsRefusal = teamPositionsRefusalOf(positionsSetting);

  // THE CALLER'S OWN ACCOUNT, so the status block is never offered on it.
  const subject = useQuery({
    queryKey: SESSION_SUBJECT_KEY,
    queryFn: () => readSessionSubject(currentSession),
    refetchOnWindowFocus: false,
  });
  const callerAuthUserId = subject.data ?? null;

  // THE TEAMS THE PICKER OFFERS, under the team screens' own key (AD-13).
  const teamsAnswer = useQuery(teamsQueryOptions(() => supabaseClient().from(TEAMS_TABLE)));
  const teamsState = teamsSurfaceStateOf(teamsAnswer);
  // WRITABLE, not merely drawable: a failed refetch keeps the cached teams, and
  // the picker and team actions are withheld on it as they were before.
  const allTeams = writableTeamsOf(teamsState);
  const activeTeams = allTeams === null ? null : splitTeams(allTeams).active;
  const organizationMembers = membersSurfaceStateOf(answer).members ?? [];
  // THE ORGANIZATION'S TODAY — the date control's default and its minimum —
  // from the zone the one list read embeds.
  const today = membersTodayOf(organizationMembers, new Date());

  // TWO PURE FUNCTIONS AND NO BRANCH OF ITS OWN: the list's four states, then
  // "is this member in it". Both are pinned by execution in `write.test.ts`.
  const form = memberFormRefusalOf(membersSurfaceStateOf(answer), id);
  // The save's refusal wins over the read's: if a save has just been refused,
  // that is the thing the person is waiting to hear about.
  const refusal: MemberWriteRefusal | null =
    raisedForMember(failure, id) ??
    (form.refusal === null ? null : { code: form.refusal, saved: false });
  const confirmed = raisedForMember(saved, id) !== null;
  const armedFor = raisedForMember(armed, id);
  const credential = raisedForMember(issued, id);
  // FOUR STAGES FROM THREE INPUTS, decided in `@/features/members/services/write` where a test
  // runs it. `resetPending` is one of them rather than only a `disabled`
  // attribute, which is what makes the in-flight stage representable at all.
  const stage = resetStageOf(armedFor !== null, resetPending, credential);
  // CLEARED BY A REFETCH THAT CHANGES THIS MEMBER'S VERSIONS: a confirmation
  // armed against one history is not confirmed against another.
  const statusArmedFor = standingConfirmation(
    raisedForMember(statusArmed, id),
    form.member,
    statusPending,
  );
  const statusConfirmed = raisedForMember(statusSaved, id) !== null;
  const statusRefusal = raisedForMember(statusFailure, id);
  const statusStage = statusStageOf(statusArmedFor !== null, statusPending);
  const offer = form.member === null ? null : statusOfferOf(form.member, callerAuthUserId, today);
  const teamArmedFor = standingTeamConfirmation(
    raisedForMember(teamArmed, id),
    form.member,
    teamPending,
  );
  const teamConfirmed = raisedForMember(teamSaved, id) !== null;
  const teamRefusal = raisedForMember(teamFailure, id);
  const teamStage = statusStageOf(teamArmedFor !== null, teamPending);
  const teamOffer =
    form.member === null ? null : teamOfferFor(form.member, activeTeams, today, positionsSetting);
  const pickedTeam =
    form.member === null || teamOffer === null
      ? NO_TEAM_VALUE
      : pickedTeamValue(raisedForMember(teamPick, id), form.member, teamOffer);

  /**
   * Arm the team confirmation, or name the refusal the picked team and date
   * already earn. Nothing is sent from here.
   */
  function armTeam(member: MemberListRow, offered: TeamOffer): void {
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
      setTeamSaved(null);
      setTeamFailure({ member: member.id, raised: { code: MEMBER_TEAM_STALE, saved: false } });

      return;
    }

    const refusal = teamPreflightOf(
      offered.change,
      day,
      team?.id ?? null,
      { member, teams: allTeams, today: offered.today, positions: offersPosition },
      position,
    );

    setTeamSaved(null);

    if (refusal !== null) {
      setTeamFailure({ member: member.id, raised: { code: refusal, saved: false } });
      (offered.change === WITHDRAW ? null : dateField)?.focus();

      return;
    }

    setTeamFailure(null);
    setTeamArmed({
      member: member.id,
      raised: {
        name: member.name,
        change: offered.change,
        team,
        position,
        keepsTeam,
        day,
        history: teamBlockKey(member),
      },
    });
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
        history: teamOffer === null ? NO_TEXT : teamPickHistory(member, teamOffer),
      },
    });
  }

  /**
   * Send the confirmed team change, keeping the confirmation on screen while it
   * is outstanding. NOTHING CLEARS `teamArmed` BEFORE THE AWAIT.
   */
  async function changeTeam(): Promise<void> {
    const member = form.member;
    const confirmation = teamArmedFor;

    if (member === null || confirmation === null || teaming.current) return;

    if (allTeams === null || today === null) {
      setTeamFailure({ member: member.id, raised: { code: MEMBER_TEAM_STALE, saved: false } });
      setTeamArmed(null);

      return;
    }

    teaming.current = true;
    setTeamFailure(null);
    setTeamSaved(null);
    setTeamPending(true);

    try {
      const outcome = await changeMemberTeam(
        supabaseClient().from(MEMBER_TEAM_TABLE),
        confirmation.change,
        confirmation.day,
        confirmation.team?.id ?? null,
        { member, teams: allTeams, today, positions: offersPosition },
        confirmation.position,
      );

      if (outcome.ok) {
        setTeamSaved({ member: member.id, raised: true });
        // The block remounts on the new history; the pick goes with it.
        setTeamPick(null);
      } else {
        setTeamFailure({ member: member.id, raised: outcome.refusal });
      }

      // THE LIST CARRIES THE TEAM HISTORY, and a refusal is refetched too: the
      // likeliest reason for one is a list behind the database. The teams are
      // refetched as well, because a team archived meanwhile is the other.
      try {
        await queryClient.invalidateQueries({ queryKey: MEMBERS_LIST_KEY });
        if (!outcome.ok) await queryClient.invalidateQueries({ queryKey: TEAMS_LIST_KEY });
        // TEAM POSITION: a refusal for a missing position means the setting
        // moved since this screen read it, so the organization is read again.
        if (!outcome.ok && teamRefusalRereadsOrganization(outcome.refusal.code)) {
          await queryClient.invalidateQueries({ queryKey: ORGANIZATION_SNAPSHOT_KEY });
        }
      } catch (cause) {
        console.error(MEMBER_WRITE_UNAVAILABLE, cause);
      }
    } catch (cause) {
      console.error(MEMBER_WRITE_UNAVAILABLE, cause);
      setTeamFailure({
        member: member.id,
        raised: { code: MEMBER_WRITE_UNAVAILABLE, saved: false },
      });
    } finally {
      teaming.current = false;
      setTeamPending(false);
      setTeamArmed(null);
    }
  }

  /**
   * Arm the status confirmation, or name the refusal the entered date already
   * earns. Nothing is sent from here.
   */
  function armStatus(member: MemberListRow, offered: StatusOffer): void {
    if (callerAuthUserId === null) return;

    const field = dateField.current;
    // A CANCELLATION NAMES THE SCHEDULED VERSION'S DATE; the other two name
    // the entered one.
    const day = offered.change === WITHDRAW ? offered.scheduled.effectiveFrom : field?.value;

    if (day === undefined) return;

    const refusal = statusPreflightOf(offered.change, day, {
      member,
      members: organizationMembers,
      callerAuthUserId,
      today: offered.today,
    });

    setStatusSaved(null);

    if (refusal !== null) {
      // FOCUS MOVES TO THE DATE, which the block's own alert names; that alert
      // is what the field's `aria-describedby` points at.
      setStatusFailure({ member: member.id, raised: { code: refusal, saved: false } });
      field?.focus();

      return;
    }

    setStatusFailure(null);
    setStatusArmed({
      member: member.id,
      raised: { name: member.name, change: offered.change, day, history: statusBlockKey(member) },
    });
  }

  /**
   * Send the confirmed status change, keeping the confirmation on screen while
   * it is outstanding.
   *
   * NOTHING CLEARS `statusArmed` BEFORE THE AWAIT, for the reason `issue` gives.
   */
  async function changeStatus(): Promise<void> {
    const member = form.member;
    const confirmation = statusArmedFor;

    if (
      member === null ||
      confirmation === null ||
      callerAuthUserId === null ||
      today === null ||
      statusing.current
    ) {
      return;
    }

    statusing.current = true;
    setStatusFailure(null);
    setStatusSaved(null);
    setStatusPending(true);

    try {
      const outcome = await changeMemberStatus(
        supabaseClient().from(MEMBER_STATUS_TABLE),
        confirmation.change,
        confirmation.day,
        { member, members: organizationMembers, callerAuthUserId, today },
      );

      if (outcome.ok) setStatusSaved({ member: member.id, raised: true });
      else setStatusFailure({ member: member.id, raised: outcome.refusal });

      // THE LIST CARRIES THE VERSIONS, so the marker, the status line and the
      // next offer all move with it — and it is refetched on a REFUSAL too,
      // because the likeliest reason for one is a list behind the database
      // (`MEMBER_STATUS_STALE`). Its own failure is isolated, exactly as the
      // save's is.
      try {
        await queryClient.invalidateQueries({ queryKey: MEMBERS_LIST_KEY });
      } catch (cause) {
        console.error(MEMBER_WRITE_UNAVAILABLE, cause);
      }
    } catch (cause) {
      console.error(MEMBER_WRITE_UNAVAILABLE, cause);
      setStatusFailure({
        member: member.id,
        raised: { code: MEMBER_WRITE_UNAVAILABLE, saved: false },
      });
    } finally {
      // On EVERY path. Disarmed here and NOT before the await: the confirmation
      // carries the busy state, so it has to outlive the request it started.
      statusing.current = false;
      setStatusPending(false);
      setStatusArmed(null);
    }
  }

  /**
   * Send the reset, and keep the confirmation on screen while it is outstanding.
   *
   * NOTHING CLEARS `armed` BEFORE THE AWAIT. Clearing it there is what unmounts
   * the confirm pair mid-request and renders the plain, ENABLED offer in its
   * place — the state in which `resetPending` is read by no control at all and
   * a second press starts a second reset.
   */
  async function issue(): Promise<void> {
    const member = form.member;

    if (member === null || resetting.current) return;

    resetting.current = true;
    // The reset's own answer replaces whatever the form last said: a stale
    // "saved" or a stale refusal standing beside a new credential is two
    // outcomes claiming the same screen.
    setFailure(null);
    setInvalidField(null);
    setSaved(null);
    setResetPending(true);

    try {
      const outcome = await resetPassword(
        supabaseClient().functions as MemberFunctions,
        member.id,
      );

      // NO `invalidateQueries` HERE, and that is a decision rather than an
      // omission: a reset writes no `members` row, so a refetch would change
      // nothing on the list and would only be one more render the shown
      // credential has to survive.
      if (outcome.ok) setIssued({ member: member.id, raised: outcome.credential });
      else setFailure({ member: member.id, raised: outcome.refusal });
    } catch (cause) {
      // The client throwing `SUPABASE_ENVIRONMENT_MISSING` on a build with no
      // environment. The CAUSE is logged and never the credential — the success
      // path does not throw, so there is none to leak here.
      console.error(MEMBER_WRITE_UNAVAILABLE, cause);
      setFailure({ member: member.id, raised: { code: MEMBER_WRITE_UNAVAILABLE, saved: false } });
    } finally {
      // On EVERY path, including the successful one. Disarmed here and NOT
      // before the await: the confirmation is what carries the busy state, so
      // it has to outlive the request it started.
      resetting.current = false;
      setResetPending(false);
      setArmed(null);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const member = form.member;
    const name = nameField.current;
    const username = usernameField.current;
    const email = emailField.current;
    const leave = leaveField.current;
    const role = roleField.current;
    const rank = rankField.current;

    if (
      member === null ||
      name === null ||
      username === null ||
      email === null ||
      leave === null ||
      role === null ||
      (offersRank && rank === null) ||
      saving.current
    ) {
      return;
    }

    const leaveAllowanceDays = enteredAllowance(leave.value);

    if (leaveAllowanceDays === null) {
      setFailure({ member: member.id, raised: { code: MEMBER_WRITE_INVALID, saved: false } });
      setInvalidField(leave.id);
      leave.focus();

      return;
    }

    saving.current = true;
    setFailure(null);
    setInvalidField(null);
    setSaved(null);
    setPending(true);

    try {
      const outcome = await saveMember(
        supabaseClient().from(MEMBERS_TABLE),
        supabaseClient().functions as MemberFunctions,
        member,
        {
          name: name.value,
          email: storedEmail(email.value),
          role: chosenRole(role.value),
          leaveAllowanceDays,
          username: username.value,
          // ONLY WHILE THE CONTROL IS OFFERED. Absent, the PATCH leaves the
          // stored rank alone: the setting hides ranks and never deletes them.
          ...rankEditOf(member.fireRank, rank?.value ?? null, offersRank),
        },
      );

      // THE OUTCOME FIRST, AND THE CACHE AFTER. `invalidateQueries` awaits the
      // refetch and so REJECTS when the browser is offline or the session has
      // just expired — and with the refetch first that rejection jumped to the
      // catch below and replaced the specific refusal with the generic one,
      // destroying the `saved: true` fact that says four fields really did
      // reach the database. That is the partial save reported and then thrown
      // away by a failure that has nothing to do with it.
      if (outcome.ok) setSaved({ member: member.id, raised: true });
      else setFailure({ member: member.id, raised: outcome.refusal });

      // INVALIDATED ON BOTH OUTCOMES, and the failing one is the reason. A
      // refused RENAME still wrote the four ordinary fields, so a cache left
      // alone would show the old values beside a message saying they were
      // saved — which is the partial save reported and then contradicted. Its
      // own failure is ISOLATED for the reason above.
      try {
        await queryClient.invalidateQueries({ queryKey: MEMBERS_LIST_KEY });
      } catch (cause) {
        console.error(MEMBER_WRITE_UNAVAILABLE, cause);
      }
    } catch (cause) {
      console.error(MEMBER_WRITE_UNAVAILABLE, cause);
      setFailure({ member: member.id, raised: { code: MEMBER_WRITE_UNAVAILABLE, saved: false } });
    } finally {
      // On EVERY path, including the successful one.
      saving.current = false;
      setPending(false);
    }
  }

  return {
    // The form.
    nameField,
    usernameField,
    emailField,
    leaveField,
    roleField,
    rankField,
    pending,
    invalidField,
    form,
    refusal,
    confirmed,
    offersRank,
    submit,
    // The password reset.
    armedFor,
    credential,
    stage,
    setArmed,
    setIssued,
    issue,
    // The status block.
    dateField,
    offer,
    statusArmedFor,
    statusConfirmed,
    statusRefusal,
    statusStage,
    setStatusArmed,
    armStatus,
    changeStatus,
    // The team block.
    teamDateField,
    positionField,
    today,
    offersPosition,
    positionsRefusal,
    teamsState,
    teamOffer,
    teamArmedFor,
    teamConfirmed,
    teamRefusal,
    teamStage,
    pickedTeam,
    setTeamArmed,
    armTeam,
    pickTeam,
    changeTeam,
  };
}

/** Everything the member edit screen's cards read, as the hook returns it. */
export type MemberEdit = ReturnType<typeof useMemberEdit>;
