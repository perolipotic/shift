import { Link, createRoute } from '@tanstack/react-router';
import { Clock3 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { PageActions, PageDescription, PageHeader, PageTitle } from '@/components/ui/page-header';
import { t } from '@/lib/i18n';
import { requireAdmin } from '@/features/navigation/services/admin-guard';
import { OrganizationSettingsCard } from '@/features/organization/components/organization-settings-card';
import { useOrganizationHourBands } from '@/features/organization/hooks/use-organization-hour-bands';
import { useOrganizationSettings } from '@/features/organization/hooks/use-organization-settings';
import { appLayoutRoute } from '@/pages/_app';

/**
 * `Organizacija` — the organization settings surface (stories 1.4a-1.4c,
 * member rank; a page of facts with a dialog per change since story 7.18).
 * This file composes the screen: the header and the fact cards. Its state,
 * its organization read and its five writes, with the rationale for each, are
 * `useOrganizationSettings`; the *Satni pojasi* card's read of the bands is
 * `useOrganizationHourBands`; what the page deliberately does not offer is
 * `OrganizationSettingsCard`'s.
 *
 * ADMIN ONLY (UX-DR32). The WRITES are enforced by the DATABASE:
 * `organizations_update_by_own_active_admin` (`0004`) is the whole of it: a
 * member-role session, an admin naming another tenant and a deactivated admin
 * are all refused identically through this form and through a direct API call,
 * because AD-9 leaves no server tier and both are the same call. What the
 * screen owes is that the refusal is visible and that nothing typed is lost.
 * The route carries the admin guard `/ljudi/smjene` does, so a member who types
 * this URL is forwarded rather than shown an admin screen shell; it hides the
 * shell, and the database still decides every read and write.
 *
 * The session guard is NOT here. It is registered once on the pathless `_app`
 * layout this route nests under.
 */

export function OrganizacijaScreen() {
  const settings = useOrganizationSettings();
  const hourBands = useOrganizationHourBands();

  return (
    <main className="mx-auto flex w-full min-w-0 max-w-5xl flex-1 flex-col gap-6 p-6">
      <PageHeader>
        {/* The screen's own `<h1>`, styled by `PageTitle asChild` (visual
            refresh B): this screen's name is the document's only heading. It is the
            DESTINATION's own key — the screen is what `Organizacija` names,
            so a second heading string would be the same word authored twice
            and one of the two would be a string nobody renders. */}
        <div className="min-w-0">
          <PageTitle asChild>
            <h1>
              {t('nav.organizacija')}
            </h1>
          </PageTitle>
          <PageDescription>{t('organization.lede')}</PageDescription>
        </div>
        {/* STORY 2.1b: the hour band editor, reached from here rather than
            from the navigation, so the destinations stay eight. A link in the
            header's actions, as `/ljudi`'s way to the teams is. */}
        <PageActions>
          <Button asChild variant="outline" className="h-11">
            <Link to="/organizacija/satni-pojasi">
              <Clock3 aria-hidden />
              {t('organization.hourBands.heading')}
            </Link>
          </Button>
        </PageActions>
      </PageHeader>
      <OrganizationSettingsCard settings={settings} hourBands={hourBands} />
    </main>
  );
}

export const organizacijaRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/organizacija',
  /** The shared admin guard (`@/features/navigation/services/admin-guard`). */
  beforeLoad: requireAdmin,
  component: OrganizacijaScreen,
});
