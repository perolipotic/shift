import { createRoute } from '@tanstack/react-router';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { t } from '@/i18n';
import { rootRoute } from '@/routes/__root';

/**
 * The sign-in screen (story 1.1d). Presentational only.
 *
 * No credential check, no state, no validation, no error surface and no
 * Supabase client: story 1.3 owns authentication, and 1.1a's frozen boundary
 * says so. The `<form>` element is still here rather than a bare stack of
 * controls, because it is what makes the browser's own credential manager fill
 * and offer to save this pair — `autoComplete` on a field outside a form is
 * ignored — and it is the one seam 1.3 attaches its real handler to.
 *
 * Which is why the two attributes below are on it, and why neither is a step
 * towards 1.3. `method="post"` because a form with no handler still submits and
 * the default method is GET, which would put whatever was typed into the
 * password field into the URL, the browser history and the CDN's request log.
 * `onSubmit` with `preventDefault` because POST to a static host is a 405 that
 * discards every entered value — the opposite of UX-DR34's "a refused save
 * names the problem and keeps every entered value". Together they make the
 * screen inert rather than wrong: the button is reachable, focusable and
 * announced, and it does nothing until 1.3 gives it something to do.
 *
 * Every string resolves through the module-level `t` (L1/L2). `useTranslation`
 * is deliberately not used: with one locale, no language switch and no lazily
 * loaded namespace, nothing on this screen re-renders on a language change, so
 * the hook would add a React-context dependency with no behaviour behind it.
 *
 * Sizing: `h-11` is 44 px, the tap-target floor UX-DR40 sets, and both fields
 * and the button carry it — the inherited shadcn primitives are `h-9`. The
 * classes compose through `cn` inside each primitive, so nothing here restyles
 * an inherited component. `destructive` appears nowhere: UX-DR4 reserves it for
 * an unresolved conflict, which is not a refused sign-in.
 */
function SignInScreen() {
  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          {/* An `<h1>`, not `CardTitle`: that primitive renders a `div`, and
              this screen's name is the document's only heading. */}
          <h1 className="text-xl font-semibold leading-none tracking-tight">{t('auth.heading')}</h1>
        </CardHeader>
        <CardContent>
          <form
            method="post"
            onSubmit={(event) => {
              event.preventDefault();
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
                id="username"
                name="username"
                type="text"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className="h-11"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">{t('auth.password')}</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                aria-describedby="password-reset"
                className="h-11"
              />
            </div>
            <Button type="submit" className="h-11 w-full">
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
        </CardContent>
      </Card>
    </main>
  );
}

export const prijavaRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/prijava',
  component: SignInScreen,
});
