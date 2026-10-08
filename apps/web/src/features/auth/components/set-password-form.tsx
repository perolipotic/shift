import { Check, Eye, EyeOff, Lock, X } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupAction, InputGroupIcon } from '@/components/ui/input-group';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import type { SetPasswordScreenState } from '@/features/auth/hooks/use-set-password';
import { ruleStateMessageKey, setPasswordMessageKey } from '@/features/auth/services/set-password';
import { t } from '@/lib/i18n';

/**
 * The set-password form (story 7.8): the new password with the 7.7 show/hide
 * toggle, its repeat, two live checks, `Spremi i nastavi` and `Odjava`.
 *
 * THE CHECKS SAY THEIR STATE IN WORDS. Each line carries a tick or a cross and
 * a visually hidden "met" or "not yet", so the state is never colour alone.
 * The pair sits in one `role="status"` region that is NOT atomic, so a
 * keystroke announces the line that changed rather than both; each field is
 * described by the rule about it.
 *
 * THE REFUSAL IS BOUND TO ITS FIELD: `aria-describedby` on the field it is
 * about (`setPasswordFailureField`), and only while it exists. The button is
 * `aria-disabled` in flight, never `disabled`, for the sign-in form's reason.
 *
 * `method="post"` stays for the sign-in form's reason too: a form the handler
 * never reached would otherwise put the password in the URL.
 */
export function SetPasswordForm({ screen }: { readonly screen: SetPasswordScreenState }): ReactNode {
  const {
    passwordField,
    repeatField,
    passwordShown,
    typed,
    longEnough,
    matches,
    describes,
    failure,
    signOutFailure,
    pending,
    saved,
    fieldsInput,
    togglePassword,
    submit,
    leave,
  } = screen;

  return (
    <form
      method="post"
      onSubmit={(event) => {
        void submit(event);
      }}
      className="grid gap-6"
    >
      <div className="grid gap-2">
        <Label htmlFor="new-password">{t('auth.setPassword.password')}</Label>
        <InputGroup className="[&>input]:pr-12">
          <InputGroupIcon>
            <Lock />
          </InputGroupIcon>
          <Input
            ref={passwordField}
            id="new-password"
            name="new-password"
            type={passwordShown ? 'text' : 'password'}
            autoComplete="new-password"
            required
            autoFocus
            readOnly={saved}
            onInput={fieldsInput}
            aria-describedby={
              describes.password ? 'set-password-error set-password-length' : 'set-password-length'
            }
            className="h-11"
          />
          <InputGroupAction>
            <Button
              type="button"
              variant="ghost"
              className="h-11 w-11 p-0"
              aria-label={t('auth.passwordShow')}
              aria-pressed={passwordShown}
              aria-controls="new-password repeat-password"
              onClick={togglePassword}
            >
              {passwordShown ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
            </Button>
          </InputGroupAction>
        </InputGroup>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="repeat-password">{t('auth.setPassword.repeat')}</Label>
        <InputGroup>
          <InputGroupIcon>
            <Lock />
          </InputGroupIcon>
          <Input
            ref={repeatField}
            id="repeat-password"
            name="repeat-password"
            type={passwordShown ? 'text' : 'password'}
            autoComplete="new-password"
            required
            readOnly={saved}
            onInput={fieldsInput}
            aria-describedby={
              describes.repeat ? 'set-password-error set-password-match' : 'set-password-match'
            }
            className="h-11"
          />
        </InputGroup>
      </div>
      {/* NOT ATOMIC: a keystroke announces the rule that changed,
          not both lines again. Each rule has its own id, so each field is
          described by the rule about it. */}
      <div role="status" aria-atomic={false} className="grid gap-1 text-sm">
        <Rule id="set-password-length" met={longEnough}>
          {t('auth.setPassword.ruleLength', { count: typed })}
        </Rule>
        <Rule id="set-password-match" met={matches}>
          {t('auth.setPassword.ruleMatch')}
        </Rule>
      </div>
      {failure === null ? null : (
        <Notice id="set-password-error" role="alert">
          {t(setPasswordMessageKey(failure))}
        </Notice>
      )}
      {signOutFailure === null ? null : (
        <Notice role="alert">{t('auth.setPassword.error.signOut')}</Notice>
      )}
      <div className="grid gap-4">
        <Button
          className="h-11 w-full aria-disabled:opacity-50"
          type="submit"
          aria-disabled={pending}
          aria-busy={pending}
        >
          {pending ? t('auth.setPassword.pending') : t('auth.setPassword.submit')}
        </Button>
        <Button
          className="h-11 w-full"
          type="button"
          variant="outline"
          onClick={() => {
            void leave();
          }}
        >
          {t('auth.setPassword.signOut')}
        </Button>
      </div>
    </form>
  );
}

/** One live check: a tick or a cross, the state in words for assistive
 *  technology, and the rule. */
function Rule({
  id,
  met,
  children,
}: {
  readonly id: string;
  readonly met: boolean;
  readonly children: ReactNode;
}): ReactNode {
  return (
    <p
      id={id}
      className={met ? 'flex items-center gap-2' : 'flex items-center gap-2 text-muted-foreground'}
    >
      {met ? <Check aria-hidden className="size-4 shrink-0" /> : <X aria-hidden className="size-4 shrink-0" />}
      <span className="sr-only">{t(ruleStateMessageKey(met))}</span>
      <span>{children}</span>
    </p>
  );
}
