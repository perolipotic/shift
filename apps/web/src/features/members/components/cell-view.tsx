import type { ReactNode } from 'react';

import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { t } from '@/lib/i18n';
import { memberCellLookOf, type MemberCell } from '@/features/members/services/list';
import { cellContent } from '@/features/members/utils/cell-content';

/**
 * One cell, drawn the way `memberCellLookOf` decides (visual refresh B): an
 * initials chip beside every name, a badge for the level, and the inactive
 * marker's badge with its words. EVERY DECISION IS THE MODULE'S; this only
 * passes the marker's key and argument to `t()`.
 *
 * The chip is decorative and hidden by the primitive, and it is drawn EMPTY
 * for a name with no letter so the names stay aligned. The marker is preceded
 * by a visually hidden separator from `hr.json`, so a screen reader announces
 * the name and the marker as two things rather than one run of words.
 */
export function CellView({ cell }: { readonly cell: MemberCell }): ReactNode {
  const look = memberCellLookOf(cell);
  const text = cellContent(cell);

  return (
    <span className="inline-flex max-w-full flex-wrap items-center gap-x-3 gap-y-1">
      {/* `max-w-full` and `truncate` all the way down, so a cell its column
          bounds (the address) ends in an ellipsis rather than clipping. */}
      <span className="inline-flex min-w-0 max-w-full items-center gap-3">
        {look.avatar === null ? null : <Avatar>{look.avatar.initials}</Avatar>}
        {look.badge === null ? <span className="truncate">{text}</span> : <Badge variant={look.badge}>{text}</Badge>}
      </span>
      {look.status === null ? null : (
        <span>
          <span className="sr-only">{t('ljudi.status.separator')}</span>
          <Badge variant={look.status.variant}>{t(look.status.key, look.status.args)}</Badge>
        </span>
      )}
    </span>
  );
}
