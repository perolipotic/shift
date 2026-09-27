import { Plus } from 'lucide-react';
import type { ReactNode } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardHeader, CardTitle } from '@/components/ui/card';
import { Notice } from '@/components/ui/notice';
import { SectionNumber } from '@/components/ui/section-number';
import { ShiftTypeTable } from '@/features/shift-types/components/shift-type-table';
import type { ShiftTypeListScreen } from '@/features/shift-types/hooks/use-shift-type-list';
import { shiftTypesMessageKey } from '@/features/shift-types/services/list';
import { shiftTypeSavedMessageKey, shiftTypeWriteMessageKey } from '@/features/shift-types/services/write';
import { t } from '@/lib/i18n';

const SKELETON_ROWS = [0, 1, 2];

/**
 * SECTION 1, the shift types, as the builder places it: beside the pattern
 * from `lg` up, stacked above it below. The add opens from the card's own
 * header; the archived types follow in a card of their own.
 */
export function ShiftTypeListSection({ screen }: { readonly screen: ShiftTypeListScreen }): ReactNode {
  const { adding, saved, failure, refusal, loading, list, openAdding } = screen;

  return (
    <div className="grid min-w-0 gap-6">
      {/* THE ADD'S OUTCOME ON THE PAGE once the dialog has closed — the
          confirmation, or a type added without its times — above the
          section it is about. */}
      {adding || saved === null ? null : (
        <Notice role="status">{t(shiftTypeSavedMessageKey(saved))}</Notice>
      )}
      {adding || failure === null ? null : (
        <Notice role="alert">{t(shiftTypeWriteMessageKey(failure))}</Notice>
      )}
      {refusal === null ? null : (
        <Notice role="alert">{t(shiftTypesMessageKey(refusal))}</Notice>
      )}
      {loading ? (
        <div className="grid gap-2">
          {SKELETON_ROWS.map((row) => (
            <div key={row} className="h-11 w-full animate-pulse rounded-md bg-muted" />
          ))}
        </div>
      ) : null}
      {list === null ? null : (
        <Card className="min-w-0">
          <CardHeader className="flex-row flex-wrap items-center gap-3">
            <SectionNumber value={1} />
            <CardTitle asChild>
              <h2>{t('rotation.shiftTypes.heading')}</h2>
            </CardTitle>
            {/* STATED, AND STATED AT ZERO (UX-DR20). Not a live region. */}
            <Badge variant="secondary">
              {t('rotation.shiftTypes.count', { count: list.active.length })}
            </Badge>
            <Button className="ml-auto h-11" type="button" onClick={openAdding}>
              <Plus aria-hidden />
              {t('rotation.shiftTypes.open')}
            </Button>
          </CardHeader>
          <ShiftTypeTable rows={list.active} />
        </Card>
      )}
      {list === null || list.archived.length === 0 ? null : (
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle asChild>
              <h2>{t('rotation.shiftTypes.archivedHeading')}</h2>
            </CardTitle>
          </CardHeader>
          <ShiftTypeTable rows={list.archived} />
        </Card>
      )}
    </div>
  );
}
