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
  readMembers,
  type MemberListRow,
} from '@/members/list';
import {
  LEAVE_ALLOWANCE_MAX,
  MEMBER_WRITE_INVALID,
  MEMBER_WRITE_UNAVAILABLE,
  MESSAGE_SEPARATOR,
  chosenRole,
  enteredAllowance,
  memberFormKey,
  memberFormRefusalOf,
  memberWriteMessageKeys,
  raisedForMember,
  saveMember,
  storedEmail,
  type RaisedForMember,
  type MemberFunctions,
  type MemberWriteRefusal,
} from '@/members/write';
import { DESTINATIONS } from '@/navigation/destinations';
import { MEMBER_ROLES, MEMBER_ROLE_UNAVAILABLE, type MemberRoleOutcome } from '@/navigation/role';
import { appLayoutRoute } from '@/routes/_app';
import { supabaseClient } from '@/supabase/client';

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

  const answer = useQuery({
    queryKey: MEMBERS_LIST_KEY,
    queryFn: () => readMembers(supabaseClient().from(MEMBERS_TABLE)),
    staleTime: MEMBERS_READ_STALE_MS,
    refetchOnWindowFocus: false,
  });

  // TWO PURE FUNCTIONS AND NO BRANCH OF ITS OWN: the list's four states, then
  // "is this member in it". Both are pinned by execution in `write.test.ts`.
  const form = memberFormRefusalOf(membersSurfaceStateOf(answer), id);
  // The save's refusal wins over the read's: if a save has just been refused,
  // that is the thing the person is waiting to hear about.
  const refusal: MemberWriteRefusal | null =
    raisedForMember(failure, id) ??
    (form.refusal === null ? null : { code: form.refusal, saved: false });
  const confirmed = raisedForMember(saved, id) !== null;

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
