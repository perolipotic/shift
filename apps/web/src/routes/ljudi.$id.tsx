import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, createRoute, redirect } from '@tanstack/react-router';
import { useRef, useState, type FormEvent, type ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { t } from '@/i18n';
import {
  MEMBERS_LIST_KEY,
  MEMBERS_READ_STALE_MS,
  MEMBERS_TABLE,
  NO_TEXT,
  mayReadMembers,
  memberLevelMessageKey,
  membersSurfaceStateOf,
  membersTodayOf,
  readMembers,
  shownDate,
  type MemberListRow,
} from '@/members/list';
import {
  LEAVE_ALLOWANCE_MAX,
  MEMBER_STATUS_TABLE,
  MEMBER_WRITE_INVALID,
  MEMBER_WRITE_UNAVAILABLE,
  MESSAGE_SEPARATOR,
  RESET_ARMED,
  RESET_BUSY,
  RESET_IDLE,
  RESET_SHOWN,
  SESSION_SUBJECT_KEY,
  STATUS_ARMED,
  STATUS_BUSY,
  STATUS_IDLE,
  WITHDRAW,
  changeMemberStatus,
  chosenRole,
  enteredAllowance,
  memberFormKey,
  memberFormRefusalOf,
  memberWriteMessageKeys,
  raisedForMember,
  readSessionSubject,
  resetPassword,
  resetStageOf,
  saveMember,
  standingConfirmation,
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
  type RaisedForMember,
  type MemberFunctions,
  type MemberWriteRefusal,
  type ResetCredential,
  type StatusConfirmation,
  type StatusOffer,
} from '@/members/write';
import { DESTINATIONS } from '@/navigation/destinations';
import { MEMBER_ROLES, MEMBER_ROLE_UNAVAILABLE, type MemberRoleOutcome } from '@/navigation/role';
import { appLayoutRoute } from '@/routes/_app';
import { currentSession, supabaseClient } from '@/supabase/client';

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

  const answer = useQuery({
    queryKey: MEMBERS_LIST_KEY,
    queryFn: () => readMembers(supabaseClient().from(MEMBERS_TABLE)),
    staleTime: MEMBERS_READ_STALE_MS,
    refetchOnWindowFocus: false,
  });

  // THE CALLER'S OWN ACCOUNT, so the status block is never offered on it.
  const subject = useQuery({
    queryKey: SESSION_SUBJECT_KEY,
    queryFn: () => readSessionSubject(currentSession),
    refetchOnWindowFocus: false,
  });
  const callerAuthUserId = subject.data ?? null;
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

    if (
      member === null ||
      name === null ||
      username === null ||
      email === null ||
      leave === null ||
      role === null ||
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
        <div className="grid gap-2">
          <Label htmlFor="member-name">{t('ljudi.name')}</Label>
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
        </div>
        <div className="grid gap-2">
          <Label htmlFor="member-username">{t('ljudi.form.username')}</Label>
          {/* THE ONE FIELD THAT CAN REACH THE PRIVILEGED BOUNDARY. Changing it
              moves `auth.users.email` as well as `members.username`, which is
              the one thing row level security cannot do — `saveMember` decides
              that, not this element. */}
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
        </div>
        <div className="grid gap-2">
          <Label htmlFor="member-email">{t('ljudi.email')}</Label>
          {/* OPTIONAL (CAP-1, `0002:135`): a member with no address is still a
              member. An emptied field stores `null`, never an empty string. */}
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
        </div>
        <div className="grid gap-2">
          <Label htmlFor="member-role">{t('ljudi.role')}</Label>
          {/* Demoting the last administrator of an organization is refused by
              `0002:242-246`'s deferred trigger AT COMMIT, not here: the control
              can express it and the database is what says no, which is the same
              division every other refusal on this surface follows. */}
          <select
            ref={roleField}
            id="member-role"
            name="role"
            defaultValue={member.role}
            aria-describedby={refusal === null ? undefined : 'member-form-error'}
            className="flex h-11 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
          >
            {MEMBER_ROLES.map((option) => (
              <option key={option} value={option}>
                {t(memberLevelMessageKey(option))}
              </option>
            ))}
          </select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="member-leave">{t('ljudi.leave')}</Label>
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
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Button className="h-11 w-full" type="submit" disabled={pending} aria-busy={pending}>
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

    return (
      <div className="grid gap-2">
        <p className="text-sm font-medium">{t('ljudi.form.resetPrompt', { name })}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <Button
            className="h-11 w-full"
            type="button"
            disabled={busy}
            aria-busy={busy}
            onClick={() => {
              void issue();
            }}
          >
            {t('ljudi.form.resetConfirm', { name })}
          </Button>
          <Button
            className="h-11 w-full"
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => {
              setArmed(null);
            }}
          >
            {t('ljudi.form.resetCancel')}
          </Button>
        </div>
      </div>
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
        <p role="status" className="text-sm font-medium">
          {t('ljudi.form.resetIssued')}
        </p>
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
        {status.scheduled === null ? null : (
          <p className="text-sm font-medium">
            {t(statusScheduledMessageKey(status.scheduled.active), {
              date: shownDate(status.scheduled.effectiveFrom),
            })}
          </p>
        )}
        {statusRefusal === null ? null : (
          <p
            id="member-status-error"
            role="alert"
            className="rounded-md border border-input px-3 py-2 text-sm font-medium"
          >
            {memberWriteMessageKeys(statusRefusal)
              .map((key) => t(key))
              .join(MESSAGE_SEPARATOR)}
          </p>
        )}
        {renderStatusDate(offer, idle)}
        {idle ? renderStatusOffer(member, offer) : renderStatusConfirmation()}
        {statusConfirmed ? (
          <p role="status" className="text-sm font-medium">
            {t('ljudi.status.saved')}
          </p>
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

    return (
      <div className="grid gap-2">
        <p className="text-sm font-medium">
          {t(statusPromptKeyOf(statusArmedFor, offer.today), {
            name: armedName,
            date: shownDate(statusArmedFor.day),
          })}
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <Button
            className="h-11 w-full"
            type="button"
            disabled={busy || statusStage !== STATUS_ARMED}
            aria-busy={busy}
            onClick={() => {
              void changeStatus();
            }}
          >
            {t(statusConfirmMessageKey(statusArmedFor.change), { name: armedName })}
          </Button>
          <Button
            className="h-11 w-full"
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => {
              setStatusArmed(null);
            }}
          >
            {t('ljudi.status.cancel')}
          </Button>
        </div>
      </div>
    );
  }

  function renderBody(): ReactNode {
    if (form.member !== null) return renderForm(form.member);

    return form.loading ? (
      <div className="h-11 w-full animate-pulse rounded-md bg-muted" />
    ) : null;
  }

  return (
    <main className="flex flex-1 justify-center p-6">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <h1 className="text-xl font-semibold leading-none tracking-tight">
            {t('ljudi.form.editHeading')}
          </h1>
        </CardHeader>
        {/* OUTSIDE the gated branch: a read that produced no row renders no
            form, so an explanation rendered inside one would be exactly the
            element nobody can see. */}
        <CardContent className="grid gap-6">
          {refusal === null ? null : (
            <p
              id="member-form-error"
              role="alert"
              className="rounded-md border border-input px-3 py-2 text-sm font-medium"
            >
              {memberWriteMessageKeys(refusal)
                .map((key) => t(key))
                .join(MESSAGE_SEPARATOR)}
            </p>
          )}
          {/* THE ONLY THING THAT SAYS A SAVE LANDED. Every field is
              uncontrolled and remounts to the values it was just saved with, so
              without this a successful save leaves the screen looking exactly
              as it did before the press — indistinguishable from a click that
              did nothing. `role="status"` and not `role="alert"`: the assertive
              region belongs to the refusal, and a second one would be a second
              thing competing to be announced. */}
          {confirmed ? (
            <p role="status" className="text-sm font-medium">
              {t('ljudi.form.saved')}
            </p>
          ) : null}
          {renderBody()}
          {/* OUTSIDE THE `<form>` AND BEFORE THE WAY BACK. Inside the actions
              grid a `<Button>` submits, and `key={memberFormKey(member)}`
              remounts that subtree on every refetch — which would wipe a
              credential nobody had finished reading. */}
          {renderReset()}
          {/* STORY 1.6, and outside the `<form>` for the reason the reset is: a
              `<Button>` inside it submits, and the form's key remounts it. */}
          {renderStatus()}
          {/* THE WAY BACK, always rendered — including while the read is pending
              and after it has settled failed. A screen reachable only by URL
              that can be left only by the browser's Back button is a dead end. */}
          <Button asChild className="h-11 w-full" variant="outline">
            <Link to="/ljudi">{t('ljudi.form.back')}</Link>
          </Button>
        </CardContent>
      </Card>
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
