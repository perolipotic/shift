import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { t } from '@/lib/i18n';
import { OrganizationFireRanksCard } from '@/features/organization/components/organization-fire-ranks-card';
import { OrganizationProfileCard } from '@/features/organization/components/organization-profile-card';
import { OrganizationTimeCard } from '@/features/organization/components/organization-time-card';
import type { OrganizationSettings } from '@/features/organization/hooks/use-organization-settings';
import { ORGANIZATION_READ_RETRY_ID } from '@/features/organization/utils/element-ids';
import { ORGANIZATION_ERROR_ID, organizationMessageKey } from '@/features/organization/utils/messages';

/**
 * The settings page's body (stories 1.4a-1.4c and member rank; facts and
 * dialogs since story 7.18): the read's message and retry, then three cards of
 * facts — *Profil*, *Vrijeme i godina* and *Vatrogasni činovi i položaji* —
 * each change behind its own dialog with one Spremi. No field is mounted on
 * the page.
 *
 * WHAT IS DELIBERATELY NOT HERE:
 *
 *   - THE SLUG. AD-12 builds every member's sign-in address as
 *     `username@slug.shift.invalid`, and `0002:61-69` stores it rather than
 *     deriving it precisely because transliterating a name is not reproducible.
 *     Editing it would silently refuse every existing credential in the
 *     organization.
 *   - A TIMEZONE OR LOCALE CONTROL (FR-8). The zone is a fact, shown locked
 *     with the reason; `LOCALE` is a hard-coded constant
 *     (`lib/i18n/format.ts:43`) and the resource tree is typed as `typeof hr`,
 *     so the application is single-locale by construction.
 *   - THE ORGANIZATION TYPE (FR-7): inert by contract, so a fact about it
 *     would describe nothing anybody sees.
 *   - `destructive`. UX-DR4 reserves that token exclusively for an unresolved
 *     conflict, and a refused save is not one — the refusal is a bordered
 *     `role="alert"` inside its dialog.
 *
 * Sizing: `h-11` is 44 px, the tap-target floor UX-DR40 sets, on every button
 * — the inherited shadcn primitives are `h-9`.
 */
export function OrganizationSettingsCard({
  settings,
}: {
  readonly settings: OrganizationSettings;
}): ReactNode {
  const { snapshot, organization, readFailure, readRetry, readAttempts, retryRead } = settings;

  /**
   * The cards, a skeleton in their shape, or nothing at all.
   *
   * A SKELETON ONLY WHILE THE READ IS PENDING, never merely "no snapshot": a
   * read that has already FAILED renders its message and no pulsing bars,
   * which would look like a slow read. Never a spinner (UX-DR40), and never a
   * card of empty facts: no dialog can be opened on a row nobody has read.
   */
  function renderCards(): ReactNode {
    if (organization === null) {
      return snapshot.isPending ? (
        <div aria-busy className="grid w-full max-w-2xl animate-pulse gap-6">
          <div className="h-56 rounded-lg bg-muted" />
          <div className="h-40 rounded-lg bg-muted" />
          <div className="h-28 rounded-lg bg-muted" />
        </div>
      ) : null;
    }

    return (
      <>
        <OrganizationProfileCard settings={settings} organization={organization} />
        <OrganizationTimeCard settings={settings} organization={organization} />
        <OrganizationFireRanksCard settings={settings} organization={organization} />
      </>
    );
  }

  return (
    <div className="grid min-w-0 gap-6">
      {/* THE READ'S MESSAGE, outside the snapshot-gated branch: a read that
          never produced a row draws no cards, so an explanation drawn inside
          them would be exactly the element nobody can see. KEYED ON THE
          READ'S ATTEMPTS: a retry that fails again remounts the region, which
          is what makes `role="alert"` announce it again. */}
      {readFailure === null ? null : (
        <Notice id={ORGANIZATION_ERROR_ID} role="alert" key={readAttempts} tabIndex={-1} className="max-w-2xl outline-none">
          {t(organizationMessageKey(readFailure))}
        </Notice>
      )}
      {/* THE READ'S RETRY, beside the message that asks for one.
          `aria-disabled` rather than `disabled` while the read is in flight,
          so the person who pressed it keeps their place. */}
      {readRetry ? (
        <Button
          id={ORGANIZATION_READ_RETRY_ID}
          className="h-11 w-full aria-disabled:opacity-50 sm:w-auto sm:justify-self-start"
          type="button"
          variant="outline"
          aria-disabled={snapshot.isFetching}
          aria-busy={snapshot.isFetching}
          aria-describedby={ORGANIZATION_ERROR_ID}
          onClick={retryRead}
        >
          {t('shell.retry')}
        </Button>
      ) : null}
      {renderCards()}
    </div>
  );
}
