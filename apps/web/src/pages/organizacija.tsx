import { Link, createRoute } from '@tanstack/react-router';
import { Clock3 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { PageActions, PageDescription, PageHeader, PageTitle } from '@/components/ui/page-header';
import { t } from '@/lib/i18n';
import { OrganizationAbout } from '@/features/organization/components/organization-about';
import { OrganizationSettingsCard } from '@/features/organization/components/organization-settings-card';
import { useOrganizationSettings } from '@/features/organization/hooks/use-organization-settings';
import { appLayoutRoute } from '@/pages/_app';

/**
 * `Organizacija` — the organization settings surface (stories 1.4a-1.4c,
 * member rank). This file composes the screen: the header, the settings card
 * and the aside. Its state, its one read and its four writes, with the
 * rationale for each write, are `useOrganizationSettings`; what the form
 * deliberately does not offer is `OrganizationSettingsCard`'s.
 *
 * ADMIN ONLY (UX-DR32), and that is enforced by the DATABASE rather than here.
 * `organizations_update_by_own_active_admin` (`0004`) is the whole of it: a
 * member-role session, an admin naming another tenant and a deactivated admin
 * are all refused identically through this form and through a direct API call,
 * because AD-9 leaves no server tier and both are the same call. What the
 * screen owes is that the refusal is visible and that nothing typed is lost —
 * not a second gate that would be the softer of the two and could disagree with
 * the first.
 *
 * The session guard is NOT here. It is registered once on the pathless `_app`
 * layout this route nests under.
 */
export function OrganizacijaScreen() {
  const settings = useOrganizationSettings();

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
      <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <OrganizationSettingsCard settings={settings} />
        <OrganizationAbout organization={settings.organization} />
      </div>
    </main>
  );
}

export const organizacijaRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/organizacija',
  component: OrganizacijaScreen,
});
