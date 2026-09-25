import { CalendarClock } from 'lucide-react';
import type { ReactNode } from 'react';

import { t } from '@/i18n';

/**
 * The two sign-in steps' shared frame (visual refresh A): a navy brand panel
 * from `lg` up, and the form column on the page background.
 *
 * ONE COMPONENT, TWO STEPS. `/prijava` and `/prijava/$slug` are one flow, and
 * the panel is the same fact on both — written twice it would be two places
 * for the product name, the headline and the glows to drift. Each screen keeps
 * its own `<Card>`, heading and form; this owns only what surrounds them.
 *
 * FROM `lg` UP ONLY. On a phone the form is the whole screen, because the
 * person holding it came to sign in, not to read. The panel carries no control
 * and no landmark of its own, and its headline is a paragraph rather than a
 * heading: the form's `<h1>` stays the document's only one. The glows are
 * decoration, drawn from tokens and hidden from assistive technology.
 */
export function AuthLayout({ children }: { readonly children: ReactNode }) {
  return (
    <main className="flex flex-1">
      <div className="relative hidden w-[420px] shrink-0 flex-col overflow-hidden bg-sidebar p-10 text-sidebar-foreground lg:flex">
        <div
          aria-hidden
          className="pointer-events-none absolute -right-24 -top-24 size-80 rounded-full bg-sidebar-primary/20 blur-3xl"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-20 -left-16 size-64 rounded-full bg-sidebar-ring/10 blur-3xl"
        />
        <div className="relative mb-12 flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
            <CalendarClock aria-hidden className="size-5" />
          </span>
          <p className="font-heading text-lg font-extrabold text-sidebar-accent-foreground">
            {t('auth.brand.name')}
          </p>
        </div>
        <p className="relative mb-4 font-heading text-3xl font-extrabold leading-tight text-sidebar-accent-foreground">
          {t('auth.brand.headline')}
        </p>
        <p className="relative text-sm leading-relaxed">{t('auth.brand.subline')}</p>
      </div>
      <div className="flex flex-1 items-center justify-center p-6">{children}</div>
    </main>
  );
}
