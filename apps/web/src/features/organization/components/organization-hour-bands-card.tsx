import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Notice } from '@/components/ui/notice';
import { t } from '@/lib/i18n';
import { formatList } from '@/lib/i18n/format';
import {
  durationMessageKey,
  durationValuesOf,
  hourBandsMessageKey,
} from '@/features/hour-bands/services/list';
import { OrganizationFact } from '@/features/organization/components/organization-dialog';
import type { OrganizationHourBands } from '@/features/organization/hooks/use-organization-hour-bands';
import { ORGANIZATION_HOUR_BANDS_HEADING_ID } from '@/features/organization/utils/element-ids';

/**
 * *Satni pojasi* (deferred work from story 7.18): the hour bands as facts —
 * how many and which, in start order, and how much of the day they cover —
 * and `Otvori` in the header, the way to the editor. Nothing is edited here:
 * the bands have their own screen, which the header's link also reaches.
 *
 * Its own read's message in place of the facts when the bands cannot be
 * read; a skeleton line while they load. The organization's cards do not
 * wait on it, nor it on them.
 */
export function OrganizationHourBandsCard({ hourBands }: { readonly hourBands: OrganizationHourBands }): ReactNode {
  const { summary, refusal, loading } = hourBands;

  function renderFacts(): ReactNode {
    if (summary === null) {
      return loading ? <div aria-hidden className="h-10 w-56 max-w-full animate-pulse rounded-md bg-muted" /> : null;
    }

    const count = t('organization.hourBands.count', { count: summary.count });

    return (
      <dl className="grid min-w-0 gap-4 sm:grid-cols-2">
        <OrganizationFact label={t('organization.hourBandsBands')}>
          {summary.count === 0 ? count : t('organization.hourBandsBandsValue', { count, names: formatList(summary.names) })}
        </OrganizationFact>
        <OrganizationFact label={t('organization.hourBands.covered')}>
          <span className="tabular-nums">
            {t('organization.hourBands.coveredValue', {
              covered: t(durationMessageKey(summary.coveredMinutes), durationValuesOf(summary.coveredMinutes)),
            })}
          </span>
        </OrganizationFact>
      </dl>
    );
  }

  return (
    <Card role="region" aria-labelledby={ORGANIZATION_HOUR_BANDS_HEADING_ID} className="w-full min-w-0 max-w-2xl">
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
        <CardTitle asChild>
          <h2 id={ORGANIZATION_HOUR_BANDS_HEADING_ID}>{t('organization.hourBands.heading')}</h2>
        </CardTitle>
        <Button asChild variant="outline" className="h-11">
          <Link to="/organizacija/satni-pojasi" aria-label={t('organization.hourBandsOpenLabel')}>
            {t('organization.hourBandsOpen')}
          </Link>
        </Button>
      </CardHeader>
      <CardContent className="grid gap-4">
        {refusal === null ? null : <Notice role="alert">{t(hourBandsMessageKey(refusal))}</Notice>}
        {renderFacts()}
      </CardContent>
    </Card>
  );
}
