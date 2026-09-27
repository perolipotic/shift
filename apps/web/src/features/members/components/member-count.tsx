import type { ReactNode } from 'react';

import { t } from '@/lib/i18n';
import type { MemberList } from '@/features/members/hooks/use-member-list';

/**
 * How many people the list shows. STATED, AND STATED AT ZERO: a search matching
 * nothing renders `Prikazano 0 osoba` rather than emptying the region, because
 * UX-DR20 states the fact rather than the absence, and a table that simply goes
 * blank is indistinguishable from one that failed to load.
 *
 * `role="status"` is the live half. A skeleton says nothing to a screen reader,
 * so without a polite region the surface finishes loading in silence and the
 * reader has to go looking for what arrived; announcing the count is announcing
 * exactly what changed.
 */
export function MemberCount({ list }: { readonly list: MemberList }): ReactNode {
  const { unanswered, narrowed } = list;

  return unanswered ? null : (
    <p role="status" className="text-sm text-muted-foreground">
      {t('ljudi.count', { count: narrowed.rows.length })}
    </p>
  );
}
