import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import type { SignInScreenState } from '@/features/auth/hooks/use-sign-in';
import { signInMessageKey } from '@/features/auth/services/sign-in';
import { t } from '@/lib/i18n';

/**
 * The sign-in form: exactly two fields, one refusal and one button.
 *
 * The `<form>` element is what makes the browser's own credential manager fill
 * and offer to save this pair — `autoComplete` on a field outside a form is
 * ignored. `method="post"` stays even though the handler runs: if the handler
 * ever does NOT run — a bundle that failed to load, a script error — the
 * browser submits the form itself, and the default method is GET, which would
 * put whatever was typed into the password field into the URL, the browser
 * history and the CDN's request log.
 *
 * ONE error message for three different refusals, and that is the point rather
 * than an economy: see `@/features/auth/services/sign-in`. `destructive` is not
 * used for it — UX-DR4 reserves that token exclusively for an unresolved
 * conflict, and `theme-contrast.test.ts` measures it only against shift fills,
 * so there is no contrast evidence for it on a form.
 *
 * Sizing: `h-11` is 44 px, the tap-target floor UX-DR40 sets, and both fields
 * and the button carry it — the inherited shadcn primitives are `h-9`.
 */
export function SignInForm({ screen }: { readonly screen: SignInScreenState }): ReactNode {
  const { usernameField, passwordField, failure, pending, submit } = screen;

  return (
    <form
      method="post"
      onSubmit={(event) => {
        void submit(event);
      }}
      className="grid gap-6"
    >
      <div className="grid gap-2">
        <Label htmlFor="username">{t('auth.username')}</Label>
        {/* A username is admin-issued and never an email, so none of the
            three text conveniences a phone keyboard applies by default
            are wanted: a capitalized first letter, an autocorrected
            surname-shaped string, and a red spelling underline under a
            perfectly valid credential. */}
        <Input
          ref={usernameField}
          id="username"
          name="username"
          type="text"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          aria-describedby={failure === null ? undefined : 'sign-in-error'}
          className="h-11"
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="password">{t('auth.password')}</Label>
        {/* Two descriptions, in the order they are useful: what just went
            wrong, then what to do about a forgotten password. A token
            list is how `aria-describedby` carries both — the refusal
            concerns the pair of fields, not the password alone, so it is
            bound to each of them.

            CONDITIONAL, because the element it names exists only while
            there is a failure. A reference to an absent id is not an
            error, it is simply ignored — which is worse: the attribute is
            there, a source-level assertion resolves it against the file,
            and the common case is a control announcing a description that
            is not on the page. */}
        <Input
          ref={passwordField}
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          aria-describedby={
            failure === null ? 'password-reset' : 'sign-in-error password-reset'
          }
          className="h-11"
        />
      </div>
      {/* Rendered only once there is something to say. `role="alert"` is
          what announces it to a screen-reader user on insertion; nothing
          in the tab order passes through it, and the fields point at it
          so it is also reachable by moving between them. */}
      {failure === null ? null : (
        <Notice id="sign-in-error" role="alert">
          {t(signInMessageKey(failure))}
        </Notice>
      )}
      <Button className="h-11 w-full" type="submit" disabled={pending}>
        {t('auth.submit')}
      </Button>
      {/* States the fact rather than hiding the affordance (UX-DR34):
          these accounts have no self-service reset, so there is nothing
          to link to. `aria-describedby` from the password field is what
          gets it to a screen-reader user, who would otherwise never meet
          it — it is static text after the last control, so nothing in
          the tab order passes through it. */}
      <p id="password-reset" className="text-sm text-muted-foreground">
        {t('auth.passwordReset')}
      </p>
    </form>
  );
}
