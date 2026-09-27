import { Building2 } from 'lucide-react';
import type { ReactNode } from 'react';

import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card';
import { IconTile } from '@/components/ui/icon-tile';
import { t } from '@/lib/i18n';
import type { OrganizationSnapshot } from '@/features/organization/services/snapshot';

/**
 * WHAT THE SETTINGS DO, beside them (design refresh C). Explains; announces
 * nothing. The zone is shown here rather than on the form: it is written back
 * unchanged by every save, so it is a fact about the organization and not a
 * field.
 */
export function OrganizationAbout({
  organization,
}: {
  readonly organization: OrganizationSnapshot | null;
}): ReactNode {
  return (
    <Card className="min-w-0">
      <CardContent className="grid gap-3">
        <IconTile variant="primary">
          <Building2 />
        </IconTile>
        <CardTitle asChild>
          <h2>{t('organization.aboutTitle')}</h2>
        </CardTitle>
        <CardDescription>{t('organization.aboutBody')}</CardDescription>
        {organization === null ? null : (
          <dl className="grid gap-1 border-t pt-3 text-sm">
            <dt className="text-muted-foreground">{t('organization.timezone')}</dt>
            <dd className="font-semibold">{organization.timezone}</dd>
          </dl>
        )}
      </CardContent>
    </Card>
  );
}
