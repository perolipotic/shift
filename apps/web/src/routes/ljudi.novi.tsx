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
  NO_TEXT,
  mayReadMembers,
  memberLevelMessageKey,
} from '@/members/list';
import {
  LEAVE_ALLOWANCE_MAX,
  MEMBER_WRITE_UNAVAILABLE,
  MESSAGE_SEPARATOR,
  chosenRole,
  createFormStateOf,
  createMember,
  DEFAULT_MEMBER_ROLE,
  enteredAllowance,
  MEMBER_WRITE_INVALID,
  memberWriteMessageKeys,
  storedEmail,
  type IssuedCredential,
  type MemberFunctions,
  type MemberWriteRefusal,
} from '@/members/write';
import { DESTINATIONS } from '@/navigation/destinations';
import { MEMBER_ROLES, MEMBER_ROLE_UNAVAILABLE, type MemberRoleOutcome } from '@/navigation/role';
import {
  ORGANIZATION_SNAPSHOT_KEY,
  ORGANIZATION_TABLE,
  readOrganization,
} from '@/organization/snapshot';
import { appLayoutRoute } from '@/routes/_app';
import { supabaseClient } from '@/supabase/client';

/**
 * `/ljudi/novi` — an admin issues an account (story 1.5b).
 *
 * THIS SCREEN HOLDS MARKUP AND STATE AND NOTHING ELSE. Every rule it applies —
 * whether there is anything to seed the form from, what a refusal says, what a
 * `<select>` value IS, whether a number field holds a number — is a pure
 * function in `@/members/write`, because AD-15 collects no `.tsx` and a branch
 * written here is executed by nothing. Story 1.5a's loopback paid for that
 * lesson and story 1.5b's first iteration paid for it again.
 *
 * THE READ IS GATED IN FULL, the way `organizacija.tsx:551-561` gates its own:
 * a skeleton while the organization read is pending, NO FORM once it has settled
 * failed, and the message rendered outside that branch so it is not hidden
 * behind the thing that failed. A form whose Save returns silently because the
 * organization id never arrived is the blank-page defect `routes/index.tsx:21-25`
 * warns about wearing a different shape — fully usable, completely inert.
 *
 * THE CREDENTIAL IS SHOWN ONCE AND NEVER AGAIN. It is component state, nothing
 * else: not a query cache entry, not `localStorage`, and above all never a
 * `console` argument — a log line would put the one unrecoverable value in the
 * system somewhere it can be read long after the panel is gone. When the panel
 * closes, the only copy left is the one the admin wrote down.
 *
 * THE WRITE DOES NOT TOUCH THE CACHE DIRECTLY. `invalidateQueries` on
 * `MEMBERS_LIST_KEY`, the way `organizacija.tsx:254` does it, so what the list
 * shows afterwards is what the database holds rather than what this screen
 * believed it sent.
 *
 * THIS IS NOT A DESTINATION, so `type="reset"` is not an exit: cancelling
 * restores the fields, and the way back to the list is a link that says so.
 */

/** Where a session that is not an administrator's is sent. The FIRST
 *  destination, read off the table — the same answer `/` and `/ljudi` give. */
const FIRST_DESTINATION = DESTINATIONS[0];

/** `0002:145` — the column is `smallint not null check (>= 0)`, so the control
 *  cannot express a negative, a fraction of a day, or a number the column
 *  cannot hold. The ceiling is `LEAVE_ALLOWANCE_MAX`: above it the database
 *  answers `22003`, a refusal about a storage type that names nothing an admin
 *  can act on, and AD-3 prefers a shape that cannot express the broken case. */
const ALLOWANCE_MINIMUM = 0;
const ALLOWANCE_STEP = 1;
/** What a fresh form proposes. Not a policy — `members` carries no
 *  organization-wide constant (`0002:145`) — just the number an admin is most
 *  likely to keep, which they can change on every row. */
const ALLOWANCE_DEFAULT = 20;

export function LjudiNoviScreen() {
  const queryClient = useQueryClient();
  const nameField = useRef<HTMLInputElement>(null);
  const usernameField = useRef<HTMLInputElement>(null);
  const emailField = useRef<HTMLInputElement>(null);
  const leaveField = useRef<HTMLInputElement>(null);
  const roleField = useRef<HTMLSelectElement>(null);
  // A REF as well as state, and the two are not redundant: state drives the
  // disabled button, and state is stale inside a handler already called once
  // this tick. The ref is written synchronously, so it is what the guard reads.
  const issuing = useRef(false);
  const [pending, setPending] = useState(false);
  const [failure, setFailure] = useState<MemberWriteRefusal | null>(null);
  // WHICH FIELD a locally-detected refusal is about, or `null`.
  //
  // The one refusal this screen raises itself — a leave allowance that is not a
  // whole number the column can hold — is also the one it knows the FIELD for,
  // and a five-field form saying "Unesena vrijednost nije dopuštena." with no
  // indication of which value leaves somebody re-reading all five. `aria-invalid`
  // carries it to assistive technology and moving focus carries it to everybody
  // else. It is an id rather than a boolean so a second local check cannot
  // quietly mark the wrong control.
  const [invalidField, setInvalidField] = useState<string | null>(null);
  // THE ONE COPY OF THE CREDENTIAL. Component state and nowhere else — see the
  // header. It replaces the form rather than sitting beside it, so there is no
  // moment where a second create could overwrite a password nobody has read.
  const [credential, setCredential] = useState<IssuedCredential | null>(null);

  const snapshot = useQuery({
    queryKey: ORGANIZATION_SNAPSHOT_KEY,
    queryFn: () => readOrganization(supabaseClient().from(ORGANIZATION_TABLE)),
  });

  // EVERY STATE THIS SCREEN CAN BE IN, decided in `@/members/write` and pinned
  // by execution over all three of them.
  const form = createFormStateOf(snapshot);
  const refusal: MemberWriteRefusal | null =
    failure ??
    (form.refusal === null ? null : { code: form.refusal, saved: false });

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const name = nameField.current;
    const username = usernameField.current;
    const email = emailField.current;
    const leave = leaveField.current;
    const role = roleField.current;

    if (
      form.organizationId === null ||
      name === null ||
      username === null ||
      email === null ||
      leave === null ||
      role === null ||
      issuing.current
    ) {
      return;
    }

    const leaveAllowanceDays = enteredAllowance(leave.value);

    if (leaveAllowanceDays === null) {
      setFailure({ code: MEMBER_WRITE_INVALID, saved: false });
      setInvalidField(leave.id);
      // FOCUS MOVES TO THE OFFENDING CONTROL. The alert is announced on
      // insertion, and landing the caret in the field it is about is what turns
      // "a value is not allowed" into "this value is not allowed" for somebody
      // who cannot see the outline.
      leave.focus();

      return;
    }

    issuing.current = true;
    setFailure(null);
    setInvalidField(null);
    setPending(true);

    try {
      const outcome = await createMember(supabaseClient().functions as MemberFunctions, {
        organizationId: form.organizationId,
        name: name.value,
        username: username.value,
        email: storedEmail(email.value),
        role: chosenRole(role.value),
        leaveAllowanceDays,
      });

      if (!outcome.ok) {
        setFailure(outcome.refusal);

        return;
      }

      // THE CREDENTIAL FIRST, AND THE CACHE AFTER, and the order is the whole
      // of it. `invalidateQueries` awaits the refetch, so it REJECTS when the
      // browser is offline or the session has just expired — and with the
      // refetch first that rejection jumped to the catch below, replaced the
      // panel with "try again", and threw away the only copy of a password for
      // an account that had already been created. The admin was then told the
      // write had failed about an account they now cannot hand to anybody.
      setCredential(outcome.credential);

      // REFETCHED rather than patched into the cache, so the list shows what the
      // database holds — including anything a shape on the table normalized. Its
      // failure is ISOLATED: a stale list is a list one navigation fixes, and it
      // may not cost the one value in this system nothing can recover.
      try {
        await queryClient.invalidateQueries({ queryKey: MEMBERS_LIST_KEY });
      } catch (cause) {
        console.error(MEMBER_WRITE_UNAVAILABLE, cause);
      }
    } catch (cause) {
      // Everything `createMember` does not already map: the client throwing
      // `SUPABASE_ENVIRONMENT_MISSING` on a build with no environment, and a
      // refetch that rejects. The CAUSE is logged and the credential is not —
      // `cause` here can only be a client or transport failure, because the
      // success path never throws.
      console.error(MEMBER_WRITE_UNAVAILABLE, cause);
      setFailure({ code: MEMBER_WRITE_UNAVAILABLE, saved: false });
    } finally {
      // On EVERY path, including the successful one: clearing it only on failure
      // is how a button ends up disabled forever with nothing on screen saying
      // why.
      issuing.current = false;
      setPending(false);
    }
  }

  /**
   * The credential, shown once.
   *
   * A FUNCTION rather than a conditional inside the returned JSX, for the reason
   * `organizacija.tsx`'s `renderSettings` is one: `eslint.config.js`'s L2 block
   * refuses a string literal inside a branch nested in a branch that is an
   * element's own child, which a conditional `aria-describedby` inside a
   * conditionally rendered form is.
   */
  function renderCredential(issued: IssuedCredential): ReactNode {
    return (
      <div className="grid gap-4">
        <p role="status" className="text-sm font-medium">
          {t('ljudi.form.created')}
        </p>
        <div className="grid gap-2">
          <p className="text-sm text-muted-foreground">{t('ljudi.form.username')}</p>
          {/* DATA, never a key — the username is what the admin typed, read
              back from the reply so what is shown is what the database holds. */}
          <p className="break-all font-mono text-base">{issued.username}</p>
        </div>
        <div className="grid gap-2">
          <p className="text-sm text-muted-foreground">{t('ljudi.form.credential')}</p>
          <p className="break-all font-mono text-base">{issued.password}</p>
        </div>
        <p className="text-sm font-medium">{t('ljudi.form.credentialOnce')}</p>
      </div>
    );
  }

  /**
   * The form, a skeleton, or nothing at all.
   *
   * NOTHING AT ALL is the case a naive version gets wrong: gated on
   * `organizationId === null` alone this returned a skeleton for a read that had
   * already FAILED, so an indefinitely pulsing bar was what a refused read
   * looked like — identical to a slow one, with the message that explains it
   * rendered by nothing. `createFormStateOf` separates pending from settled, and
   * the alert lives outside this function.
   */
  function renderForm(): ReactNode {
    if (form.organizationId === null) {
      return form.loading ? (
        <div className="h-11 w-full animate-pulse rounded-md bg-muted" />
      ) : null;
    }

    return (
      <form
        method="post"
        onSubmit={(event) => {
          void submit(event);
        }}
        className="grid gap-6"
      >
        <div className="grid gap-2">
          <Label htmlFor="member-name">{t('ljudi.name')}</Label>
          {/* UNCONTROLLED, with a `defaultValue` and never a `value`: a refused
              save must keep every entered value (UX-DR34), and a controlled
              field re-rendered from state on a refusal is how six of them get
              discarded at once. */}
          <Input
            ref={nameField}
            id="member-name"
            name="name"
            type="text"
            required
            defaultValue={NO_TEXT}
            aria-describedby={refusal === null ? undefined : 'member-form-error'}
            className="h-11"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="member-username">{t('ljudi.form.username')}</Label>
          {/* The credential AD-12 issues, and the local part of the address the
              account authenticates against. `autoCapitalize`/`autoCorrect` off
              for the reason the sign-in field turns them off: a phone keyboard
              capitalizing the first letter produces a username `0007`'s
              lowercase check refuses. */}
          <Input
            ref={usernameField}
            id="member-username"
            name="username"
            type="text"
            autoCapitalize="none"
            autoCorrect="off"
            required
            defaultValue={NO_TEXT}
            aria-describedby={refusal === null ? undefined : 'member-form-error'}
            className="h-11"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="member-email">{t('ljudi.email')}</Label>
          {/* OPTIONAL, and that is CAP-1 rather than an oversight: a member with
              no address is still a member (`0002:135`), which is the whole
              reason sign-in is a username. No `required` here and no fallback —
              an empty field stores `null`, never an empty string. */}
          <Input
            ref={emailField}
            id="member-email"
            name="email"
            type="email"
            autoCapitalize="none"
            autoCorrect="off"
            defaultValue={NO_TEXT}
            aria-describedby={refusal === null ? undefined : 'member-form-error'}
            className="h-11"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="member-role">{t('ljudi.role')}</Label>
          {/* A NATIVE `<select>`, as the accent control on `/organizacija` is
              and for the same reason: `components/ui/` holds no Select
              primitive, and a native element already carries keyboard
              behaviour, an accessible name through its `<Label>` and a phone's
              own picker sheet. Its options are the levels `0002:140`'s check
              constraint admits, read off `MEMBER_ROLES` rather than written
              here, so a third level appears the moment it exists. */}
          <select
            ref={roleField}
            id="member-role"
            name="role"
            defaultValue={DEFAULT_MEMBER_ROLE}
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
            defaultValue={ALLOWANCE_DEFAULT}
            aria-describedby={refusal === null ? undefined : 'member-form-error'}
            className="h-11"
          />
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          <Button className="h-11 w-full" type="submit" disabled={pending} aria-busy={pending}>
            {t('ljudi.form.save')}
          </Button>
          {/* `type="reset"`, which on an uncontrolled form is exactly what
              cancelling means: every field goes back to its `defaultValue`. It
              is NOT the way out of this screen — that is the link below, because
              this route is not a destination and resetting a form leaves
              somebody exactly where they were. */}
          <Button className="h-11 w-full" type="reset" variant="outline" disabled={pending}>
            {t('ljudi.form.cancel')}
          </Button>
        </div>
      </form>
    );
  }

  return (
    <main className="flex flex-1 justify-center p-6">
      <Card className="w-full max-w-lg">
        <CardHeader>
          <h1 className="text-xl font-semibold leading-none tracking-tight">
            {t('ljudi.form.newHeading')}
          </h1>
        </CardHeader>
        {/* OUTSIDE the gated branch, which is the whole point: a read that
            produced no organization renders no form, so an explanation rendered
            inside one would be exactly the element nobody can see. */}
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
          {credential === null ? renderForm() : renderCredential(credential)}
          {/* THE WAY BACK, and it is always here — including while the read is
              pending and after it has settled failed. A screen that can only be
              left by the browser's own Back button is a dead end on a phone,
              where the chrome's tab bar is the only other navigation. */}
          <Button asChild className="h-11 w-full" variant="outline">
            <Link to="/ljudi">{t('ljudi.form.back')}</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}

export const ljudiNoviRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/ljudi/novi',
  /**
   * The same role guard `/ljudi` carries, and it is written out rather than
   * shared — copied VERBATIM, and `router.test.ts` drives all three copies by
   * execution rather than by reading any of them.
   *
   * THE READER ARRIVES THROUGH THE ROUTER CONTEXT, which is what keeps this
   * guard out of the build environment: a `supabaseClient()` call here throws
   * `SUPABASE_ENVIRONMENT_MISSING` synchronously on a fresh clone with no
   * `.env.local`, and the whole point of the context reader is that every branch
   * runs in the node suite with nothing running.
   *
   * FAILING CLOSED: a level that cannot be read is not an administrator's, so
   * the visitor is forwarded like any other refused one. Not silently — a
   * swallowed cause is how a misconfiguration reads as an ordinary redirect.
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
  component: LjudiNoviScreen,
});
