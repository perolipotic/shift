import { Info } from 'lucide-react';
import type { ReactNode } from 'react';

import { Card, CardContent, CardDescription, CardTitle } from '@/components/ui/card';
import { IconTile } from '@/components/ui/icon-tile';
import { t } from '@/lib/i18n';

/** WHAT HAPPENS AFTER an account is issued, beside the create form. Explains;
 *  announces nothing. */
export function MemberCreateAbout(): ReactNode {
  return (
    <Card className="min-w-0">
      <CardContent className="grid gap-3">
        <IconTile variant="primary">
          <Info />
        </IconTile>
        <CardTitle asChild>
          <h2>{t('ljudi.form.newAboutTitle')}</h2>
        </CardTitle>
        <CardDescription>{t('ljudi.form.newAboutBody')}</CardDescription>
      </CardContent>
    </Card>
  );
}
