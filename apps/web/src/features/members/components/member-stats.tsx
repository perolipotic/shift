import { ShieldCheck, UserCheck, UserMinus, Users } from 'lucide-react';
import type { ReactNode } from 'react';

import { IconTile } from '@/components/ui/icon-tile';
import { StatCard, StatLabel, StatValue } from '@/components/ui/stat-card';
import { formatNumber } from '@/lib/i18n/format';
import { t } from '@/lib/i18n';
import type { MemberList } from '@/features/members/hooks/use-member-list';

/**
 * The summary tiles' icons, in the order `membersViewOf` returns the four
 * figures: everyone, administrators, active today, inactive today. DECORATIVE:
 * each tile's label says what it counts.
 */
const STAT_ICONS = [Users, ShieldCheck, UserCheck, UserMinus] as const;

/** The member list's summary row, drawn only once there is a summary to draw. */
export function MemberStats({ list }: { readonly list: MemberList }): ReactNode {
  const { summary } = list;

  return summary === null ? null : (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {summary.map((stat, index) => {
        const Icon = STAT_ICONS[index] ?? Users;

        return (
          <StatCard key={stat.label} className="gap-3 sm:flex-row sm:items-center">
            <IconTile variant="primary">
              <Icon />
            </IconTile>
            <div className="grid min-w-0 gap-1.5">
              <StatLabel>{t(stat.label)}</StatLabel>
              {/* A FIGURE THAT CANNOT YET BE STATED is drawn pending, never
                  as a guessed zero: `membersSummaryOf` answers `null` for the
                  active and inactive counts while today is unknown. */}
              {stat.value === null ? (
                <div className="h-8 w-12 animate-pulse rounded-md bg-muted" />
              ) : (
                <StatValue>{formatNumber(stat.value, 0)}</StatValue>
              )}
            </div>
          </StatCard>
        );
      })}
    </div>
  );
}
