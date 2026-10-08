import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useRouter } from '@tanstack/react-router';
import { useRef, useState, type FormEvent } from 'react';
import { flushSync } from 'react-dom';

import {
  NOTHING_TYPED,
  SET_PASSWORD_NOT_CONTINUED,
  SET_PASSWORD_UNAVAILABLE,
  failureDescribes,
  savePassword,
  setPasswordRefusalOf,
  typedStateOf,
  type SetPasswordFailure,
} from '@/features/auth/services/set-password';
import { SIGN_OUT_FAILED, signOut, type SignOutFailure } from '@/features/auth/services/sign-out';
import { supabaseClient } from '@/lib/supabase/client';

/**
 * The set-password step's state and its one exchange (story 7.8): the two
 * uncontrolled fields' refs, the in-flight ref, the refusal, the pending flag,
 * whether the new password is shown, the live checks' inputs, `submit` and
 * the exit.
 *
 * THE FIELDS ARE UNCONTROLLED, read through refs, as the sign-in form's are:
 * a refusal must keep what was typed (UX-DR34). What the live checks need —
 * how many characters, and whether the two agree — is copied into state from
 * each field's own input event, never by making the field controlled.
 *
 * THE LOCAL REFUSAL SENDS NOTHING. Under the minimum or with a mismatch the
 * message is committed, bound to its field, and the field is focused; no
 * request is made, and the button is never `disabled` (it stays a control
 * somebody can press to learn why).
 *
 * `passwordSaved` IS THE RETRY'S MEMORY. Once `updateUser` has landed, a
 * failure after it — the clear or the refresh — leaves the password saved, and
 * the next submit runs only what is left (`@/features/auth/services/set-password`).
 * It is a ref for the handler and nothing renders from it.
 *
 * ON SUCCESS the session has been refreshed without the flag. The router is
 * invalidated because `@/lib/supabase/session-cache` ignores a refresh that
 * keeps the user — so nothing else would re-run the guards — and the member
 * goes to `/`, which forwards them to their landing destination with no new
 * sign-in.
 */
export function useSetPassword() {
  const navigate = useNavigate();
  const router = useRouter();
  const queryClient = useQueryClient();
  const passwordField = useRef<HTMLInputElement>(null);
  const repeatField = useRef<HTMLInputElement>(null);
  // A REF, read inside the handler: state would be stale on a second submit in
  // the same tick, and that second submit is the one that must not repeat step 1.
  const passwordSaved = useRef(false);
  // The in-flight guard, as a ref for the reason the sign-in hook's is one.
  const exchanging = useRef(false);
  const leaving = useRef(false);
  const [passwordShown, setPasswordShown] = useState(false);
  const [typedState, setTypedState] = useState(NOTHING_TYPED);
  const [failure, setFailure] = useState<SetPasswordFailure | null>(null);
  const [signOutFailure, setSignOutFailure] = useState<SignOutFailure | null>(null);
  const [pending, setPending] = useState(false);
  // What renders from `passwordSaved`: once the password has landed the two
  // fields are read-only, because the value in them IS what was saved and an
  // edit would be silently ignored by the retry.
  const [saved, setSaved] = useState(false);

  /** The live checks' inputs, re-read from both fields on either's input. */
  function fieldsInput(): void {
    const password = passwordField.current;
    const repeat = repeatField.current;

    if (password === null || repeat === null) return;

    setTypedState(typedStateOf(password.value, repeat.value));
  }

  function togglePassword(): void {
    setPasswordShown((shown) => !shown);
  }

  /** Focuses the field a refusal is about, once the refusal is committed —
   *  so the field is announced WITH its message. */
  function focusFieldOf(code: SetPasswordFailure): void {
    // The new password unless the refusal is about the repeat alone.
    const field = failureDescribes(code).password ? passwordField : repeatField;

    field.current?.focus();
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const password = passwordField.current;
    const repeat = repeatField.current;

    // NOR WHILE SIGNING OUT: the two exchanges never overlap.
    if (password === null || repeat === null || exchanging.current || leaving.current) return;

    // Checked only while there is a password left to save: after step 1
    // landed, the retry has nothing of the fields to judge.
    if (!passwordSaved.current) {
      const refused = setPasswordRefusalOf(password.value, repeat.value);

      if (refused !== null) {
        flushSync(() => {
          setFailure(refused);
        });
        focusFieldOf(refused);

        return;
      }
    }

    // RE-MASKED FIRST, as on the sign-in form: a refusal never focuses a
    // password shown as plain text, and a credential manager offering to save
    // sees a `type="password"` field.
    flushSync(() => {
      setPasswordShown(false);
    });

    exchanging.current = true;
    setFailure(null);
    setPending(true);

    try {
      const outcome = await savePassword(supabaseClient(), password.value, passwordSaved.current);

      if (!outcome.ok) {
        flushSync(() => {
          setFailure(outcome.code);
          setSaved(outcome.passwordSaved);
        });
        passwordSaved.current = outcome.passwordSaved;
        focusFieldOf(outcome.code);

        return;
      }

      // SAVED BEFORE ANYTHING ELSE CAN REJECT: if the invalidation or the
      // navigation below fails, a retry must not set the same password again
      // (GoTrue would answer `same_password`).
      passwordSaved.current = true;
      setSaved(true);
      await router.invalidate();
      await navigate({ to: '/', replace: true });
    } catch (cause) {
      // The client throwing on a build with no environment, or a navigation
      // that rejected. Logged, never with the password.
      console.error(SET_PASSWORD_UNAVAILABLE, cause);
      // Saved already, the step was not left; otherwise nothing was saved.
      const code = passwordSaved.current ? SET_PASSWORD_NOT_CONTINUED : SET_PASSWORD_UNAVAILABLE;

      flushSync(() => {
        setFailure(code);
      });
      focusFieldOf(code);
    } finally {
      exchanging.current = false;
      setPending(false);
    }
  }

  /** `Odjava`: the auth sign-out service, then the sign-in form. */
  async function leave(): Promise<void> {
    // NOR WHILE A SAVE IS IN FLIGHT: signing out under it would leave a saved
    // password and a flag nobody cleared.
    if (leaving.current || exchanging.current) return;

    leaving.current = true;
    setSignOutFailure(null);

    try {
      const outcome = await signOut(supabaseClient().auth);

      if (!outcome.ok) {
        setSignOutFailure(outcome.code);

        return;
      }

      // Nothing this session read outlives it, as the chrome's exit does.
      queryClient.clear();
      await navigate({ to: '/prijava' });
    } catch (cause) {
      console.error(SIGN_OUT_FAILED, cause);
      setSignOutFailure(SIGN_OUT_FAILED);
    } finally {
      leaving.current = false;
    }
  }

  return {
    passwordField,
    repeatField,
    passwordShown,
    typed: typedState.typed,
    longEnough: typedState.longEnough,
    matches: typedState.matches,
    describes: failureDescribes(failure),
    failure,
    signOutFailure,
    pending,
    saved,
    fieldsInput,
    togglePassword,
    submit,
    leave,
  };
}

/** What the set-password form is drawn from. */
export type SetPasswordScreenState = ReturnType<typeof useSetPassword>;
