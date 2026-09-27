import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type FormEvent } from 'react';

import { MEMBERS_LIST_KEY } from '@/features/members/services/list';
import {
  MEMBER_WRITE_INVALID,
  MEMBER_WRITE_UNAVAILABLE,
  chosenRole,
  createFormStateOf,
  createMember,
  enteredAllowance,
  storedEmail,
  type IssuedCredential,
  type MemberFunctions,
  type MemberWriteRefusal,
} from '@/features/members/services/write';
import { rankEditOf, ranksShownIn } from '@/features/members/utils/rank';
import {
  ORGANIZATION_TABLE,
  organizationSnapshotQueryOptions,
} from '@/features/organization/services/snapshot';
import { supabaseClient } from '@/lib/supabase/client';

/**
 * `/ljudi/novi`'s state, its read and its submit (story 1.5b).
 *
 * THIS HOOK AND THE SCREEN'S COMPONENTS HOLD STATE AND MARKUP AND NOTHING ELSE.
 * Every rule they apply — whether there is anything to seed the form from, what
 * a refusal says, what a `<select>` value IS, whether a number field holds a
 * number — is a pure function in `@/features/members/services/write`, because
 * AD-15 collects no `.tsx` and a branch written in the screen is executed by
 * nothing. Story 1.5a's loopback paid for that lesson and story 1.5b's first
 * iteration paid for it again.
 *
 * THE CREDENTIAL IS SHOWN ONCE AND NEVER AGAIN. It is component state, nothing
 * else: not a query cache entry, not `localStorage`, and above all never a
 * `console` argument — a log line would put the one unrecoverable value in the
 * system somewhere it can be read long after the panel is gone. When the panel
 * closes, the only copy left is the one the admin wrote down.
 *
 * THE WRITE DOES NOT TOUCH THE CACHE DIRECTLY. `invalidateQueries` on
 * `MEMBERS_LIST_KEY`, the way `organizacija.tsx:293` does it, so what the list
 * shows afterwards is what the database holds rather than what this screen
 * believed it sent.
 */
export function useMemberCreate() {
  const queryClient = useQueryClient();
  const nameField = useRef<HTMLInputElement>(null);
  const usernameField = useRef<HTMLInputElement>(null);
  const emailField = useRef<HTMLInputElement>(null);
  const leaveField = useRef<HTMLInputElement>(null);
  const roleField = useRef<HTMLSelectElement>(null);
  const rankField = useRef<HTMLSelectElement>(null);
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

  // THE CHROME'S OWN READ POLICY, through the one factory the edit screen uses
  // too: a second consumer of one cache entry, not a second policy on it.
  const snapshot = useQuery(
    organizationSnapshotQueryOptions(() => supabaseClient().from(ORGANIZATION_TABLE)),
  );

  // EVERY STATE THIS SCREEN CAN BE IN, decided in `@/features/members/services/write` and pinned
  // by execution over all three of them.
  const form = createFormStateOf(snapshot);
  // MEMBER RANK: the rank control exists only while the organization uses
  // ranks, read from the same snapshot the form is seeded from.
  const offersRank = ranksShownIn(snapshot.data);
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
    const rank = rankField.current;

    if (
      form.organizationId === null ||
      name === null ||
      username === null ||
      email === null ||
      leave === null ||
      role === null ||
      (offersRank && rank === null) ||
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
        // In the one create payload, so the row is inserted with its rank.
        // Absent while the setting is off: the function stores no rank.
        ...rankEditOf(null, rank?.value ?? null, offersRank),
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

  return {
    nameField,
    usernameField,
    emailField,
    leaveField,
    roleField,
    rankField,
    pending,
    invalidField,
    credential,
    form,
    offersRank,
    refusal,
    submit,
  };
}

/** Everything the create form's components read, as the hook returns it. */
export type MemberCreate = ReturnType<typeof useMemberCreate>;
