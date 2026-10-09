import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';

import { MEMBERS_LIST_KEY, MEMBERS_PAGE_HEADING_ID, NO_TEXT } from '@/features/members/services/list';
import {
  MEMBER_WRITE_INVALID,
  MEMBER_WRITE_UNAVAILABLE,
  chosenRole,
  createFormStateOf,
  createMember,
  enteredAllowance,
  storedEmail,
  suggestedUsername,
  type IssuedCredential,
  type MemberFunctions,
  type MemberWriteRefusal,
} from '@/features/members/services/write';
import { MEMBER_ADD_CREATED_ID, MEMBER_ADD_DIALOG_HEADING_ID } from '@/features/members/utils/element-ids';
import { rankEditOf, ranksShownIn } from '@/features/members/utils/rank';
import {
  ORGANIZATION_TABLE,
  organizationSnapshotQueryOptions,
} from '@/features/organization/services/snapshot';
import { supabaseClient } from '@/lib/supabase/client';
import { focusLater } from '@/utils/focus-later';

/**
 * How the page opens and closes the dialog: `true` pushes `?dodaj=1`, `false`
 * replaces it away. `replace` overrides that, for the one write that restores
 * `dodaj` after Back during a create and must not grow the history.
 */
export type MemberAddNavigate = (open: boolean, options?: { readonly replace?: boolean }) => void;

/** The page heading, where focus lands when the dialog closes and nothing opened it. */
function pageHeading(): HTMLElement | null {
  return document.getElementById(MEMBERS_PAGE_HEADING_ID);
}

/** The element whose id this is, for a focus target drawn on the next render. */
function byId(id: string): () => HTMLElement | null {
  return () => document.getElementById(id);
}

/**
 * *Dodaj osobu*'s state, its read and its submit (story 1.5b; a dialog on
 * Ljudi since story 7.13b).
 *
 * THE OPEN STATE IS THE URL'S: `adding` is `?dodaj=1` as the route parsed it,
 * and `navigate` is how the page writes it — opening pushes an entry, so Back
 * closes the dialog, and closing replaces it. Two steps in the one dialog: the
 * form, then the credential it issued, with *Dodaj još jednu* ({@link again})
 * and *Otvori stranicu osobe*.
 *
 * THIS HOOK AND THE DIALOG HOLD STATE AND MARKUP AND NOTHING ELSE. Every rule
 * they apply — whether there is anything to seed the form from, what a refusal
 * says, what a `<select>` value IS, whether a number field holds a number,
 * what username a name suggests — is a pure function in
 * `@/features/members/services/write`, because AD-15 collects no `.tsx`.
 *
 * THE CREDENTIAL IS SHOWN ONCE AND NEVER AGAIN. It is component state, nothing
 * else: not the URL, not a query cache entry, not `localStorage`, and above all
 * never a `console` argument. Closing the dialog drops it, and so does
 * *Dodaj još jednu*; a reload of `?dodaj=1` opens on an empty form.
 *
 * THE WRITE DOES NOT TOUCH THE CACHE DIRECTLY. `invalidateQueries` on
 * `MEMBERS_LIST_KEY`, so what the list shows afterwards is what the database
 * holds rather than what this dialog believed it sent.
 */
export function useMemberCreate(adding: boolean, navigate: MemberAddNavigate) {
  const queryClient = useQueryClient();
  const nameField = useRef<HTMLInputElement>(null);
  const usernameField = useRef<HTMLInputElement>(null);
  const emailField = useRef<HTMLInputElement>(null);
  const leaveField = useRef<HTMLInputElement>(null);
  const roleField = useRef<HTMLSelectElement>(null);
  const rankField = useRef<HTMLSelectElement>(null);
  /** *Dodaj osobu*, where focus returns when the dialog closes. */
  const opener = useRef<HTMLButtonElement>(null);
  // WHETHER THE BUTTON OPENED THE DIALOG. A deep link to `?dodaj=1` did not,
  // so its close has no opener to return to and lands on the page heading.
  const openedByButton = useRef(false);
  // THE USERNAME FOLLOWS THE NAME until the admin edits it; from then on it is
  // theirs. A ref, because it changes what a keystroke does and nothing drawn.
  const usernameEdited = useRef(false);
  // A NEW FORM, by key: *Dodaj još jednu* and every close remount the
  // uncontrolled fields onto their defaults. A refusal never does, so the
  // entered values stay (UX-DR34).
  const [formKey, setFormKey] = useState(0);
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
  // THE NAME AS ENTERED, for the second step's `Račun je izrađen: {name} ·
  // {username}` — the reply carries the username, not the name.
  const [createdName, setCreatedName] = useState(NO_TEXT);

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

  // `adding` as of the latest render, for the submit that outlives the render it began in.
  const addingNow = useRef(adding);
  addingNow.current = adding;

  // OPEN WHILE THE URL SAYS SO, and while a create is in flight: Back then does
  // not take the dialog that reports the outcome (see `submit`).
  // `restoring` bridges the render between the create settling and the URL
  // coming back, so that render does not read as a close.
  const [restoring, setRestoring] = useState(false);
  const shown = adding || pending || restoring;
  const wasShown = useRef(false);
  // WHETHER LJUDI IS STILL MOUNTED. A create that settles after the screen is
  // gone (Back twice, or Back off a deep link) restores nothing and navigates
  // nowhere: the person has left.
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;

    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (adding) setRestoring(false);
  }, [adding]);

  useEffect(() => {
    if (shown === wasShown.current) return;
    wasShown.current = shown;

    // OPENING moves focus through the effect below, once the form is drawn.
    if (shown) return;

    // CLOSED, by whatever closed it: the next opening is an empty first step,
    // and focus returns to *Dodaj osobu* — or, after a deep link, the heading.
    const byButton = openedByButton.current;

    openedByButton.current = false;
    clear();
    focusLater([() => (byButton ? opener.current : null)], pageHeading);
  }, [shown]);

  // FOCUS IN THE NAME as soon as the first step is DRAWN — however the dialog
  // opened, and after *Dodaj još jednu*. Keyed on the form existing, not on
  // the opening: a deep link opens before the organization is read, and the
  // name field does not exist until it is.
  const firstStepDrawn = shown && form.organizationId !== null && credential === null;

  useEffect(() => {
    if (firstStepDrawn) focusLater([() => nameField.current], () => nameField.current);
  }, [firstStepDrawn]);

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

      // THE CREDENTIAL FIRST, AND THE CACHE AFTER. `invalidateQueries` awaits
      // the refetch but does not reject when it fails — TanStack refetches with
      // `throwOnError` false, and a refetch paused offline resolves at once
      // (`features/teams/services/dependents.test.ts` pins both). The order is
      // kept anyway: the one unrecoverable value in this system is shown before
      // anything else is awaited, so no later step can take it down.
      setCredential(outcome.credential);
      setCreatedName(name.value.trim());
      // THE FORM AND ITS FOCUSED SUBMIT ARE GONE: focus moves to the line
      // that says what was created, never to the page body.
      focusLater([byId(MEMBER_ADD_CREATED_ID)], byId(MEMBER_ADD_DIALOG_HEADING_ID));

      // REFETCHED rather than patched into the cache, so the list shows what the
      // database holds — including anything a shape on the table normalized. The
      // `try` is for a client that throws before the refetch starts: a stale
      // list is a list one navigation fixes, and it may not cost the one value
      // in this system nothing can recover.
      try {
        await queryClient.invalidateQueries({ queryKey: MEMBERS_LIST_KEY });
      } catch (cause) {
        console.error(MEMBER_WRITE_UNAVAILABLE, cause);
      }
    } catch (cause) {
      // Everything `createMember` does not already map: the client throwing
      // `SUPABASE_ENVIRONMENT_MISSING` on a build with no environment. A failed
      // refetch never reaches here: it resolves. The CAUSE is logged and the
      // credential is not —
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
      // BACK WAS PRESSED MID-CREATE: the dialog stayed open while the request
      // was in flight, and the URL comes back with it, so the outcome — above
      // all a password nobody can recover — is never closed unread.
      // REPLACING, so Back does not grow the history; and only while Ljudi is
      // still mounted.
      if (mounted.current && !addingNow.current) {
        setRestoring(true);
        navigate(true, { replace: true });
      }
    }
  }

  /** Back to an empty first step. Drops the credential and every refusal. */
  function clear(): void {
    usernameEdited.current = false;
    setCredential(null);
    setCreatedName(NO_TEXT);
    setFailure(null);
    setInvalidField(null);
    setFormKey((key) => key + 1);
  }

  /** *Dodaj osobu*: pushes `?dodaj=1`, so Back closes the dialog. */
  function open(): void {
    openedByButton.current = true;
    navigate(true);
  }

  /** The close button, Cancel, Escape and the backdrop: never while a create is in flight. */
  function close(): void {
    if (issuing.current) return;
    navigate(false);
  }

  /** *Dodaj još jednu*: an empty first step; focus goes to the name once it is drawn. */
  function again(): void {
    clear();
  }

  /** The name was edited: the username follows it, until the admin has edited that. */
  function nameChanged(): void {
    const name = nameField.current;
    const username = usernameField.current;

    if (usernameEdited.current || name === null || username === null) return;
    username.value = suggestedUsername(name.value);
  }

  /**
   * The admin edited the username: from now on it is theirs — unless they
   * emptied it, which hands it back to the suggestion.
   */
  function usernameChanged(): void {
    usernameEdited.current = (usernameField.current?.value ?? NO_TEXT) !== NO_TEXT;
  }

  return {
    nameField,
    usernameField,
    emailField,
    leaveField,
    roleField,
    rankField,
    opener,
    shown,
    formKey,
    pending,
    invalidField,
    credential,
    createdName,
    form,
    offersRank,
    refusal,
    submit,
    open,
    close,
    again,
    nameChanged,
    usernameChanged,
  };
}

/** Everything the add dialog and its opener read, as the hook returns it. */
export type MemberCreate = ReturnType<typeof useMemberCreate>;
