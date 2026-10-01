import type { LeaveBalance } from '@shift/domain';
import type { ReactNode } from 'react';

import { StatTile, StatTileLabel, StatTileValue } from '@/components/ui/stat-tile';
import { myLeaveTilesOf } from '@/features/leave/services/my-leave';
import { t } from '@/lib/i18n';

/**
 * The viewer's three figures (story 5.2c), in their fixed order: the
 * allowance, the days used in the current leave year, and the balance. Each
 * is the domain's figure in whole days through `count.days`, in tabular
 * numerals, so a negative balance reads as a number (`−2 dana`), never as an
 * error.
 */
export function MyLeaveSummary({ balance }: { readonly balance: LeaveBalance }): ReactNode {
  return (
    <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3">
      {myLeaveTilesOf(balance).map((tile) => (
        <StatTile key={tile.label}>
          <div className="min-w-0">
            <StatTileLabel>{t(tile.label)}</StatTileLabel>
            <StatTileValue>{t('count.days', { count: tile.days })}</StatTileValue>
          </div>
        </StatTile>
      ))}
    </div>
  );
}
