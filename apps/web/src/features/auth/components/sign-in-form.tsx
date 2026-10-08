import { Building2, Eye, EyeOff, KeyRound, Lock, User } from 'lucide-react';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Callout, CalloutBody, CalloutDescription, CalloutTitle } from '@/components/ui/callout';
import { IconTile } from '@/components/ui/icon-tile';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupAction, InputGroupIcon } from '@/components/ui/input-group';
import { Label } from '@/components/ui/label';
import { Notice } from '@/components/ui/notice';
import type { SignInScreenState } from '@/features/auth/hooks/use-sign-in';
import { signInMessageKey } from '@/features/auth/services/sign-in';
import { t } from '@/lib/i18n';

/**
 * The sign-in form (story 7.7): three values — the organization, the username
 * and the password — one refusal, one button, and the forgotten-password
 * disclosure. One form on both `/prijava` and `/prijava/$slug`, and no other
 * step.
 *
 * THE ORGANIZATION IS A ROW OR A FIELD. With the slug in the URL it is a
 * labelled row showing the slug as text, read-only, with `Promijeni`, which
 * swaps in the field prefilled with that slug. Without it, it is the field,
 * prefilled from this device or empty. Nothing about the organization is looked
 * up before sign-in: no name, no logo, no "does it exist" (NFR-4, 1.3b).
 *
 * The `<form>` element is what makes the browser's own credential manager fill
 * and offer to save the username and password — `autoComplete` on a field
 * outside a form is ignored. `method="post"` stays even though the handler
 * runs: if the handler ever does NOT run — a bundle that failed to load, a
 * script error — the browser submits the form itself, and the default method is
 * GET, which would put whatever was typed into the password field into the URL,
 * the browser history and the CDN's request log.
 *
 * ONE error message for a wrong organization, username or password, and that is
 * the point rather than an economy: see `@/features/auth/services/sign-in`. It
 * is bound to all three values. `destructive` is not used for it — UX-DR4
 * reserves that token exclusively for an unresolved conflict, and
 * `theme-contrast.test.ts` measures it only against shift fills, so there is no
 * contrast evidence for it on a form.
 *
 * Sizing: `h-11` is 44 px, the tap-target floor UX-DR40 sets, and every field
 * and button carries it — the inherited shadcn primitives are `h-9`.
 */
export function SignInForm({ screen }: { readonly screen: SignInScreenState }): ReactNode {
  const {
    usernameField,
    passwordField,
    organizationFirst,
    passwordShown,
    failure,
    pending,
    forgotOpen,
    togglePassword,
    toggleForgot,
    submit,
  } = screen;
  // Every `aria-describedby` that names the refusal is CONDITIONAL, because the
  // element it names exists only while there is a failure. A reference to an
  // absent id is not an error, it is simply ignored — which is worse: the
  // attribute is there, a source-level assertion resolves it against the file,
  // and the common case is a control announcing a description that is not on
  // the page.

  return (
    <form
      method="post"
      onSubmit={(event) => {
        void submit(event);
      }}
      className="grid gap-6"
    >
      <OrganizationValue screen={screen} />
      <div className="grid gap-2">
        <Label htmlFor="username">{t('auth.username')}</Label>
        {/* A username is admin-issued and never an email, so none of the
            three text conveniences a phone keyboard applies by default
            are wanted: a capitalized first letter, an autocorrected
            surname-shaped string, and a red spelling underline under a
            perfectly valid credential. */}
        <InputGroup>
          <InputGroupIcon>
            <User />
          </InputGroupIcon>
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
            autoFocus={!organizationFirst}
            aria-describedby={failure === null ? undefined : 'sign-in-error'}
            className="h-11"
          />
        </InputGroup>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="password">{t('auth.password')}</Label>
        {/* THE TOGGLE sits inside the field. Its name stays the same and
            `aria-pressed` carries the state, the toggle-button pattern, so
            nothing is re-announced as a different control. Switching the
            `type` keeps the value: it is the same element. */}
        <InputGroup className="[&>input]:pr-12">
          <InputGroupIcon>
            <Lock />
          </InputGroupIcon>
          <Input
            ref={passwordField}
            id="password"
            name="password"
            type={passwordShown ? 'text' : 'password'}
            autoComplete="current-password"
            required
            aria-describedby={failure === null ? undefined : 'sign-in-error'}
            className="h-11"
          />
          <InputGroupAction>
            <Button
              type="button"
              variant="ghost"
              className="h-11 w-11 p-0"
              aria-label={t('auth.passwordShow')}
              aria-pressed={passwordShown}
              aria-controls="password"
              onClick={togglePassword}
            >
              {/* The state is SEEN as well as announced: a crossed eye while
                  the password is shown. The name stays the same. */}
              {passwordShown ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
            </Button>
          </InputGroupAction>
        </InputGroup>
      </div>
      {/* Rendered only once there is something to say. `role="alert"` is
          what announces it to a screen-reader user on insertion; nothing
          in the tab order passes through it, and every value points at it
          so it is also reachable by moving between them. */}
      {failure === null ? null : (
        <Notice id="sign-in-error" role="alert">
          {t(signInMessageKey(failure))}
        </Notice>
      )}
      <div className="grid gap-4">
        {/* `aria-disabled`, NEVER `disabled`, while the exchange is in
            flight. `disabled` on the button somebody has just pressed takes
            it out of the tab order and drops keyboard focus to `<body>`
            mid-flow; marked this way it stays focused and says it is inert,
            and the hook's in-flight ref is what refuses a second submit.
            `aria-busy` says why, and the label says it in words. */}
        <Button
          className="h-11 w-full aria-disabled:opacity-50"
          type="submit"
          aria-disabled={pending}
          aria-busy={pending}
        >
          {pending ? t('auth.pending') : t('auth.submit')}
        </Button>
        {/* A DISCLOSURE, not a link: these accounts have no self-service
            reset, so there is nowhere to go. It opens the fact in place,
            below the button. The panel is always in the tree and only
            `hidden` while closed, so `aria-controls` never names an absent
            id. */}
        <Button
          type="button"
          variant="link"
          className="h-11 justify-self-start px-0"
          aria-expanded={forgotOpen}
          aria-controls="forgot-password"
          onClick={toggleForgot}
        >
          {t('auth.forgot.trigger')}
        </Button>
        <Callout id="forgot-password" hidden={!forgotOpen}>
          <CalloutBody>
            <IconTile variant="primary">
              <KeyRound />
            </IconTile>
            <div className="min-w-0">
              <CalloutTitle>{t('auth.forgot.heading')}</CalloutTitle>
              <CalloutDescription>{t('auth.forgot.body')}</CalloutDescription>
            </div>
          </CalloutBody>
        </Callout>
      </div>
    </form>
  );
}

/**
 * The organization: the URL slug's read-only row, or the field. A component of
 * its own so each branch is a plain return rather than a ternary nested in the
 * form's children.
 *
 * THE ROW shows the slug as a FACT, not an input: the link a DVD shares already
 * names the organization. Only the slug, never a name or a logo, which would
 * have to be looked up before sign-in. `Promijeni` swaps in the field,
 * prefilled with that slug and focused; the URL does not change.
 *
 * THE FIELD is prefilled from this device, or empty and focused.
 */
function OrganizationValue({ screen }: { readonly screen: SignInScreenState }): ReactNode {
  const {
    shownSlug,
    organizationField,
    organizationDefault,
    rememberedHere,
    organizationFirst,
    organizationEditable,
    failure,
    changeOrganization,
    organizationInput,
  } = screen;

  if (organizationEditable) {
    return (
      <div className="grid gap-2">
        <Label htmlFor="organization">{t('auth.organization.label')}</Label>
        {/* A slug is a DNS label typed by hand, so none of a phone
            keyboard's text conveniences are wanted. `autoComplete="off"`
            rather than `organization`: the WHATWG token names the
            organization's NAME, and this field takes its slug, so autofill
            would supply a value the slug rule always refuses. */}
        <InputGroup>
          <InputGroupIcon>
            <Building2 />
          </InputGroupIcon>
          <Input
            ref={organizationField}
            id="organization"
            name="organization"
            type="text"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            required
            defaultValue={organizationDefault}
            placeholder={t('auth.organization.placeholder')}
            onInput={organizationInput}
            autoFocus={organizationFirst}
            aria-describedby={
              failure === null ? 'organization-hint' : 'sign-in-error organization-hint'
            }
            className="h-11"
          />
        </InputGroup>
        {/* Says where the value came from only when this device supplied
            it, then how to find the slug at all. */}
        <p id="organization-hint" className="text-sm text-muted-foreground">
          {rememberedHere ? <span>{t('auth.organization.remembered')} </span> : null}
          {t('auth.organization.hint')}
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-2">
      <span id="organization-label" className="text-sm font-medium leading-none">
        {t('auth.organization.label')}
      </span>
      {/* The URL slug as a FACT, not an input: the link a DVD shares
          already names the organization. Only the slug — never a name or
          a logo, which would have to be looked up before sign-in. */}
      <div
        role="group"
        aria-labelledby="organization-label"
        aria-describedby={failure === null ? undefined : 'sign-in-error'}
        className="flex min-w-0 items-center gap-3 rounded-md border-[1.5px] border-input bg-muted/40 pl-3"
      >
        <Building2 aria-hidden className="size-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate font-medium">{shownSlug}</span>
        {/* The organization in the FORM DATA too, so the `method="post"`
            fallback and anything reading the form carry it in both modes.
            Hidden, so it is no control and needs no label. */}
        <input type="hidden" name="organization" value={shownSlug} />
        {/* The group's description is not announced while tabbing, since a
            group is not focusable: the one focusable thing in the row carries
            the refusal too. */}
        <Button
          type="button"
          variant="ghost"
          className="h-11 shrink-0"
          aria-label={t('auth.organization.changeLabel')}
          aria-describedby={failure === null ? undefined : 'sign-in-error'}
          onClick={changeOrganization}
        >
          {t('auth.organization.change')}
        </Button>
      </div>
    </div>
  );
}
