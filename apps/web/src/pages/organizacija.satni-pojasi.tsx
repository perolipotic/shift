import { Link, createRoute } from '@tanstack/react-router';
import { Building2, Info, Plus } from 'lucide-react';

import { OfflineNote } from '@/components/offline-note';
import { Button } from '@/components/ui/button';
import {
  Callout,
  CalloutAction,
  CalloutBody,
  CalloutDescription,
  CalloutTitle,
} from '@/components/ui/callout';
import { IconTile } from '@/components/ui/icon-tile';
import { Notice } from '@/components/ui/notice';
import { PageActions, PageDescription, PageHeader, PageTitle } from '@/components/ui/page-header';
import { HourBandAddDialog } from '@/features/hour-bands/components/hour-band-add-dialog';
import { HourBandListSection } from '@/features/hour-bands/components/hour-band-list-section';
import { useHourBandList } from '@/features/hour-bands/hooks/use-hour-band-list';
import { hourBandsMessageKey, hourBandsRetryMessageKey } from '@/features/hour-bands/services/list';
import { t } from '@/lib/i18n';
import { requireAdmin } from '@/features/navigation/services/admin-guard';
import { appLayoutRoute } from '@/pages/_app';

/**
 * `/organizacija/satni-pojasi` — the organization's hour bands (story 2.1b).
 *
 * ADMIN ONLY, under the guard `/ljudi/smjene` carries, and NOT a destination:
 * it is reached from `Organizacija`, which lights that tab.
 *
 * ONLY A NAME AND A START ARE ENTERED. Every band's window, duration and
 * midnight flag, and the 24-hour bar beneath them, are shown read-only and come
 * from `@shift/domain` through `@/features/hour-bands/services/list` — never computed here.
 *
 * THIS FILE COMPOSES (source structure B5). The state, the one read and the
 * add are `useHourBandList`; the add dialog, the table and the bar are
 * components in `@/features/hour-bands/components`; every rule is in
 * `@/features/hour-bands/services/list` and
 * `@/features/hour-bands/services/write`, which the node suite executes.
 */

export function OrganizacijaSatniPojasiScreen() {
  const screen = useHourBandList();
  const { loading, openAdding, created, refusal } = screen;

  return (
    <main
      className="mx-auto flex w-full min-w-0 max-w-5xl flex-1 flex-col gap-6 p-6"
      aria-busy={loading}
    >
      <PageHeader>
        <div className="min-w-0">
          <PageTitle asChild>
            <h1>{t('organization.hourBands.heading')}</h1>
          </PageTitle>
          <PageDescription>{t('organization.hourBands.lede')}</PageDescription>
        </div>
        <PageActions>
          <Button asChild variant="outline" className="h-11">
            <Link to="/organizacija">
              <Building2 aria-hidden />
              {t('nav.organizacija')}
            </Link>
          </Button>
        </PageActions>
      </PageHeader>
      {/* STORY 8.2d: the as-of note while the cached bands are drawn offline;
          the editor's dialog over them adds none. */}
      <OfflineNote offline={screen.offline} />
      <Callout>
        <CalloutBody>
          <IconTile variant="primary">
            <Info />
          </IconTile>
          <div className="min-w-0">
            <CalloutTitle>{t('organization.hourBands.explainerTitle')}</CalloutTitle>
            <CalloutDescription>{t('organization.hourBands.explainerBody')}</CalloutDescription>
          </div>
        </CalloutBody>
        <CalloutAction>
          <Button className="h-11" type="button" onClick={openAdding}>
            <Plus aria-hidden />
            {t('organization.hourBands.open')}
          </Button>
        </CalloutAction>
      </Callout>
      {created ? <Notice role="status">{t('organization.hourBands.created')}</Notice> : null}
      {refusal === null ? null : (
        <div className="grid min-w-0 gap-2">
          <Notice role="alert">{t(hourBandsMessageKey(refusal))}</Notice>
          {/* STORY 8.2d: no read retry offline; it comes back with the connection. */}
          {screen.retryable ? (
            <Button
              className="h-11 w-full sm:w-auto sm:justify-self-start"
              type="button"
              variant="outline"
              onClick={screen.retry}
            >
              {t(hourBandsRetryMessageKey(refusal))}
            </Button>
          ) : null}
        </div>
      )}
      <HourBandAddDialog screen={screen} />
      <HourBandListSection screen={screen} />
    </main>
  );
}

export const organizacijaSatniPojasiRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/organizacija/satni-pojasi',
  /** The shared admin guard (`@/features/navigation/services/admin-guard`). */
  beforeLoad: requireAdmin,
  component: OrganizacijaSatniPojasiScreen,
});
