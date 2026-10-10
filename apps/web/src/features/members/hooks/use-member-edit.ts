import { onlineManager, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from 'react';

import {
  CALENDAR_READ_TABLE,
  calendarQueryOptions,
  calendarSurfaceStateOf,
  type CalendarMembersRpc,
  type CalendarSnapshot,
} from '@/features/calendar/services/snapshot';

import { useErasureConfirmation, type ShownErasures } from '@/features/conflicts/hooks/use-erasure-confirmation';
import { useErasureReads } from '@/features/conflicts/hooks/use-erasure-reads';
import { CHECK_REFUSED, CHECK_UNAVAILABLE } from '@/features/conflicts/services/erasure-check';
import { RECHECK_CHANGED } from '@/features/conflicts/services/erasures';

import {
  MEMBERS_LIST_KEY,
  MEMBERS_TABLE,
  NO_TEXT,
  membersSurfaceStateOf,
  membersTodayOf,
  membersQueryOptions,
  type MemberListRow,
} from '@/features/members/services/list';
import { shownDeactivationConsequenceOf } from '@/features/members/services/deactivation-consequence';
import {
  memberErasureCheckOf,
  statusChangeOf,
  teamChangeOf,
  type MemberChange,
  type MemberChangeRefusal,
} from '@/features/members/services/member-erasures';
import {
  MEMBER_STATUS_STALE,
  MEMBER_STATUS_TABLE,
  MEMBER_TEAM_STALE,
  MEMBER_TEAM_TABLE,
  MEMBER_TEAM_UNPICKED,
  MEMBER_WRITE_INVALID,
  MEMBER_WRITE_UNAVAILABLE,
  NO_TEAM_VALUE,
  SESSION_SUBJECT_KEY,
  TEAM_UNPICKED_VALUE,
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
  teamPickRefusalOf,
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
  ALLOWANCE_SAVE,
  BASICS_SAVE,
  type MemberEdits,
  type MemberSaveScope,
  type MemberFunctions,
  type MemberWriteRefusal,
  type ResetCredential,
  type StatusConfirmation,
  type StatusOffer,
  type TeamConfirmation,
  type StatusChangeOffer,
  type TeamMoveOffer,
  type TeamOffer,
  type TeamPick,
} from '@/features/members/services/write';
import { dateMarkFor, dateMarked, type DateMark } from '@/features/members/utils/date-refusal';
import {
  MEMBER_PAGE_HEADING_ID,
  MEMBER_SIGN_IN_HEADING_ID,
  MEMBER_STATUS_HEADING_ID,
  MEMBER_TEAM_HEADING_ID,
} from '@/features/members/utils/element-ids';
import { rankEditOf, ranksShownIn } from '@/features/members/utils/rank';
import {
  ORGANIZATION_SNAPSHOT_KEY,
  ORGANIZATION_TABLE,
  organizationSnapshotQueryOptions,
} from '@/features/organization/services/snapshot';
import { currentSession, supabaseClient } from '@/lib/supabase/client';
import {
  MEMBERSHIP_WRITE_DEPENDENTS,
  MEMBER_SAVE_DEPENDENTS,
  NO_DEPENDENTS,
  refreshAfterWrite,
} from '@/features/teams/services/dependents';
import {
  TEAMS_LIST_KEY,
  TEAMS_TABLE,
  teamsQueryOptions,
  splitTeams,
  teamsSurfaceStateOf,
  writableTeamsOf,
} from '@/features/teams/services/list';
import { firstEnabledOf, focusLater } from '@/utils/focus-later';

/**
 * What a card's erasure check stood on (story 5.5e): the member it is about,
 * the card's own confirmation — so a re-check, a retry and the write still
 * have it once that confirmation has closed — and the change derived from it.
 */
export interface CheckedMemberChange<Confirmation> {
  readonly member: string;
  readonly confirmation: Confirmation;
  readonly change: MemberChange;
}

/**
 * One opening of a dialog (story 7.11): a fresh key, so each opening renders
 * its body anew from the record as it is now, and — for a dialog whose offer
 * can change under it — what it was opened on (`held`), so a re-read neither
 * relabels it nor remounts its controls under the admin's hand: an offer that
 * still stands keeps the dialog as it is, and one that is gone closes it.
 */
export interface DialogOpening<Held = null> {
  readonly key: number;
  readonly held: Held;
}

/** What the team dialog was opened on: the move offered, and the history it was offered against. */
export interface HeldTeamMove {
  readonly offer: TeamMoveOffer;
  readonly history: string;
  readonly name: string;
}

/** What the status dialog was opened on. */
export interface HeldStatusChange {
  readonly offer: StatusChangeOffer;
  readonly name: string;
}

/** The element whose id this is, for a focus that has nowhere better to go. */
function byId(id: string): () => HTMLElement | null {
  return () => document.getElementById(id);
}

/**
 * `/ljudi/$id`'s state, its four reads and its handlers (story 1.5b; facts
 * and dialogs since story 7.11). The page composes the header and the cards —
 * basics, team, leave (with the allowance's slot), status and sign-in — and
 * each card is a component in `@/features/members/components` that reads this
 * hook's result.
 *
 * THE READS. The member comes out of `MEMBERS_LIST_KEY` (AD-13) rather than a
 * second read of one row, and `memberFormRefusalOf` turns that one answer into
 * "this member", "still loading" or "nothing here". The organization is read
 * under the chrome's own key and cache policy, for the rank and position
 * settings; the session subject, so the status block is never offered on the
 * caller's own row; and the teams under `TEAMS_LIST_KEY`, for the picker.
 *
 * THE STATE. Every piece that is raised about a member — a refusal, an open
 * dialog, a confirmation, an issued credential — is scoped through
 * `raisedForMember`, because one component instance serves every row and
 * navigating between two members changes a route param, not the component.
 *
 * THE DIALOGS (story 7.11, the day detail's pattern from 7.9). Each card's
 * header button opens its own small dialog with one final button. The hook
 * owns whether it is open and the button that opened it (`basicsDialog`,
 * `allowanceDialog`, `teamDialog`, `statusDialog`); each opening renders a
 * fresh keyed body; while its write is pending it cannot be dismissed; a
 * refusal keeps it open with its alert above the buttons; a landed save
 * closes it, says so on the card and returns focus to the opener. A dialog
 * whose offer disappears on a re-read closes by itself, and the card says why.
 *
 * THE HANDLERS. Each write has its own in-flight ref, pending flag and
 * refusal, so no block's request disables another's controls: `submit` (the
 * basics and the allowance dialogs' one member write, `saveMember`), `issue`
 * (the password reset), `changeStatus` and `changeTeam`. The team and status
 * dialogs' Save is the old arm-then-confirm folded into one press — `armTeam`
 * / `armStatus` run the preflight, then `changeTeam` / `changeStatus` run the
 * erasure check and the write. Withdrawing a scheduled change keeps its card
 * button and its confirmation. Every rule any of them applies is a pure
 * function in `@/features/members/services/write`, where a test runs it.
 */
export function useMemberEdit(id: string) {
  const queryClient = useQueryClient();
  /** Counts openings, so every opening of any dialog gets a key of its own. */
  const openings = useRef(0);
  // THE MEMBER WRITE'S FIELDS: the basics dialog's five, and the allowance
  // dialog's one (`member-leave`). Only one of the two dialogs is open at once.
  const nameField = useRef<HTMLInputElement>(null);
  const usernameField = useRef<HTMLInputElement>(null);
  const emailField = useRef<HTMLInputElement>(null);
  const leaveField = useRef<HTMLInputElement>(null);
  const roleField = useRef<HTMLSelectElement>(null);
  const rankField = useRef<HTMLSelectElement>(null);
  const basicsOpener = useRef<HTMLButtonElement>(null);
  const allowanceOpener = useRef<HTMLButtonElement>(null);
  // A REF as well as state: state drives the disabled button, and state is
  // stale inside a handler already called once this tick.
  const saving = useRef(false);
  const [pending, setPending] = useState(false);
  const [basicsOpen, setBasicsOpen] = useState<RaisedForMember<DialogOpening> | null>(null);
  const [allowanceOpen, setAllowanceOpen] = useState<RaisedForMember<DialogOpening> | null>(null);
  // SCOPED TO THE MEMBER IT WAS RAISED ABOUT. One component instance serves
  // every row — navigating between two members changes a route param, not the
  // component — so unscoped state outlives the record it describes.
  const [failure, setFailure] = useState<RaisedForMember<MemberWriteRefusal> | null>(null);
  /** Which field a locally-detected refusal is about. See the create screen. */
  const [invalidField, setInvalidField] = useState<string | null>(null);
  /**
   * That a save landed, and on which card it is said: the dialog closed, so
   * the card it closed back onto says so. KEYED TO THE MEMBER it confirms.
   */
  const [saved, setSaved] = useState<RaisedForMember<MemberSaveScope> | null>(null);
  // THE RESET'S OWN STATE, and its own in-flight ref: sharing either with
  // another action would make one request disable the other's controls.
  const resetting = useRef(false);
  /** `Dodijeli novu lozinku`, where focus returns when the confirmation is cancelled or refused. */
  const resetOpener = useRef<HTMLButtonElement>(null);
  const [resetPending, setResetPending] = useState(false);
  /**
   * The armed confirmation, carrying the NAME it is about, so the
   * confirmation and the busy state stay truthful through a refetch that drops
   * the row underneath them.
   */
  const [armed, setArmed] = useState<RaisedForMember<string> | null>(null);
  /**
   * The issued credential, and THE ONLY COPY OF IT THERE IS. It survives a
   * refetch, a read that re-settles failed, and a row that vanishes, because
   * looking again cannot recover it. Cleared by the dismiss control and by
   * nothing else — and until it is, a second reset is impossible.
   */
  const [issued, setIssued] = useState<RaisedForMember<ResetCredential> | null>(null);
  /** Why the last reset did not land, said on the *Prijava* card. */
  const [resetFailure, setResetFailure] = useState<RaisedForMember<MemberWriteRefusal> | null>(null);
  // THE STATUS BLOCK'S OWN STATE and its own in-flight ref.
  const statusing = useRef(false);
  const dateField = useRef<HTMLInputElement>(null);
  const statusOpener = useRef<HTMLButtonElement>(null);
  const statusWithdrawButton = useRef<HTMLButtonElement>(null);
  const statusSaveButton = useRef<HTMLButtonElement>(null);
  const [statusPending, setStatusPending] = useState(false);
  const [statusOpen, setStatusOpen] = useState<RaisedForMember<DialogOpening<HeldStatusChange>> | null>(
    null,
  );
  /** The date the status dialog holds, so its question names it as it is typed. Keyed to the member. */
  const [statusDay, setStatusDay] = useState<RaisedForMember<string> | null>(null);
  /** The armed WITHDRAWAL of a scheduled change, carrying the name and the
   *  date it is about, so what is confirmed is exactly what is sent. */
  const [statusArmed, setStatusArmed] = useState<RaisedForMember<StatusConfirmation> | null>(
    null,
  );
  /** That a status change landed. Keyed to the member it confirms. */
  const [statusSaved, setStatusSaved] = useState<RaisedForMember<true> | null>(null);
  /** Why the last status change did not land. Keyed to the member. */
  const [statusFailure, setStatusFailure] =
    useState<RaisedForMember<MemberWriteRefusal> | null>(null);
  /** The date the last status refusal named, if it named one. */
  const [statusDateMark, setStatusDateMark] = useState<DateMark | null>(null);
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
  // THE ERASURE GUARD (story 5.5e), one per card: the retry of a check that
  // could not be derived, that refusal, how many conflicts a landed write
  // removed, and the erasure dialog itself — opened over the card's own
  // dialog, which keeps what was entered, so "Natrag na uređivanje" returns
  // to it.
  const readErasures = useErasureReads();
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
  const statusRetryButton = useRef<HTMLButtonElement>(null);
  const [statusUnchecked, setStatusUnchecked] = useState<RaisedForMember<true> | null>(null);
  const [statusErased, setStatusErased] = useState<RaisedForMember<number> | null>(null);
  const statusErasures = useErasureConfirmation<CheckedMemberChange<StatusConfirmation>>(statusPending, () =>
    firstEnabledOf<HTMLElement>(
      () => statusSaveButton.current,
      () => statusWithdrawButton.current,
      () => statusOpener.current,
    ),
  );

  const answer = useQuery(membersQueryOptions(() => supabaseClient().from(MEMBERS_TABLE)));
  // THE CALENDAR SNAPSHOT, observed under the leave card's own key and
  // arguments (`@/features/leave/hooks/use-member-leave`), for the
  // deactivation's consequence.
  const calendar = useQuery(
    calendarQueryOptions(
      () => supabaseClient().from(CALENDAR_READ_TABLE),
      // As the calendar's: the client's `rpc` is wider than the calls made.
      () => supabaseClient() as unknown as CalendarMembersRpc,
    ),
  );

  // MEMBER RANK. Whether the rank control is offered, read from the one
  // organization snapshot under its shared key (AD-13), through the chrome's
  // own factory and cache policy. Until it arrives the control is absent and
  // the save leaves the stored rank alone.
  const organization = useQuery(
    organizationSnapshotQueryOptions(() => supabaseClient().from(ORGANIZATION_TABLE)),
  );
  const offersRank = ranksShownIn(organization.data);
  // TEAM POSITION: the same setting — on, off, pending or failed. Until it is
  // KNOWN no move is offered, so no position is ever sent on a guess.
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
  // THE ORGANIZATION'S TODAY — the date controls' default and their minimum —
  // from the zone the one list read embeds.
  const today = membersTodayOf(organizationMembers, new Date());

  // TWO PURE FUNCTIONS AND NO BRANCH OF ITS OWN: the list's four states, then
  // "is this member in it". Both are pinned by execution in `write.test.ts`.
  const form = memberFormRefusalOf(membersSurfaceStateOf(answer), id);
  // THE SCREEN AS LAST DRAWN, read after an await (story 5.5e): an erasure
  // dialog's save is judged against these as they are then, never against
  // what the render that started it had captured.
  const latest = useRef({
    member: form.member,
    today,
    teams: allTeams,
    members: organizationMembers,
    caller: callerAuthUserId,
  });

  useEffect(() => {
    latest.current = { member: form.member, today, teams: allTeams, members: organizationMembers, caller: callerAuthUserId };
  });

  // The two erasure confirmations as last drawn, for the effect below.
  const erasureDialogs = useRef({ team: teamErasures, status: statusErasures });

  useEffect(() => {
    erasureDialogs.current = { team: teamErasures, status: statusErasures };
  });

  // ANOTHER MEMBER, or none: an erasure dialog was about the last one's
  // change, so it closes — once, when the route's member changes. So does
  // every other dialog, and the status dialog's date: scoped to their member,
  // they would otherwise open again, unprompted, on the way back (A → B → A).
  useEffect(() => {
    const { team, status } = erasureDialogs.current;

    if (team.shown !== null && team.shown.subject.member !== id) team.drop();
    if (status.shown !== null && status.shown.subject.member !== id) status.drop();
    setBasicsOpen(null);
    setAllowanceOpen(null);
    setTeamOpen(null);
    setStatusOpen(null);
    setStatusDay(null);
  }, [id]);
  // THE DIALOG'S REFUSAL, and the read's own, which the basics card says.
  const refusal = raisedForMember(failure, id);
  const readRefusal: MemberWriteRefusal | null =
    form.refusal === null ? null : { code: form.refusal, saved: false };
  const savedOn = raisedForMember(saved, id);
  const basicsOpening = raisedForMember(basicsOpen, id);
  const allowanceOpening = raisedForMember(allowanceOpen, id);
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
  // THE DATE IS MARKED INVALID only while the refusal that named it stands, on
  // the history it was named on, as the leave field is through `invalidField`.
  const statusDateInvalid = dateMarked(
    statusDateMark,
    statusRefusal,
    form.member === null ? null : statusBlockKey(form.member),
  );
  const statusStage = statusStageOf(statusArmedFor !== null, statusPending);
  const offer = form.member === null ? null : statusOfferOf(form.member, callerAuthUserId, today);
  /** The status dialog's offer: a deactivation or a reactivation from a date. */
  const statusOffer: StatusChangeOffer | null = offer !== null && offer.change !== WITHDRAW ? offer : null;
  const statusOpening = raisedForMember(statusOpen, id);
  // STILL OFFERED ONLY AS THE CHANGE IT WAS OPENED FOR: a re-read that offers
  // another change closes it rather than relabelling it under the admin's hand.
  const statusStillOffered =
    statusOpening !== null && statusOffer !== null && statusOffer.change === statusOpening.held.offer.change;
  // AN OUTSTANDING WRITE OUTLIVES ITS OFFER: the dialog stays, busy, until it settles.
  const statusDialogOpen = statusOpening !== null && (statusStillOffered || statusPending);
  const statusDayEntered = raisedForMember(statusDay, id) ?? NO_TEXT;
  // THE DEACTIVATION'S CONSEQUENCE IN NUMBERS (story 7.13c), from the calendar
  // snapshot the member page already reads under its one key and arguments
  // (the leave card's, `@/features/leave/hooks/use-member-leave`): no request
  // of its own, and nothing optimistic. `null` — a reactivation, a date before
  // the offer's minimum, no team — asks the question alone, and never gates
  // the save.
  //
  // HELD FOR THE OPENING (the Dialog rule: a re-read never redraws an open
  // dialog): the first snapshot seen while this opening is open, kept until it
  // closes — so the line stands through a refetch, while the write is pending
  // and after it lands, and a fresh opening reads afresh.
  const calendarSnapshot = calendarSurfaceStateOf(calendar).snapshot;
  const statusOpeningKey = statusDialogOpen ? statusOpening.key : null;
  const [heldCalendar, setHeldCalendar] = useState<{ readonly key: number; readonly snapshot: CalendarSnapshot } | null>(
    null,
  );

  if (statusOpeningKey === null) {
    if (heldCalendar !== null) setHeldCalendar(null);
  } else if (calendarSnapshot !== null && (heldCalendar === null || heldCalendar.key !== statusOpeningKey)) {
    setHeldCalendar({ key: statusOpeningKey, snapshot: calendarSnapshot });
  }

  const statusCalendar =
    heldCalendar !== null && heldCalendar.key === statusOpeningKey ? heldCalendar.snapshot : null;
  const statusDialogOffer = statusDialogOpen ? statusOpening.held.offer : null;
  const consequence = useMemo(
    () => shownDeactivationConsequenceOf(statusCalendar, id, statusDialogOffer, statusDayEntered, today),
    [statusCalendar, id, statusDialogOffer, statusDayEntered, today],
  );
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

  // A DIALOG'S OFFER GONE ON A RE-READ (story 7.11). The member left the
  // list under the basics or the allowance dialog; or the change the team or
  // status dialog was opened for is no longer offered — another admin
  // scheduled one, the teams went, the team picked went. It closes, its
  // erasure dialog with it, and the card says the record moved — ALWAYS the
  // stale refusal, never an earlier one about what was entered. Never while
  // its own write is pending: that settles first.
  const basicsGone = (basicsOpening !== null || allowanceOpening !== null) && form.member === null && !pending;
  const teamGone = teamOpening !== null && !teamStillOffered && !teamPending;
  const statusGone = statusOpening !== null && !statusStillOffered && !statusPending;

  useEffect(() => {
    if (!basicsGone) return;
    setBasicsOpen(null);
    setAllowanceOpen(null);
    focusLater([], byId(MEMBER_PAGE_HEADING_ID));
  }, [basicsGone]);

  useEffect(() => {
    if (!teamGone) return;
    setTeamOpen(null);
    setTeamPick(null);
    if (erasureDialogs.current.team.shown !== null) erasureDialogs.current.team.drop();
    setTeamFailure({ member: id, raised: { code: MEMBER_TEAM_STALE, saved: false } });
    setTeamDateMark(null);
    focusTeamLanded();
  }, [teamGone, id]);

  useEffect(() => {
    if (!statusGone) return;
    setStatusOpen(null);
    if (erasureDialogs.current.status.shown !== null) erasureDialogs.current.status.drop();
    setStatusFailure({ member: id, raised: { code: MEMBER_STATUS_STALE, saved: false } });
    setStatusDateMark(null);
    focusStatusLanded();
  }, [statusGone, id]);

  // ------------------------------------------------------- the member write

  /** `Uredi` or `Promijeni pravo`: its dialog opens on the record as it is now. */
  function openMemberDialog(scope: MemberSaveScope): void {
    if (saving.current || form.member === null) return;

    setFailure(null);
    setInvalidField(null);
    setSaved(null);
    openings.current += 1;

    const opening = { member: id, raised: { key: openings.current, held: null } };

    if (scope === ALLOWANCE_SAVE) setAllowanceOpen(opening);
    else setBasicsOpen(opening);
  }

  /** Either dialog's cancel, close button and Escape: never while a save is in flight. */
  function closeMemberDialog(): void {
    if (saving.current) return;

    const opener = allowanceOpening === null ? basicsOpener : allowanceOpener;

    setBasicsOpen(null);
    setAllowanceOpen(null);
    // A PARTIAL SAVE STAYS SAID: the other fields did land, so the card keeps
    // saying so (and why the rename did not) once the dialog is gone.
    setFailure((said) => (said !== null && said.raised.saved ? said : null));
    setInvalidField(null);
    focusLater([() => opener.current], byId(MEMBER_PAGE_HEADING_ID));
  }

  /**
   * THE ONE MEMBER WRITE, for whichever of its two dialogs is open (story
   * 7.11): the basics dialog sends name, username, address, role and — while
   * offered — rank, and never the allowance; the allowance dialog sends the
   * allowance and nothing else. `saveMember` sends only the fields the edit
   * carries, so neither writes back a value another admin may have changed
   * since this page was read. A refusal keeps the dialog open with what was
   * entered; a landed save closes it and says so on its card.
   */
  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const member = form.member;
    const scope: MemberSaveScope = allowanceOpening === null ? BASICS_SAVE : ALLOWANCE_SAVE;
    const name = nameField.current;
    const username = usernameField.current;
    const email = emailField.current;
    const leave = leaveField.current;
    const role = roleField.current;
    const rank = rankField.current;

    if (
      member === null ||
      (scope === ALLOWANCE_SAVE && leave === null) ||
      (scope === BASICS_SAVE && (name === null || username === null || email === null || role === null)) ||
      (scope === BASICS_SAVE && offersRank && rank === null) ||
      saving.current
    ) {
      return;
    }

    let edits: MemberEdits;

    if (scope === ALLOWANCE_SAVE) {
      const leaveAllowanceDays = enteredAllowance(leave?.value ?? NO_TEXT);

      if (leaveAllowanceDays === null) {
        setFailure({ member: member.id, raised: { code: MEMBER_WRITE_INVALID, saved: false } });
        setInvalidField(leave?.id ?? null);
        leave?.focus();

        return;
      }

      edits = { leaveAllowanceDays };
    } else {
      edits = {
        name: name?.value ?? NO_TEXT,
        email: storedEmail(email?.value ?? NO_TEXT),
        role: chosenRole(role?.value ?? NO_TEXT),
        username: username?.value ?? NO_TEXT,
        // ONLY WHILE THE CONTROL IS OFFERED. Absent, the PATCH leaves the
        // stored rank alone: the setting hides ranks and never deletes them.
        ...rankEditOf(member.fireRank, rank?.value ?? null, offersRank),
      };
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
        edits,
      );

      // THE OUTCOME FIRST, AND THE CACHE AFTER. A failed or paused re-read
      // resolves rather than rejects (`refreshAfterWrite`), so it cannot
      // replace the specific refusal.
      if (!outcome.ok) setFailure({ member: member.id, raised: outcome.refusal });
      else {
        setSaved({ member: member.id, raised: scope });
        setBasicsOpen(null);
        setAllowanceOpen(null);
        focusLater(
          [() => (scope === ALLOWANCE_SAVE ? allowanceOpener : basicsOpener).current],
          byId(MEMBER_PAGE_HEADING_ID),
        );
      }

      // INVALIDATED ON BOTH OUTCOMES, and the failing one is the reason. A
      // refused RENAME still wrote the ordinary fields, so a cache left alone
      // would show the old values beside a message saying they were saved.
      // Whatever LANDED is re-read wherever the row shows (`MEMBER_SAVE_DEPENDENTS`).
      try {
        await refreshAfterWrite(
          queryClient,
          MEMBERS_LIST_KEY,
          outcome.ok || outcome.refusal.saved ? MEMBER_SAVE_DEPENDENTS : NO_DEPENDENTS,
        );
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

  // ------------------------------------------------------------ Smjena

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
    focusTeamLanded();
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

      if (teamBlockKey(current) !== confirmation.history) {
        teamErasures.drop();
        setTeamFailure({ member: memberId, raised: { code: MEMBER_TEAM_STALE, saved: false } });
        focusTeamRefused();

        return;
      }

      if (check.kind === CHECK_UNAVAILABLE) {
        teamErasures.drop();
        // A WITHDRAWAL'S CONFIRMATION, armed again, refuses with the retry; a
        // move's dialog is still open beneath and says it there.
        if (confirmation.change === WITHDRAW) setTeamArmed({ member: memberId, raised: confirmation });
        setTeamUnchecked({ member: memberId, raised: true });
        focusLater([() => teamRetryButton.current], () =>
          firstEnabledOf<HTMLElement>(() => teamSaveButton.current, () => teamWithdrawButton.current),
        );

        return;
      }

      if (check.kind === CHECK_REFUSED) {
        teamErasures.drop();
        await refuseTeamChecked(current, check.code);

        return;
      }

      if (teamErasures.recheck(shown, check.rows, shown.subject) === RECHECK_CHANGED) return;

      teamErasures.drop();

      if (teams === null || on === null) {
        setTeamFailure({ member: memberId, raised: { code: MEMBER_WRITE_UNAVAILABLE, saved: false } });
        focusTeamRefused();

        return;
      }

      await writeTeam(current, confirmation, teams, on, check.rows.length);
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

  // ------------------------------------------------------------ Status

  /** After a landed status write, or a dialog that closed by itself: the opener, the withdrawal, or the card. */
  function focusStatusLanded(): void {
    focusLater([() => statusOpener.current, () => statusWithdrawButton.current], byId(MEMBER_STATUS_HEADING_ID));
  }

  /** `Deaktiviraj` / `Ponovno aktiviraj`: the status dialog opens on the earliest date it admits. */
  function openStatus(): void {
    const member = form.member;

    if (statusing.current || statusOffer === null || member === null) return;

    setStatusFailure(null);
    setStatusSaved(null);
    setStatusErased(null);
    setStatusUnchecked(null);
    setStatusDateMark(null);
    setStatusDay({ member: id, raised: statusOffer.minimum });
    openings.current += 1;
    setStatusOpen({ member: id, raised: { key: openings.current, held: { offer: statusOffer, name: member.name } } });
  }

  /** The status dialog's cancel, close button and Escape: never while a write is in flight. */
  function closeStatus(): void {
    if (statusing.current) return;

    setStatusOpen(null);
    setStatusFailure(null);
    setStatusUnchecked(null);
    focusStatusLanded();
  }

  /** The status dialog's date as it is typed, so its question names it. */
  function enterStatusDay(event: ChangeEvent<HTMLInputElement>): void {
    setStatusDay({ member: id, raised: event.currentTarget.value });
  }

  /**
   * The confirmation the status dialog's date — or the card's withdrawal —
   * earns, or `null`, with the refusal it already earns said and the date
   * focused. Nothing is sent from here. A withdrawal is ARMED, for its
   * confirmation; a dialog's change goes straight on from its one button.
   */
  function armStatus(member: MemberListRow, offered: StatusOffer): StatusConfirmation | null {
    if (callerAuthUserId === null) return null;

    const field = dateField.current;
    // A CANCELLATION NAMES THE SCHEDULED VERSION'S DATE; the other two name
    // the entered one.
    const day = offered.change === WITHDRAW ? offered.scheduled.effectiveFrom : field?.value;

    if (day === undefined) return null;

    const refusal = statusPreflightOf(offered.change, day, {
      member,
      members: organizationMembers,
      callerAuthUserId,
      today: offered.today,
    });

    setStatusSaved(null);
    setStatusErased(null);
    setStatusUnchecked(null);

    if (refusal !== null) {
      // FOCUS MOVES TO THE DATE, which the dialog's own alert names; that
      // alert is what the field's `aria-describedby` points at.
      const raised = { code: refusal, saved: false };

      setStatusFailure({ member: member.id, raised });
      setStatusDateMark(dateMarkFor(raised, statusBlockKey(member), true));
      field?.focus();

      return null;
    }

    setStatusFailure(null);

    const confirmation: StatusConfirmation = {
      name: member.name,
      change: offered.change,
      day,
      history: statusBlockKey(member),
    };

    if (offered.change === WITHDRAW) setStatusArmed({ member: member.id, raised: confirmation });

    return confirmation;
  }

  /**
   * THE STATUS WRITE ITSELF (story 5.5e: split out of `changeStatus`, which
   * the erasure dialog's save shares), under the in-flight ref its caller
   * already holds: exactly what `confirmation` names. `erased` is how many
   * conflicts the admin confirmed it removes; 0 for none. A landed write
   * closes the status dialog.
   */
  async function writeStatus(
    member: MemberListRow,
    confirmation: StatusConfirmation,
    members: readonly MemberListRow[],
    caller: string,
    on: string,
    erased: number,
  ): Promise<void> {
    const outcome = await changeMemberStatus(
      supabaseClient().from(MEMBER_STATUS_TABLE),
      confirmation.change,
      confirmation.day,
      { member, members, callerAuthUserId: caller, today: on },
    );

    if (!outcome.ok) {
      setStatusFailure({ member: member.id, raised: outcome.refusal });
      setStatusDateMark(dateMarkFor(outcome.refusal, statusBlockKey(member), false));
    } else {
      setStatusSaved({ member: member.id, raised: true });
      setStatusErased({ member: member.id, raised: erased });
      setStatusOpen(null);
      focusStatusLanded();
    }

    // THE LIST CARRIES THE VERSIONS, so the marker, the status line and the
    // next offer all move with it — and it is refetched on a REFUSAL too,
    // because the likeliest reason for one is a list behind the database
    // (`MEMBER_STATUS_STALE`). A LANDED CHANGE is re-read wherever it shows,
    // as a move is.
    try {
      await refreshAfterWrite(
        queryClient,
        MEMBERS_LIST_KEY,
        outcome.ok ? MEMBERSHIP_WRITE_DEPENDENTS : NO_DEPENDENTS,
      );
    } catch (cause) {
      console.error(MEMBER_WRITE_UNAVAILABLE, cause);
    }
  }

  /**
   * Send a status change — the dialog's deactivation or reactivation, or the
   * card's confirmed withdrawal.
   *
   * A CHANGE NEVER QUIETLY ERASES A CONFLICT (story 5.5e): a deactivation,
   * and the withdrawal of a scheduled reactivation, are checked first exactly
   * as a team move is (see `changeTeam`). A reactivation, and the withdrawal
   * of a scheduled deactivation, only add, and run no check.
   */
  async function changeStatus(member: MemberListRow, confirmation: StatusConfirmation): Promise<void> {
    if (callerAuthUserId === null || today === null || statusing.current) return;

    // Disarmed when this settles, except while it asks for a retry.
    let disarm = true;

    statusing.current = true;
    setStatusFailure(null);
    setStatusSaved(null);
    setStatusErased(null);
    setStatusUnchecked(null);
    setStatusPending(true);

    try {
      const change = statusChangeOf(member.id, confirmation);

      if (change !== null) {
        const check = await memberErasureCheckOf(readErasures.readAndShare, change, onlineManager.isOnline());

        if (check.kind === CHECK_UNAVAILABLE) {
          disarm = false;
          setStatusUnchecked({ member: member.id, raised: true });
          focusLater([() => statusRetryButton.current], () =>
            firstEnabledOf<HTMLElement>(() => statusSaveButton.current, () => statusWithdrawButton.current),
          );

          return;
        }

        // REFUSED ANYWAY: the card's own refusal, said here, and nothing sent.
        if (check.kind === CHECK_REFUSED) {
          await refuseStatusChecked(member, check.code);

          return;
        }

        if (check.rows.length > 0) {
          statusErasures.show(check.rows, { member: member.id, confirmation, change });

          return;
        }
      }

      await writeStatus(member, confirmation, organizationMembers, callerAuthUserId, today, 0);
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
      if (disarm) setStatusArmed(null);
    }
  }

  /**
   * The status dialog's final button (story 7.11), labelled with its action:
   * the same preflight, then the erasure check, then the write.
   */
  async function saveStatus(event?: FormEvent<HTMLFormElement>): Promise<void> {
    event?.preventDefault();

    const member = form.member;

    if (member === null || statusOffer === null || !statusStillOffered || statusing.current) return;

    const confirmation = armStatus(member, statusOffer);

    if (confirmation !== null) await changeStatus(member, confirmation);
  }

  /** The withdrawal confirmation's confirm: sends what it names. */
  function confirmStatus(): void {
    const member = form.member;

    if (member !== null && statusArmedFor !== null) void changeStatus(member, statusArmedFor);
  }

  /** "Pokušaj ponovno": the same status change, asked again from where it was made. */
  function retryStatus(): void {
    if (statusDialogOpen) void saveStatus();
    else confirmStatus();
  }

  /** Focus after a status change was refused once its erasure dialog closed: the dialog's date, else the card. */
  function focusStatusRefused(): void {
    focusLater(
      [() => dateField.current, () => statusWithdrawButton.current, () => statusOpener.current],
      byId(MEMBER_STATUS_HEADING_ID),
    );
  }

  /**
   * A status change the database would refuse anyway, as the erasure check
   * found it (story 5.5e): `refuseTeamChecked`'s twin.
   */
  async function refuseStatusChecked(member: MemberListRow, code: MemberChangeRefusal): Promise<void> {
    const refusal = { code, saved: false };

    setStatusFailure({ member: member.id, raised: refusal });
    setStatusDateMark(dateMarkFor(refusal, statusBlockKey(member), false));
    focusStatusRefused();

    try {
      await queryClient.invalidateQueries({ queryKey: MEMBERS_LIST_KEY });
    } catch (cause) {
      console.error(MEMBER_WRITE_UNAVAILABLE, cause);
    }
  }

  /**
   * The status erasure dialog's own save, once every row is confirmed (story
   * 5.5e): `confirmTeamErasures`'s twin.
   */
  async function confirmStatusErasures(
    shown: ShownErasures<CheckedMemberChange<StatusConfirmation>>,
  ): Promise<void> {
    if (statusing.current || !statusErasures.confirmed) return;

    const { member: memberId, confirmation, change } = shown.subject;
    const before = latest.current;

    if (before.member === null || before.member.id !== memberId) {
      statusErasures.drop();

      return;
    }

    statusing.current = true;
    setStatusPending(true);

    try {
      const check = await memberErasureCheckOf(readErasures.readAndShare, change, onlineManager.isOnline());
      const { member: current, today: on, members, caller } = latest.current;

      if (current === null || current.id !== memberId) {
        statusErasures.drop();

        return;
      }

      if (statusBlockKey(current) !== confirmation.history) {
        statusErasures.drop();
        setStatusFailure({ member: memberId, raised: { code: MEMBER_STATUS_STALE, saved: false } });
        focusStatusRefused();

        return;
      }

      if (check.kind === CHECK_UNAVAILABLE) {
        statusErasures.drop();
        // A WITHDRAWAL'S CONFIRMATION, armed again, refuses with the retry; a
        // dialog's change is still open beneath and says it there.
        if (confirmation.change === WITHDRAW) setStatusArmed({ member: memberId, raised: confirmation });
        setStatusUnchecked({ member: memberId, raised: true });
        focusLater([() => statusRetryButton.current], () =>
          firstEnabledOf<HTMLElement>(() => statusSaveButton.current, () => statusWithdrawButton.current),
        );

        return;
      }

      if (check.kind === CHECK_REFUSED) {
        statusErasures.drop();
        await refuseStatusChecked(current, check.code);

        return;
      }

      if (statusErasures.recheck(shown, check.rows, shown.subject) === RECHECK_CHANGED) return;

      statusErasures.drop();

      if (caller === null || on === null) {
        setStatusFailure({ member: memberId, raised: { code: MEMBER_WRITE_UNAVAILABLE, saved: false } });
        focusStatusRefused();

        return;
      }

      await writeStatus(current, confirmation, members, caller, on, check.rows.length);
    } catch (cause) {
      console.error(MEMBER_WRITE_UNAVAILABLE, cause);
      statusErasures.drop();
      setStatusFailure({ member: memberId, raised: { code: MEMBER_WRITE_UNAVAILABLE, saved: false } });
      focusStatusRefused();
    } finally {
      statusing.current = false;
      setStatusPending(false);
    }
  }

  // ------------------------------------------------------------ Prijava

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
    // The reset's own answer replaces whatever it last said.
    setResetFailure(null);
    setResetPending(true);

    let landed = false;

    try {
      const outcome = await resetPassword(
        supabaseClient().functions as MemberFunctions,
        member.id,
      );

      // NO `invalidateQueries` HERE, and that is a decision rather than an
      // omission: a reset writes no `members` row, so a refetch would change
      // nothing on the list and would only be one more render the shown
      // credential has to survive.
      landed = outcome.ok;
      if (outcome.ok) setIssued({ member: member.id, raised: outcome.credential });
      else setResetFailure({ member: member.id, raised: outcome.refusal });
    } catch (cause) {
      // The CAUSE is logged and never the credential — the success path does
      // not throw, so there is none to leak here.
      console.error(MEMBER_WRITE_UNAVAILABLE, cause);
      setResetFailure({ member: member.id, raised: { code: MEMBER_WRITE_UNAVAILABLE, saved: false } });
    } finally {
      // On EVERY path, including the successful one. Disarmed here and NOT
      // before the await: the confirmation is what carries the busy state, so
      // it has to outlive the request it started.
      resetting.current = false;
      setResetPending(false);
      setArmed(null);
      // FOCUS STAYS WITH THE MEMBER IT WAS ABOUT: the card's heading over a
      // shown password, the button again over a refusal; nowhere once the
      // route has moved on to another member.
      if (latest.current.member?.id === member.id) {
        focusLater(landed ? [] : [() => resetOpener.current], byId(MEMBER_SIGN_IN_HEADING_ID));
      }
    }
  }

  /** The reset confirmation's cancel and Escape: focus goes back to the button that armed it. */
  function focusResetOpener(): void {
    focusLater([() => resetOpener.current], byId(MEMBER_SIGN_IN_HEADING_ID));
  }

  return {
    // The member write: the basics and the allowance dialogs.
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
    readRefusal,
    confirmed: savedOn === BASICS_SAVE,
    allowanceConfirmed: savedOn === ALLOWANCE_SAVE,
    offersRank,
    submit,
    basicsDialog: {
      opener: basicsOpener,
      opening: basicsOpening,
      open: () => {
        openMemberDialog(BASICS_SAVE);
      },
      close: closeMemberDialog,
    },
    allowanceDialog: {
      opener: allowanceOpener,
      opening: allowanceOpening,
      open: () => {
        openMemberDialog(ALLOWANCE_SAVE);
      },
      close: closeMemberDialog,
    },
    // The password reset.
    armedFor,
    credential,
    stage,
    resetRefusal: raisedForMember(resetFailure, id),
    resetOpener,
    focusResetOpener,
    setArmed,
    setIssued,
    issue,
    // The status block.
    dateField,
    offer,
    statusArmedFor,
    statusConfirmed,
    statusRefusal,
    statusDateInvalid,
    statusStage,
    statusPending,
    setStatusArmed,
    armStatus,
    confirmStatus,
    statusRetryButton,
    retryStatus,
    statusUnchecked: raisedForMember(statusUnchecked, id) !== null,
    statusErased: raisedForMember(statusErased, id) ?? 0,
    statusErasures,
    confirmStatusErasures,
    statusDialog: {
      /** What the card's header offers now. */
      available: statusOffer,
      /** What the open dialog was opened on: it draws from this. */
      opening: statusDialogOpen ? statusOpening : null,
      opener: statusOpener,
      withdrawButton: statusWithdrawButton,
      saveButton: statusSaveButton,
      day: statusDayEntered,
      /** A deactivation's consequence in numbers on the entered day, or `null` (story 7.13c). */
      consequence,
      enterDay: enterStatusDay,
      open: openStatus,
      close: closeStatus,
      save: saveStatus,
    },
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
      open: openTeam,
      close: closeTeam,
      save: saveTeam,
    },
  };
}

/** Everything the member page's cards read, as the hook returns it. */
export type MemberEdit = ReturnType<typeof useMemberEdit>;
