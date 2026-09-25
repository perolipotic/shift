import {
  ArrowLeft,
  AtSign,
  CalendarClock,
  CalendarDays,
  Mail,
  Medal,
  Save,
  ShieldCheck,
  User,
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createRoute, redirect } from '@tanstack/react-router';
import {
  Fragment,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type ReactNode,
} from 'react';

import { Button } from '@/components/ui/button';
import { Callout, CalloutBody } from '@/components/ui/callout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { IconTile } from '@/components/ui/icon-tile';
import { ConfirmDialog, DialogFooter } from '@/components/ui/dialog';
import { PageHeader, PageTitle } from '@/components/ui/page-header';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupIcon } from '@/components/ui/input-group';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import { t } from '@/i18n';
import {
  MEMBERS_LIST_KEY,
  MEMBERS_TABLE,
  NO_TEXT,
  mayReadMembers,
  memberLevelMessageKey,
  membersSurfaceStateOf,
  membersTodayOf,
  membersQueryOptions,
  shownDate,
  type MemberListRow,
} from '@/members/list';
import {
  LEAVE_ALLOWANCE_MAX,
  MEMBER_STATUS_TABLE,
  MEMBER_TEAM_STALE,
  MEMBER_TEAM_TABLE,
  MEMBER_WRITE_INVALID,
  MEMBER_WRITE_UNAVAILABLE,
  MESSAGE_SEPARATOR,
  NO_TEAM_VALUE,
  RESET_ARMED,
  RESET_BUSY,
  RESET_IDLE,
  RESET_SHOWN,
  SESSION_SUBJECT_KEY,
  STATUS_ARMED,
  STATUS_BUSY,
  STATUS_IDLE,
  TEAM_MOVE,
  WITHDRAW,
  changeMemberStatus,
  changeMemberTeam,
  chosenTeam,
  chosenRole,
  enteredAllowance,
  memberFormKey,
  memberFormRefusalOf,
  memberWriteMessageKeys,
  offersPositionFor,
  pickedTeamValue,
  teamCurrentLineOf,
  teamOfferFor,
  teamPickHistory,
  teamPositionToSend,
  teamPositionsOn,
  teamPositionsRefusalOf,
  teamPositionsSettingOf,
  teamRefusalRereadsOrganization,
  teamScheduledLineOf,
  teamSelectKey,
  positionPickerDefault,
  raisedForMember,
  readSessionSubject,
  resetPassword,
  resetStageOf,
  saveMember,
  standingConfirmation,
  standingTeamConfirmation,
  statusBlockKey,
  statusConfirmMessageKey,
  statusOfferMessageKey,
  statusOfferOf,
  statusPreflightOf,
  statusPromptKeyOf,
  statusScheduledMessageKey,
  statusSinceOf,
  statusStageOf,
  statusTodayMessageKey,
  storedEmail,
  teamBlockKey,
  teamConfirmMessageKey,
  teamOfferMessageKey,
  teamPickerDefault,
  teamPreflightOf,
  teamPromptKeyOf,
  type RaisedForMember,
  type MemberFunctions,
  type MemberWriteRefusal,
  type ResetCredential,
  type StatusConfirmation,
  type StatusOffer,
  type TeamConfirmation,
  type TeamOffer,
  type TeamPick,
} from '@/members/write';
import { positionMessageKey, positionOptionsFor } from '@/members/position';
import {
  rankEditOf,
  rankInitialValue,
  rankMessageKey,
  rankOptionsFor,
  rankValue,
  ranksShown,
} from '@/members/rank';
import { DESTINATIONS } from '@/navigation/destinations';
import { MEMBER_ROLES, MEMBER_ROLE_UNAVAILABLE, type MemberRoleOutcome } from '@/navigation/role';
import {
  ORGANIZATION_READ_STALE_MS,
  ORGANIZATION_SNAPSHOT_KEY,
  ORGANIZATION_TABLE,
  readOrganization,
} from '@/organization/snapshot';
import { appLayoutRoute } from '@/routes/_app';
import { currentSession, supabaseClient } from '@/supabase/client';
import {
  TEAMS_LIST_KEY,
  TEAMS_TABLE,
  teamsQueryOptions,
  splitTeams,
  teamsMessageKey,
  teamsSurfaceStateOf,
  writableTeamsOf,
} from '@/teams/list';

/**
 * `/ljudi/$id` — an admin edits one member (story 1.5b).
 *
 * THE CENTRAL BRANCH IS NOT HERE, and that is deliberate: whether this save
 * reaches the privileged function at all is `saveMember`'s decision, in
 * `@/members/write`, where a test executes it. Written here it would be an `if`
 * nothing runs — and it is the one branch that decides whether the secret-key
 * boundary is touched, so "executed by nothing" is not a cost this screen may
 * carry. Most edits are an ordinary PostgREST PATCH, because
 * `members_update_by_own_active_admin` already admits an active admin to every
 * column of every row in their organization.
 *
 * ONE READ, UNDER THE LIST'S OWN KEY (AD-13). The member being edited comes out
 * of `MEMBERS_LIST_KEY` rather than from a second read of one row: a second key
 * is how a form seeded from one answer saves over a row another answer
 * described, and the list is already in cache on every path that reaches this
 * screen. `memberFormRefusalOf` is what turns that one answer into "this member",
 * "still loading", or "there is nothing here to edit".
 *
 * THE FORM REMOUNTS WITH THE ROW. Every field is uncontrolled, so its
 * `defaultValue` seeds the DOM at MOUNT and never again — and this screen
 * refetches after every successful save. Without `key={memberFormKey(member)}`
 * the fields would still show what the row held when the screen opened, and
 * `Odustani`, which is `type="reset"`, would snap them back to that stale state.
 * `organizacija.tsx` keys its accent `<select>` for exactly this reason; here
 * the whole form takes the key, because every field has the problem.
 *
 * THIS IS NOT A DESTINATION, so `type="reset"` is not an exit — it restores the
 * fields. The way back to the list is a link that says so.
 *
 * THE PASSWORD RESET IS OUTSIDE THE `<form>`, deliberately. Inside the actions
 * grid a `<Button>` submits — that is what a button in a form does — so the
 * offer would save the edit instead of resetting anything; and
 * `key={memberFormKey(member)}` remounts that subtree after every refetch,
 * which would wipe a credential the admin has not finished reading. It is its
 * own block between the form and the way back, and every piece of its state is
 * scoped through `raisedForMember` so an armed confirmation or a shown password
 * cannot cross from one member's screen to another's.
 *
 * WHICH OF ITS FOUR STAGES IS SHOWING IS `resetStageOf`'s DECISION, in
 * `@/members/write`, where a test executes it. Written here it would be the
 * branch nothing runs — and the in-flight stage is the one that gets written
 * wrong, because clearing `armed` before awaiting renders the plain ENABLED
 * offer for the whole request.
 *
 * DEACTIVATION IS THE THIRD BLOCK (story 1.6), between the reset and the way
 * back, with its own ref, pending flag and armed confirmation. It is a plain
 * PostgREST insert of a status version — never the privileged function — and
 * every rule of it is `0008`'s insert policy. What it offers, whether it
 * renders at all (never on the caller's own row), which stage shows and what a
 * refusal is called are all `@/members/write`'s decisions. The date control
 * defaults to, and may not go below, the ORGANIZATION's today; it stays mounted
 * through the confirmation, so a refusal keeps the date that was entered.
 *
 * THE TEAM IS THE FOURTH BLOCK (story 1.7b), after the status, on the same
 * shape: its own ref, pending flag, armed confirmation and refusal; a plain
 * PostgREST insert of a membership version or the delete of the scheduled one;
 * every rule `0010`'s policies. Unlike the status block it IS offered on the
 * caller's own row. The picker reads the teams under `TEAMS_LIST_KEY`, active
 * ones only; the team and date controls are uncontrolled and stay mounted
 * through the confirmation, so a refusal keeps both.
 *
 * TEAM POSITION joins the team block while the organization uses fire ranks
 * and positions: a position `<select>` beside the team, shown only while a
 * team (not "no team") is picked, and the current team stays choosable so a
 * position-only change can be made. The team pick is held in state only so
 * the position control can follow it — its visibility and its default are
 * `@/members/write`'s decisions. With the setting off nothing here renders and
 * the write carries a null position.
 */

/** Where a session that is not an administrator's is sent. The FIRST
 *  destination, read off the table — the same answer `/` and `/ljudi` give. */
const FIRST_DESTINATION = DESTINATIONS[0];

/** `0002:145` — the column is `smallint not null check (>= 0)`, bounded above
 *  by what a `smallint` can hold: past that the database answers `22003`, a
 *  refusal about a storage type rather than about a value. */
const ALLOWANCE_MINIMUM = 0;
const ALLOWANCE_STEP = 1;

export function LjudiMemberScreen() {
  const queryClient = useQueryClient();
  const { id } = ljudiMemberRoute.useParams();
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
  // TEAM POSITION: the same setting, as `@/members/write` reads it — on, off,
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
  // FOUR STAGES FROM THREE INPUTS, decided in `@/members/write` where a test
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
    // `null` while no position control is shown; decided in `@/members/write`.
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

  /**
   * The form, a skeleton, or nothing at all.
   *
   * A FUNCTION rather than a conditional inside the returned JSX, for the reason
   * `organizacija.tsx`'s `renderSettings` is one: `eslint.config.js`'s L2 block
   * refuses a string literal inside a branch nested in a branch that is an
   * element's own child.
   *
   * NO FORM ONCE THE READ HAS SETTLED FAILED, and none when the id reaches
   * nobody: a form seeded from nothing saves its defaults over a person's
   * record, which is worse than no form at all.
   */
  function renderForm(member: MemberListRow): ReactNode {
    return (
      <form
        key={memberFormKey(member)}
        method="post"
        onSubmit={(event) => {
          void submit(event);
        }}
        className="grid gap-6"
      >
        <h2 className="text-base font-bold">{t('ljudi.form.sectionBasics')}</h2>
        <div className="grid gap-2">
          <Label htmlFor="member-name">{t('ljudi.name')}</Label>
          <InputGroup>
            <InputGroupIcon>
              <User />
            </InputGroupIcon>
            <Input
              ref={nameField}
              id="member-name"
              name="name"
              type="text"
              required
              defaultValue={member.name}
              aria-describedby={refusal === null ? undefined : 'member-form-error'}
              className="h-11"
            />
          </InputGroup>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="member-username">{t('ljudi.form.username')}</Label>
          {/* THE ONE FIELD THAT CAN REACH THE PRIVILEGED BOUNDARY. Changing it
              moves `auth.users.email` as well as `members.username`, which is
              the one thing row level security cannot do — `saveMember` decides
              that, not this element. */}
          <InputGroup>
            <InputGroupIcon>
              <AtSign />
            </InputGroupIcon>
            <Input
              ref={usernameField}
              id="member-username"
              name="username"
              type="text"
              autoCapitalize="none"
              autoCorrect="off"
              required
              defaultValue={member.username}
              aria-describedby={refusal === null ? undefined : 'member-form-error'}
              className="h-11"
            />
          </InputGroup>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="member-email">{t('ljudi.email')}</Label>
          {/* OPTIONAL (CAP-1, `0002:135`): a member with no address is still a
              member. An emptied field stores `null`, never an empty string. */}
          <InputGroup>
            <InputGroupIcon>
              <Mail />
            </InputGroupIcon>
            <Input
              ref={emailField}
              id="member-email"
              name="email"
              type="email"
              autoCapitalize="none"
              autoCorrect="off"
              defaultValue={member.email ?? NO_TEXT}
              aria-describedby={refusal === null ? undefined : 'member-form-error'}
              className="h-11"
            />
          </InputGroup>
        </div>
        <h2 className="border-t pt-6 text-base font-bold">{t('ljudi.form.sectionSettings')}</h2>
        <div className="grid gap-6 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="member-role">{t('ljudi.role')}</Label>
            {/* Demoting the last administrator of an organization is refused by
                `0002:242-246`'s deferred trigger AT COMMIT, not here: the control
                can express it and the database is what says no, which is the same
                division every other refusal on this surface follows. */}
            <InputGroup>
              <InputGroupIcon>
                <ShieldCheck />
              </InputGroupIcon>
              <select
                ref={roleField}
                id="member-role"
                name="role"
                defaultValue={member.role}
                aria-describedby={refusal === null ? undefined : 'member-form-error'}
                className="flex h-11 w-full rounded-md border-[1.5px] border-input bg-card px-3 text-sm transition-[border-color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
              >
                {MEMBER_ROLES.map((option) => (
                  <option key={option} value={option}>
                    {t(memberLevelMessageKey(option))}
                  </option>
                ))}
              </select>
            </InputGroup>
          </div>
          {offersRank ? renderRank(member) : null}
        </div>
        <div className="grid gap-2">
          <Label htmlFor="member-leave">{t('ljudi.leave')}</Label>
          <InputGroup>
            <InputGroupIcon>
              <CalendarDays />
            </InputGroupIcon>
            <Input
              ref={leaveField}
              id="member-leave"
              name="leaveAllowanceDays"
              type="number"
              min={ALLOWANCE_MINIMUM}
              max={LEAVE_ALLOWANCE_MAX}
              step={ALLOWANCE_STEP}
              aria-invalid={invalidField === 'member-leave'}
              required
              defaultValue={member.leaveAllowanceDays}
              aria-describedby={refusal === null ? undefined : 'member-form-error'}
              className="h-11"
            />
          </InputGroup>
        </div>
        <div className="grid gap-2 border-t pt-6 sm:grid-cols-2">
          <Button className="h-11 w-full" type="submit" disabled={pending} aria-busy={pending}>
            <Save aria-hidden />
            {t('ljudi.form.save')}
          </Button>
          <Button className="h-11 w-full" type="reset" variant="outline" disabled={pending}>
            {t('ljudi.form.cancel')}
          </Button>
        </div>
      </form>
    );
  }

  /**
   * The rank control, offered only while the organization uses ranks.
   *
   * Seeded from the row. A stored code this build lacks is offered as its own
   * "unknown rank" option, so the control describes the row honestly and a
   * save that does not touch it sends back what the row holds.
   */
  function renderRank(member: MemberListRow): ReactNode {
    return (
      <div className="grid gap-2">
        <Label htmlFor="member-rank">{t('ljudi.rank.label')}</Label>
        <InputGroup>
          <InputGroupIcon>
            <Medal />
          </InputGroupIcon>
          <select
            ref={rankField}
            id="member-rank"
            name="fireRank"
            defaultValue={rankInitialValue(member.fireRank)}
            aria-describedby={refusal === null ? undefined : 'member-form-error'}
            className="flex h-11 w-full rounded-md border-[1.5px] border-input bg-card px-3 text-sm transition-[border-color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            {rankOptionsFor(member.fireRank).map((option) => (
              <option key={rankValue(option)} value={rankValue(option)}>
                {t(rankMessageKey(option))}
              </option>
            ))}
          </select>
        </InputGroup>
      </div>
    );
  }

  /**
   * The reset, at whichever of its four stages it is.
   *
   * A FUNCTION rather than a conditional inside the returned JSX, for the
   * reason `renderForm` is one: `eslint.config.js`'s L2 block refuses a string
   * literal inside a branch nested in a branch that is an element's own child.
   *
   * THE SHOWN CREDENTIAL IS TESTED FIRST, above every gate on the read. This
   * inverts the rule the rest of the screen follows and it is deliberate:
   * everything else here can be recovered by looking again, and the password
   * cannot. Returning `null` when the row is absent — the ordinary gate, one
   * line higher — erases the only copy on the next refetch.
   */
  function renderReset(): ReactNode {
    if (stage === RESET_SHOWN && credential !== null) return renderIssued(credential);
    // ARMED AND BUSY ARE ONE ELEMENT IN TWO STATES, which is why they share a
    // branch: the confirmation has to stay MOUNTED across the request, and a
    // separate busy branch is how it stops being the same element and remounts.
    if ((stage === RESET_ARMED || stage === RESET_BUSY) && armedFor !== null) {
      return renderConfirmation(armedFor);
    }
    // THE OFFER IS REACHED ONLY THROUGH `RESET_IDLE`, and reading the stage
    // here rather than re-deriving `armedFor !== null` one line up is the whole
    // point of the decision being a function. Re-derived, the screen holds a
    // second, unexecuted copy of the rule — and the copy disagrees: with a
    // request in flight and the armed flag already cleared, `resetStageOf`
    // answers `busy` while `armedFor !== null` answers "render the plain,
    // ENABLED offer". `write.test.ts` pins that exact combination, and the
    // screen was the half the pin could not reach.
    //
    // Only now does the row matter: with nothing read there is nobody to offer
    // a reset for, and an offer over a blank name is a control that cannot say
    // what it would do.
    const member = stage === RESET_IDLE ? form.member : null;

    if (member === null) return null;

    return (
      <div className="grid gap-2">
        {/* ITS ACCESSIBLE NAME CARRIES THE MEMBER, for the reason the list's row
            action does: several screens' worth of identically named controls is
            what a screen-reader user cannot tell apart — and here the control
            replaces somebody's credential. */}
        <Button
          className="h-11 w-full"
          type="button"
          variant="outline"
          onClick={() => {
            setArmed({ member: member.id, raised: member.name });
          }}
        >
          {t('ljudi.form.reset', { name: member.name })}
        </Button>
      </div>
    );
  }

  /**
   * The confirmation, and the busy state it keeps carrying.
   *
   * ONE PRESS RESETS NOTHING. The offer arms this; only the confirm below sends
   * anything, and it names the member so the second press is a distinct, more
   * specific decision rather than the same press twice.
   *
   * IT STAYS MOUNTED WHILE THE REQUEST IS OUTSTANDING, disabled and
   * `aria-busy`. The offer does not come back underneath it, so there is no
   * moment at which an enabled control could start a second reset.
   */
  function renderConfirmation(name: string): ReactNode {
    const busy = stage === RESET_BUSY;

    // IN A MODAL (design refresh C), open for as long as it is rendered: the
    // armed state is the screen's as before, and Escape or the backdrop cancel
    // except while the request is outstanding.
    return (
      <ConfirmDialog
        busy={busy}
        onCancel={() => {
          setArmed(null);
        }}
        aria-labelledby="member-reset-prompt"
      >
        <p id="member-reset-prompt" className="text-sm font-medium">
          {t('ljudi.form.resetPrompt', { name })}
        </p>
        <DialogFooter>
          <Button
            className="h-11"
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => {
              setArmed(null);
            }}
          >
            {t('ljudi.form.resetCancel')}
          </Button>
          <Button
            className="h-11"
            type="button"
            disabled={busy}
            aria-busy={busy}
            onClick={() => {
              void issue();
            }}
          >
            {t('ljudi.form.resetConfirm', { name })}
          </Button>
        </DialogFooter>
      </ConfirmDialog>
    );
  }

  /**
   * The new credential, shown once.
   *
   * `role="status"` AND NOT `role="alert"`: the assertive region on this screen
   * belongs to the refusal, and a second one would be a second thing competing
   * to be announced.
   *
   * THE DISMISS IS THE ONLY WAY OUT, and it is what makes a second reset
   * possible at all — a panel that could not be cleared would block the one
   * recovery route an account with no address has, for as long as the screen
   * stayed open.
   */
  function renderIssued(shown: ResetCredential): ReactNode {
    return (
      <div className="grid gap-4">
        <Notice role="status">
          {t('ljudi.form.resetIssued')}
        </Notice>
        <div className="grid gap-2">
          {/* ITS OWN LABEL, never the create form's `Početna lozinka`: this is
              not an initial credential and calling it one would be wrong on the
              one screen where the distinction decides what somebody writes
              down. */}
          <p className="text-sm text-muted-foreground">{t('ljudi.form.resetCredential')}</p>
          {/* DATA, never a key. `break-all font-mono` is what makes a generated
              string readable aloud off a phone. */}
          <p className="break-all font-mono text-base">{shown.password}</p>
        </div>
        <p className="text-sm font-medium">{t('ljudi.form.credentialOnce')}</p>
        <Button
          className="h-11 w-full"
          type="button"
          variant="outline"
          onClick={() => {
            setIssued(null);
          }}
        >
          {t('ljudi.form.resetDismiss')}
        </Button>
      </div>
    );
  }

  /**
   * The status block: today's status, the change scheduled after it, and the
   * one thing offered — a change from a date, or the scheduled change's
   * cancellation — or its confirmation.
   *
   * ABSENT ON THE CALLER'S OWN ROW, and while the organization's today or the
   * caller's identity is unknown — `statusOfferOf`'s decision.
   *
   * THE DATE CONTROL STAYS MOUNTED across every stage, disabled while a
   * confirmation stands, so a refused change returns to the offer with the date
   * that was entered still in it. The block is keyed to the member's history,
   * so it remounts — and the date returns to the new minimum — only once a
   * version lands.
   */
  function renderStatus(): ReactNode {
    const member = form.member;

    if (member === null || offer === null) return null;

    const idle = statusStage === STATUS_IDLE;
    const { status } = offer;

    return (
      <div key={statusBlockKey(member)} className="grid gap-2">
        <p className="text-sm font-medium">
          {t(statusTodayMessageKey(status.activeToday), {
            date: shownDate(statusSinceOf(status, offer.today)),
          })}
        </p>
        {/* A SCHEDULED CHANGE STANDS OUT (design refresh C): it is the one
            line here about the future, so it sits in a callout of its own. */}
        {status.scheduled === null ? null : (
          <Callout>
            <CalloutBody>
              <IconTile variant="primary">
                <CalendarClock />
              </IconTile>
              <p className="self-center text-sm font-medium">
                {t(statusScheduledMessageKey(status.scheduled.active), {
                  date: shownDate(status.scheduled.effectiveFrom),
                })}
              </p>
            </CalloutBody>
          </Callout>
        )}
        {statusRefusal === null ? null : (
          <Notice id="member-status-error" role="alert">
            {memberWriteMessageKeys(statusRefusal)
              .map((key) => t(key))
              .join(MESSAGE_SEPARATOR)}
          </Notice>
        )}
        {renderStatusDate(offer, idle)}
        {idle ? renderStatusOffer(member, offer) : renderStatusConfirmation()}
        {statusConfirmed ? (
          <Notice role="status">
            {t('ljudi.status.saved')}
          </Notice>
        ) : null}
      </div>
    );
  }

  /**
   * The date control, for the two changes that take one. A cancellation names
   * the scheduled version's own date and offers no control.
   *
   * DESCRIBED BY THE STATUS BLOCK'S OWN ALERT and by nothing else: the form's
   * refusal is about other fields, and pointing this control at it would read
   * an unrelated error out as the reason the date was refused.
   */
  function renderStatusDate(offered: StatusOffer, idle: boolean): ReactNode {
    if (offered.change === WITHDRAW) return null;

    return (
      <>
        <Label htmlFor="member-status-date">{t('ljudi.status.date')}</Label>
        <Input
          ref={dateField}
          id="member-status-date"
          name="effectiveFrom"
          type="date"
          required
          min={offered.minimum}
          defaultValue={offered.minimum}
          disabled={!idle}
          aria-describedby={statusRefusal === null ? undefined : 'member-status-error'}
          className="h-11"
        />
      </>
    );
  }

  /** The offer, naming the member it acts on. One press sends nothing. */
  function renderStatusOffer(member: MemberListRow, offered: StatusOffer): ReactNode {
    return (
      <Button
        className="h-11 w-full"
        type="button"
        variant="outline"
        onClick={() => {
          armStatus(member, offered);
        }}
      >
        {t(statusOfferMessageKey(offered.change), { name: member.name })}
      </Button>
    );
  }

  /**
   * The confirmation, naming the member and the date, and the busy state it
   * keeps carrying while the write is outstanding.
   */
  function renderStatusConfirmation(): ReactNode {
    if (statusArmedFor === null || offer === null) return null;

    const busy = statusStage === STATUS_BUSY;
    const armedName = statusArmedFor.name;

    // IN A MODAL (design refresh C), open for as long as it is rendered: the
    // armed state is the screen's as before, and Escape or the backdrop cancel
    // except while the write is outstanding.
    return (
      <ConfirmDialog
        busy={busy}
        onCancel={() => {
          setStatusArmed(null);
        }}
        aria-labelledby="member-status-prompt"
      >
        <p id="member-status-prompt" className="text-sm font-medium">
          {t(statusPromptKeyOf(statusArmedFor, offer.today), {
            name: armedName,
            date: shownDate(statusArmedFor.day),
          })}
        </p>
        <DialogFooter>
          <Button
            className="h-11"
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => {
              setStatusArmed(null);
            }}
          >
            {t('ljudi.status.cancel')}
          </Button>
          <Button
            className="h-11"
            type="button"
            disabled={busy || statusStage !== STATUS_ARMED}
            aria-busy={busy}
            onClick={() => {
              void changeStatus();
            }}
          >
            {t(statusConfirmMessageKey(statusArmedFor.change), { name: armedName })}
          </Button>
        </DialogFooter>
      </ConfirmDialog>
    );
  }

  /**
   * The team block: the team today, the move scheduled after it, and the one
   * thing offered — a move from a date, or the scheduled move's cancellation —
   * or its confirmation. No team is said in words (`Bez smjene`).
   *
   * THE PICKER AND THE DATE STAY MOUNTED across every stage, disabled while a
   * confirmation stands, so a refused move returns to the offer with both
   * still as entered. Keyed to the member's team history.
   */
  function renderTeam(): ReactNode {
    const member = form.member;

    if (member === null || today === null) return null;

    const idle = teamStage === STATUS_IDLE;
    // STATED EVEN WHEN NOTHING IS OFFERED — no teams to move onto, or the
    // teams unread — so the member's team is never left unsaid.
    // Both lines, and which sentence each is, are `@/members/write`'s: the
    // position only while shown, and a scheduled change that keeps the team
    // never worded as a move onto it.
    const current = teamCurrentLineOf(member, today, offersPosition);
    const scheduled = teamScheduledLineOf(member, today, offersPosition);

    return (
      <div key={teamBlockKey(member)} className="grid gap-2">
        <p className="text-sm font-medium">
          {t(current.key, {
            team: current.team ?? t('smjene.membership.none'),
            position: current.position === null ? NO_TEXT : t(positionMessageKey(current.position)),
          })}
        </p>
        {/* A SCHEDULED CHANGE STANDS OUT (design refresh C), as on the
            status card: the list marks the same change in the team cell. */}
        {scheduled === null ? null : (
          <Callout>
            <CalloutBody>
              <IconTile variant="primary">
                <CalendarClock />
              </IconTile>
              <p className="self-center text-sm font-medium">
                {t(scheduled.key, {
                  date: shownDate(scheduled.date ?? NO_TEXT),
                  team: scheduled.team ?? NO_TEXT,
                  position:
                    scheduled.position === null ? NO_TEXT : t(positionMessageKey(scheduled.position)),
                })}
              </p>
            </CalloutBody>
          </Callout>
        )}
        {positionsRefusal === null ? null : (
          <Notice role="alert">
            {memberWriteMessageKeys({ code: positionsRefusal, saved: false })
              .map((key) => t(key))
              .join(MESSAGE_SEPARATOR)}
          </Notice>
        )}
        {teamsState.refusal === null ? null : (
          <Notice role="alert">
            {t(teamsMessageKey(teamsState.refusal))}
          </Notice>
        )}
        {teamRefusal === null ? null : (
          <Notice id="member-team-error" role="alert">
            {memberWriteMessageKeys(teamRefusal)
              .map((key) => t(key))
              .join(MESSAGE_SEPARATOR)}
          </Notice>
        )}
        {/* AN ARMED OR PENDING CONFIRMATION OUTLIVES ITS OFFER: a refetch that
            empties the offer mid-write must not take the busy state with it. */}
        {teamOffer === null
          ? renderTeamConfirmation(today)
          : renderTeamControls(member, teamOffer, idle, today)}
        {teamConfirmed ? (
          <Notice role="status">
            {t('smjene.membership.saved')}
          </Notice>
        ) : null}
      </div>
    );
  }

  /** The picker and date for a move, then the offer or its confirmation. */
  function renderTeamControls(
    member: MemberListRow,
    offered: TeamOffer,
    idle: boolean,
    today: string,
  ): ReactNode {
    return (
      <>
        {renderTeamPicker(offered, idle)}
        {idle ? renderTeamOffer(member, offered) : renderTeamConfirmation(today)}
      </>
    );
  }

  /**
   * The team `<select>` and the date, for a move. A cancellation names the
   * scheduled version's own date and offers neither. Described by the team
   * block's own alert and by nothing else.
   */
  function renderTeamPicker(offered: TeamOffer, idle: boolean): ReactNode {
    if (offered.change !== TEAM_MOVE) return null;

    return (
      <>
        <Label htmlFor="member-team">{t('smjene.membership.team')}</Label>
        <select
          key={teamSelectKey(offered)}
          id="member-team"
          name="team"
          defaultValue={teamPickerDefault(offered)}
          disabled={!idle}
          onChange={pickTeam}
          aria-describedby={teamRefusal === null ? undefined : 'member-team-error'}
          className="flex h-11 w-full rounded-md border-[1.5px] border-input bg-card px-3 text-sm transition-[border-color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          {offered.choices.map((choice) => (
            <option key={choice.id} value={choice.id}>
              {choice.name}
            </option>
          ))}
          {offered.offersNoTeam ? (
            <option value={NO_TEAM_VALUE}>{t('smjene.membership.none')}</option>
          ) : null}
        </select>
        {renderPositionPicker(offered, idle)}
        <Label htmlFor="member-team-date">{t('smjene.membership.date')}</Label>
        <Input
          ref={teamDateField}
          id="member-team-date"
          name="teamEffectiveFrom"
          type="date"
          required
          min={offered.minimum}
          defaultValue={offered.minimum}
          disabled={!idle}
          aria-describedby={teamRefusal === null ? undefined : 'member-team-error'}
          className="h-11"
        />
      </>
    );
  }

  /**
   * The position `<select>`, only while positions are offered and a team is
   * picked. KEYED TO THE PICKED TEAM, so picking another team reopens it on
   * that team's default: the current position for the member's own team, the
   * default position for a move. Described by the team block's own alert.
   */
  function renderPositionPicker(offered: TeamOffer, idle: boolean): ReactNode {
    if (offered.change !== TEAM_MOVE || !offersPositionFor(offered, pickedTeam)) return null;

    const stored = pickedTeam === offered.current?.id ? offered.currentPosition : null;

    return (
      <Fragment key={pickedTeam}>
        <Label htmlFor="member-position">{t('smjene.position.label')}</Label>
        <select
          ref={positionField}
          id="member-position"
          name="position"
          defaultValue={positionPickerDefault(offered, pickedTeam)}
          disabled={!idle}
          aria-describedby={teamRefusal === null ? undefined : 'member-team-error'}
          className="flex h-11 w-full rounded-md border-[1.5px] border-input bg-card px-3 text-sm transition-[border-color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          {positionOptionsFor(stored).map((option) => (
            <option key={option} value={option}>
              {t(positionMessageKey(option))}
            </option>
          ))}
        </select>
      </Fragment>
    );
  }

  /** The offer, naming the member it acts on. One press sends nothing. */
  function renderTeamOffer(member: MemberListRow, offered: TeamOffer): ReactNode {
    return (
      <Button
        className="h-11 w-full"
        type="button"
        variant="outline"
        onClick={() => {
          armTeam(member, offered);
        }}
      >
        {t(teamOfferMessageKey(offered.change), { name: member.name })}
      </Button>
    );
  }

  /**
   * The confirmation, naming the member, the team and the date. Its tense reads
   * TODAY AS IT IS NOW, the day the write will be judged against.
   */
  function renderTeamConfirmation(today: string): ReactNode {
    if (teamArmedFor === null) return null;

    const busy = teamStage === STATUS_BUSY;
    const armedName = teamArmedFor.name;

    // IN A MODAL (design refresh C), open for as long as it is rendered: the
    // armed state is the screen's as before, and Escape or the backdrop cancel
    // except while the write is outstanding.
    return (
      <ConfirmDialog
        busy={busy}
        onCancel={() => {
          setTeamArmed(null);
        }}
        aria-labelledby="member-team-prompt"
      >
        <p id="member-team-prompt" className="text-sm font-medium">
          {t(teamPromptKeyOf(teamArmedFor, today), {
            name: armedName,
            date: shownDate(teamArmedFor.day),
            team: teamArmedFor.team?.name ?? NO_TEXT,
            position:
              teamArmedFor.position === null ? NO_TEXT : t(positionMessageKey(teamArmedFor.position)),
          })}
        </p>
        <DialogFooter>
          <Button
            className="h-11"
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => {
              setTeamArmed(null);
            }}
          >
            {t('smjene.membership.cancel')}
          </Button>
          <Button
            className="h-11"
            type="button"
            disabled={busy || teamStage !== STATUS_ARMED}
            aria-busy={busy}
            onClick={() => {
              void changeTeam();
            }}
          >
            {t(teamConfirmMessageKey(teamArmedFor.change), { name: armedName })}
          </Button>
        </DialogFooter>
      </ConfirmDialog>
    );
  }

  function renderBody(): ReactNode {
    if (form.member !== null) return renderForm(form.member);

    return form.loading ? (
      <div className="h-11 w-full animate-pulse rounded-md bg-muted" />
    ) : null;
  }

  // Each block once, so its card is drawn only when it renders.
  const teamBlock = renderTeam();
  const statusBlock = renderStatus();
  const resetBlock = renderReset();

  return (
    <main className="mx-auto flex w-full min-w-0 max-w-5xl flex-1 flex-col gap-6 p-6">
      <PageHeader>
        <div className="grid min-w-0 justify-items-start gap-1">
          {/* THE WAY BACK, always rendered — including while the read is
              pending and after it has settled failed. A screen reachable only
              by URL that can be left only by the browser's Back button is a
              dead end. Above the title, where a way back is looked for
              (design refresh C). */}
          <Button asChild variant="ghost" className="-ml-3 h-11 px-3">
            <Link to="/ljudi">
              <ArrowLeft aria-hidden />
              {t('ljudi.form.back')}
            </Link>
          </Button>
          <PageTitle asChild>
            <h1>
              {t('ljudi.form.editHeading')}
            </h1>
          </PageTitle>
        </div>
      </PageHeader>
      <Card className="w-full min-w-0 max-w-2xl">
        {/* OUTSIDE the gated branch: a read that produced no row renders no
            form, so an explanation rendered inside one would be exactly the
            element nobody can see. */}
        <CardContent className="grid gap-6">
          {refusal === null ? null : (
            <Notice id="member-form-error" role="alert">
              {memberWriteMessageKeys(refusal)
                .map((key) => t(key))
                .join(MESSAGE_SEPARATOR)}
            </Notice>
          )}
          {/* THE ONLY THING THAT SAYS A SAVE LANDED. Every field is
              uncontrolled and remounts to the values it was just saved with, so
              without this a successful save leaves the screen looking exactly
              as it did before the press — indistinguishable from a click that
              did nothing. `role="status"` and not `role="alert"`: the assertive
              region belongs to the refusal, and a second one would be a second
              thing competing to be announced. */}
          {confirmed ? (
            <Notice role="status">
              {t('ljudi.form.saved')}
            </Notice>
          ) : null}
          {renderBody()}
        </CardContent>
      </Card>
      {/* EACH OTHER DECISION IN ITS OWN CARD (design refresh C), and every one
          outside the `<form>`: inside it a `<Button>` submits, and
          `key={memberFormKey(member)}` remounts that subtree on every refetch —
          which would wipe a credential nobody had finished reading. A card is
          drawn only around a block that renders, so none stands empty — the
          status block renders nothing on one's own row, for instance. */}
      {/* STORY 1.7b. */}
      {teamBlock === null ? null : (
        <Card className="w-full min-w-0 max-w-2xl">
          <CardHeader>
            <CardTitle asChild>
              <h2>{t('smjene.membership.column')}</h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">{teamBlock}</CardContent>
        </Card>
      )}
      {/* STORY 1.6. */}
      {statusBlock === null ? null : (
        <Card className="w-full min-w-0 max-w-2xl">
          <CardHeader>
            <CardTitle asChild>
              <h2>{t('ljudi.status.heading')}</h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">{statusBlock}</CardContent>
        </Card>
      )}
      {resetBlock === null ? null : (
        <Card className="w-full min-w-0 max-w-2xl">
          <CardHeader>
            <CardTitle asChild>
              <h2>{t('ljudi.form.passwordHeading')}</h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">{resetBlock}</CardContent>
        </Card>
      )}
    </main>
  );
}

export const ljudiMemberRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/ljudi/$id',
  /**
   * The same role guard `/ljudi` carries, copied VERBATIM — and
   * `router.test.ts` drives all three copies by execution rather than by
   * reading any of them. See `routes/ljudi.novi.tsx` for the whole argument;
   * the short version is that the reader arrives through the router context, so
   * every branch runs in the node suite with no environment at all, and a level
   * that cannot be read fails closed.
   */
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
  component: LjudiMemberScreen,
});
