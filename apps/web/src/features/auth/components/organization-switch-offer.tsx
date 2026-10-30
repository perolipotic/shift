import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import type { OrganizationSwitchState } from '@/features/auth/hooks/use-organization-switch';
import { t } from '@/lib/i18n';

/**
 * The other-organization offer (retro 10 A5), drawn in the sign-in card in
 * place of the form: it names both organizations by slug — nothing about B is
 * looked up before sign-in (NFR-4), and the slug is what the form shows too —
 * and offers B (sign out of A first) or staying in A.
 *
 * Both buttons stay pressable and say why through `aria-disabled` and
 * `aria-busy` while the sign-out is in flight; the hook's ref refuses a second
 * press. A refused sign-out is an alert; A's session is untouched.
 */
export function OrganizationSwitchOffer({ screen }: { readonly screen: OrganizationSwitchState }): ReactNode {
  const { current, target, pending, failure, switchOrganization, stay } = screen;

  return (
    <div className="grid gap-6">
      <p className="text-sm text-muted-foreground">{t('auth.switch.body', { current, target })}</p>
      {failure === null ? null : <Notice role="alert">{t('auth.switch.error')}</Notice>}
      <div className="grid gap-4">
        <Button
          className="h-11 w-full aria-disabled:opacity-50"
          type="button"
          aria-disabled={pending}
          aria-busy={pending}
          onClick={() => {
            void switchOrganization();
          }}
        >
          {pending ? t('auth.switch.pending') : t('auth.switch.switch', { target })}
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-11 w-full aria-disabled:opacity-50"
          aria-disabled={pending}
          aria-busy={pending}
          onClick={() => {
            void stay();
          }}
        >
          {t('auth.switch.stay', { current })}
        </Button>
      </div>
    </div>
  );
}
