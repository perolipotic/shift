import type { LeaveBalance } from '@shift/domain';
import type { ReactNode } from 'react';

import { StatTile, StatTileLabel, StatTileValue } from '@/components/ui/stat-tile';
import { leaveCarriedLineMessageKey, leaveCarriedLineOf } from '@/features/leave/services/leave-section';
import { myLeaveTilesOf } from '@/features/leave/services/my-leave';
import { t } from '@/lib/i18n';

/**
 * The viewer's three figures (story 5.2c), in their fixed order: the
 * allowance, the days used in the current leave year, and the balance. Each
 * is the domain's figure in whole days through `count.days`, in tabular
 * numerals, so a negative balance reads as a number (`−2 dana`), never as an
 * error. Under them, the carried line when days were carried into the leave
 * year (story 13.4b), so allowance + carried − used reads as the balance.
 */
export function MyLeaveSummary({ balance, today }: { readonly balance: LeaveBalance; readonly today: string }): ReactNode {
  const carried = leaveCarriedLineOf(balance, today);

  return (
    <div className="grid min-w-0 gap-2">
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
      {carried === null ? null : (
        <p className="min-w-0 break-words text-sm text-muted-foreground tabular-nums">
          {t(leaveCarriedLineMessageKey(carried.kind), { ...carried })}
        </p>
      )}
    </div>
  );
}
